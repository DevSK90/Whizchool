import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { ExamProgress, MarkSheet, MarkValue } from "@whizchool/shared/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth/context";
import { hasFullScope } from "../auth/scope";
import { fromIsoDate, isoDate, toIsoDate } from "../dates";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { currentYearId } from "../school";
import { examInclude, markValue, reportStatus, sitsSubject, toExam } from "../services/results";
import { fullName } from "../students";

async function loadExam(id: string) {
  const exam = await prisma.exam.findUnique({ where: { id }, include: examInclude });
  if (!exam) throw new ApiError(404, "not_found", "Exam not found.");
  return exam;
}

/** Whether the caller teaches this subject in this class. */
const teaches = async (auth: AuthContext, classId: string, subjectId: string) =>
  auth.session.classSubjectIds.length > 0 &&
  (await prisma.classSubject.count({ where: { id: { in: auth.session.classSubjectIds }, classId, subjectId } })) > 0;

/** One class's mark sheet for one subject: the class, and the students who sit the subject. */
async function loadSheet(exam: { id: string; yearId: string }, classId: string, subjectId: string) {
  const cls = await prisma.classSection.findUnique({
    where: { id: classId },
    include: { grade: { select: { level: true } }, subjects: { where: { subjectId }, include: { subject: true } } },
  });
  if (!cls || cls.yearId !== exam.yearId) throw new ApiError(404, "not_found", "Class not found.");
  const cs = cls.subjects[0];
  if (!cs) throw new ApiError(404, "not_found", "This class doesn't take that subject.");
  const students = await prisma.student.findMany({
    where: { classId, status: "active" },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, subjects: { select: { subjectId: true } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const roster = students.filter((s) => sitsSubject(cls.grade.level, cs.subject.basket, subjectId, new Set(s.subjects.map((x) => x.subjectId))));
  const sheet = await prisma.markSheet.findUnique({ where: { examId_classId_subjectId: { examId: exam.id, classId, subjectId } } });
  return { cls, subject: cs.subject, roster, submitted: !!sheet?.submittedAt };
}

const markInput = z.union([z.number(), z.literal("AB"), z.null()]);

export const examRoutes = [
  defineRoute({
    method: "GET",
    path: "/exams",
    access: "session",
    summary: "Term tests of a year (default: the current year)",
    query: z.object({ yearId: z.string().max(100).optional() }),
    handler: async ({ query }) => {
      const yearId = query.yearId || (await currentYearId());
      return (await prisma.exam.findMany({ where: { yearId }, include: examInclude, orderBy: { startDate: "asc" } })).map(toExam);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/exams",
    access: { permission: "settings.edit" },
    summary: "Schedule a term test (one per term)",
    body: z.object({ termId: z.string().max(100), name: z.string().trim().max(100), startDate: isoDate(), endDate: isoDate() }),
    handler: async ({ auth, body }) => {
      const term = await prisma.term.findUnique({ where: { id: body.termId } });
      const fields: Record<string, string> = {};
      if (!term) fields.termId = "Choose a term";
      if (!body.name) fields.name = "Required";
      if (body.startDate > body.endDate) fields.endDate = "Must be after the start date";
      else if (term && (body.startDate < toIsoDate(term.startDate) || body.endDate > toIsoDate(term.endDate))) {
        fields.startDate = `Must be within ${term.name} (${toIsoDate(term.startDate)} to ${toIsoDate(term.endDate)})`;
      }
      if (Object.keys(fields).length) throw new ApiError(422, "validation", "Please fix the highlighted fields.", fields);
      if (await prisma.exam.count({ where: { termId: term!.id } })) throw new ApiError(409, "duplicate", "This term already has a term test.");
      const exam = await prisma.$transaction(async (tx) => {
        const exam = await tx.exam.create({
          data: { yearId: term!.yearId, termId: term!.id, name: body.name, startDate: fromIsoDate(body.startDate), endDate: fromIsoDate(body.endDate) },
          include: examInclude,
        });
        await audit(tx, auth, { action: "exam.create", entity: "Exam", entityId: exam.id, summary: `Scheduled ${exam.name}` });
        return exam;
      });
      return toExam(exam);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/exams/:id/status",
    access: { permission: "reportCards.approve" },
    summary: "Open or close marks entry",
    body: z.object({ status: z.enum(["marks_entry", "review"]) }),
    handler: async ({ auth, params, body }) => {
      const exam = await loadExam(params.id);
      const allowed: Record<string, string[]> = { scheduled: ["marks_entry"], marks_entry: ["review"], review: ["marks_entry"] };
      if (!allowed[exam.status]?.includes(body.status)) throw new ApiError(409, "invalid_transition", "That status change isn't allowed.");
      const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.exam.update({ where: { id: exam.id }, data: { status: body.status }, include: examInclude });
        const what = body.status === "marks_entry" ? "opened marks entry" : "closed marks entry";
        await audit(tx, auth, { action: "exam.status", entity: "Exam", entityId: exam.id, summary: `${exam.name}: ${what}` });
        return updated;
      });
      return toExam(updated);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/exams/:id/progress",
    access: { permission: "marks.view" },
    summary: "Every mark sheet of an exam the caller may see, with how many marks are in",
    handler: async ({ auth, params }): Promise<ExamProgress> => {
      const exam = await loadExam(params.id);
      const full = hasFullScope(auth, "marks.view");
      const classSubjects = await prisma.classSubject.findMany({
        where: { class: { yearId: exam.yearId }, ...(full ? {} : { id: { in: auth.session.classSubjectIds } }) },
        include: {
          class: { select: { name: true, grade: { select: { number: true, level: true } } } },
          subject: { select: { name: true, basket: true } },
          teacher: { select: { name: true } },
        },
      });
      const classIds = [...new Set(classSubjects.map((cs) => cs.classId))];
      const [students, marks, sheets] = await Promise.all([
        prisma.student.findMany({ where: { classId: { in: classIds }, status: "active" }, select: { id: true, classId: true, subjects: { select: { subjectId: true } } } }),
        prisma.mark.findMany({ where: { examId: exam.id, student: { classId: { in: classIds }, status: "active" } }, select: { studentId: true, subjectId: true } }),
        prisma.markSheet.findMany({ where: { examId: exam.id, classId: { in: classIds }, submittedAt: { not: null } }, select: { classId: true, subjectId: true } }),
      ]);
      const entered = new Set(marks.map((m) => `${m.studentId}|${m.subjectId}`));
      const submitted = new Set(sheets.map((s) => `${s.classId}|${s.subjectId}`));
      const sheetsOut = classSubjects.map((cs) => {
        const roster = students.filter(
          (s) => s.classId === cs.classId && sitsSubject(cs.class.grade.level, cs.subject.basket, cs.subjectId, new Set(s.subjects.map((x) => x.subjectId))),
        );
        return {
          classId: cs.classId,
          className: cs.class.name,
          gradeNumber: cs.class.grade.number,
          subjectId: cs.subjectId,
          subjectName: cs.subject.name,
          ...(cs.teacher ? { teacherName: cs.teacher.name } : {}),
          entered: roster.filter((s) => entered.has(`${s.id}|${cs.subjectId}`)).length,
          total: roster.length,
          submitted: submitted.has(`${cs.classId}|${cs.subjectId}`),
        };
      });
      sheetsOut.sort((a, b) => a.gradeNumber - b.gradeNumber || a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
      return { exam: toExam(exam), sheets: sheetsOut };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/exams/:id/marks",
    access: { permission: "marks.view" },
    summary: "One class's marks for one subject",
    query: z.object({ classId: z.string().max(100), subjectId: z.string().max(100) }),
    handler: async ({ auth, params, query }): Promise<MarkSheet> => {
      const exam = await loadExam(params.id);
      const { cls, subject, roster, submitted } = await loadSheet(exam, query.classId, query.subjectId);
      const own = await teaches(auth, cls.id, subject.id);
      if (!hasFullScope(auth, "marks.view") && !own) throw new ApiError(403, "forbidden", "You can only open mark sheets for subjects you teach.");
      const canEdit = auth.session.permissions.includes("marks.edit") && (hasFullScope(auth, "marks.edit") || own);
      const marks = await prisma.mark.findMany({ where: { examId: exam.id, subjectId: subject.id, studentId: { in: roster.map((s) => s.id) } } });
      const byStudent = new Map(marks.map((m) => [m.studentId, m]));
      return {
        examId: exam.id,
        classId: cls.id,
        className: cls.name,
        subjectId: subject.id,
        subjectName: subject.name,
        submitted,
        editable: exam.status === "marks_entry" && !submitted && canEdit,
        rows: roster.map((s) => ({ studentId: s.id, admissionNo: s.admissionNo, fullName: fullName(s), mark: markValue(byStudent.get(s.id)) })),
      };
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/exams/:id/marks",
    access: { permission: "marks.edit" },
    summary: "Save a mark sheet (null clears a mark); submit locks it once every student has a mark or AB",
    body: z.object({
      classId: z.string().max(100),
      subjectId: z.string().max(100),
      marks: z.array(z.object({ studentId: z.string().max(100), mark: markInput })).max(200),
      submit: z.boolean().optional(),
    }),
    handler: async ({ auth, params, body }) => {
      const exam = await loadExam(params.id);
      if (exam.status !== "marks_entry") throw new ApiError(409, "locked", "Marks entry is closed for this exam.");
      const { cls, subject, roster, submitted } = await loadSheet(exam, body.classId, body.subjectId);
      if (!hasFullScope(auth, "marks.edit") && !(await teaches(auth, cls.id, subject.id))) {
        throw new ApiError(403, "forbidden", "You can only enter marks for subjects you teach.");
      }
      if (submitted) throw new ApiError(409, "locked", "This mark sheet has been submitted and is locked.");
      const onSheet = new Set(roster.map((s) => s.id));
      const fields: Record<string, string> = {};
      for (const { studentId, mark } of body.marks) {
        if (!onSheet.has(studentId)) fields[studentId] = "Not on this mark sheet";
        else if (typeof mark === "number" && !(Number.isInteger(mark) && mark >= 0 && mark <= 100)) fields[studentId] = "Enter 0–100 or AB";
      }
      if (Object.keys(fields).length) throw new ApiError(422, "validation", "Some marks are invalid.", fields);

      const label = `${subject.name} marks for ${cls.name} (${exam.term.name})`;
      await prisma.$transaction(async (tx) => {
        for (const { studentId, mark } of body.marks) {
          const where = { examId_studentId_subjectId: { examId: exam.id, studentId, subjectId: subject.id } };
          if (mark === null) await tx.mark.deleteMany({ where: { examId: exam.id, studentId, subjectId: subject.id } });
          else {
            const data = { value: mark === "AB" ? null : (mark as number), absent: mark === "AB" };
            await tx.mark.upsert({ where, update: data, create: { examId: exam.id, studentId, subjectId: subject.id, ...data } });
          }
        }
        if (body.submit) {
          const have = await tx.mark.count({ where: { examId: exam.id, subjectId: subject.id, studentId: { in: [...onSheet] } } });
          const missing = onSheet.size - have;
          if (missing) {
            throw new ApiError(422, "incomplete", `${missing} student${missing === 1 ? "" : "s"} still need a mark (or AB) before you can submit.`);
          }
          const key = { examId_classId_subjectId: { examId: exam.id, classId: cls.id, subjectId: subject.id } };
          const data = { submittedAt: new Date(), submittedById: auth.session.id };
          await tx.markSheet.upsert({ where: key, update: data, create: { examId: exam.id, classId: cls.id, subjectId: subject.id, ...data } });
        }
        await audit(tx, auth, { action: body.submit ? "marks.submit" : "marks.save", entity: "Mark sheet", summary: `${body.submit ? "Submitted" : "Saved"} ${label}` });
      });
      return { submitted: !!body.submit, saved: body.marks.length };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/exams/:id/marks/unlock",
    access: { permission: "marks.edit" },
    summary: "Reopen a submitted mark sheet (administrators; not after the class's report cards are approved)",
    body: z.object({ classId: z.string().max(100), subjectId: z.string().max(100), reason: z.string().trim().max(300).optional() }),
    handler: async ({ auth, params, body }) => {
      if (!hasFullScope(auth, "marks.edit")) throw new ApiError(403, "forbidden", "Only an administrator can unlock a submitted mark sheet.");
      const exam = await loadExam(params.id);
      const { cls, subject } = await loadSheet(exam, body.classId, body.subjectId);
      const status = await reportStatus(prisma, exam.id, cls.id);
      if (status === "approved" || status === "released") {
        throw new ApiError(409, "locked", "Report cards for this class are already approved. Revert approval first.");
      }
      await prisma.$transaction(async (tx) => {
        await tx.markSheet.updateMany({ where: { examId: exam.id, classId: cls.id, subjectId: subject.id }, data: { submittedAt: null, submittedById: null } });
        await audit(tx, auth, {
          action: "marks.unlock",
          entity: "Mark sheet",
          summary: `Unlocked ${subject.name} for ${cls.name}${body.reason ? `: ${body.reason}` : ""}`,
        });
      });
      return { ok: true };
    },
  }),
];
