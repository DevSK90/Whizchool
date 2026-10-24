import type { Route } from "../router";
import type {
  ExamProgress,
  MarkSheet,
  MarkValue,
  PromotionPreview,
  PromotionRow,
  ReportCard,
  ReportCardClassView,
} from "../../types";
import { gradeFor } from "@/lib/grading";
import {
  audit,
  canSeeStudent,
  currentClasses,
  fail,
  fullName,
  hasFullScope,
  isoNow,
  requireAuth,
  requirePerm,
  todayISO,
  type Ctx,
} from "../helpers";
import { nextId, type DB } from "../db";
import {
  classResults,
  classRoster,
  gradeCounts,
  marksComplete,
  markOf,
  reportStatus,
  studentClassSubjects,
  termAttendance,
} from "../results";

function getExam(db: DB, id: string) {
  return db.exams.get(id) ?? fail(404, "not_found", "Exam not found.");
}

function teachesSheet(ctx: Ctx, classId: string, subjectId: string) {
  return ctx.session!.classSubjectIds.some((id) => {
    const cs = ctx.db.classSubjects.get(id);
    return cs?.classId === classId && cs.subjectId === subjectId;
  });
}

function sheetKey(examId: string, classId: string, subjectId: string) {
  return `${examId}|${classId}|${subjectId}`;
}

function sheetRoster(db: DB, classId: string, subjectId: string) {
  return classRoster(db, classId).filter((s) => studentClassSubjects(db, s).some((cs) => cs.subjectId === subjectId));
}

function assertClassTeacherOrFull(ctx: Ctx, classId: string, perm: "reportCards.view" | "reportCards.edit") {
  const s = requirePerm(ctx, perm);
  if (!hasFullScope(s, perm, ctx.db) && !s.classIds.includes(classId)) {
    fail(403, "forbidden", "You can only access report cards for your own class.");
  }
}

function buildReportCard(db: DB, examId: string, studentId: string, today: string): ReportCard {
  const exam = getExam(db, examId);
  const student = db.students.get(studentId) ?? fail(404, "not_found", "Student not found.");
  const res = classResults(db, examId, student.classId);
  const row = res.rows.find((r) => r.student.id === studentId) ?? fail(404, "not_found", "No results for this student.");
  const remarks = db.remarks.get(`${examId}|${studentId}`);
  const cls = db.classes.get(student.classId)!;
  return {
    exam,
    school: { name: db.school.name, motto: db.school.motto, address: db.school.address, phone: db.school.phone, principalName: db.school.principalName },
    student: { id: student.id, admissionNo: student.admissionNo, fullName: fullName(student), classId: cls.id, className: cls.name, gradeName: db.grades.get(cls.gradeId)!.name },
    status: reportStatus(db, examId, student.classId),
    subjects: row.subjects.map((x) => ({
      subjectId: x.subjectId,
      name: db.subjects.get(x.subjectId)!.name,
      mark: x.mark,
      grade: gradeFor(x.mark, db.gradeBands),
      classAverage: res.subjectAverages[x.subjectId] ?? 0,
    })),
    total: row.total,
    average: row.average,
    rank: row.rank,
    classSize: res.classSize,
    attendance: termAttendance(db, studentId, db.terms.get(exam.termId)!, today),
    classTeacherRemark: remarks?.classTeacher,
    principalRemark: remarks?.principal,
    classTeacherName: db.staff.get(cls.classTeacherId)?.name,
  };
}

function refreshExamStatus(db: DB, examId: string) {
  const exam = db.exams.get(examId)!;
  const all = currentClasses(db).every((c) => reportStatus(db, examId, c.id) === "released");
  if (all) exam.status = "released";
  else if (exam.status === "released") exam.status = "review";
}

const NEXT_YEAR = "2027";

export const examRoutes: Route[] = [
  {
    method: "GET",
    path: "/exams",
    handler: (ctx) => {
      requireAuth(ctx);
      const yearId = ctx.query.yearId ?? ctx.db.school.currentYearId;
      return ctx.db.exams.rows.filter((e) => e.yearId === yearId);
    },
  },
  {
    method: "POST",
    path: "/exams",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const { termId, name, startDate, endDate } = ctx.body ?? {};
      const term = ctx.db.terms.get(termId) ?? fail(422, "validation", "Choose a term.", { termId: "Required" });
      if (!name?.trim()) fail(422, "validation", "Name is required.", { name: "Required" });
      if (!startDate || !endDate || startDate > endDate) fail(422, "validation", "Check the dates.", { endDate: "Must be after the start date" });
      if (ctx.db.exams.rows.some((e) => e.termId === termId)) fail(409, "duplicate", "This term already has a term test.");
      const exam = ctx.db.exams.insert({
        id: nextId(ctx.db, "exam"), yearId: term.yearId, termId, name: name.trim(), termName: term.name, status: "scheduled", startDate, endDate,
      });
      audit(ctx, "exam.create", "Exam", `Scheduled ${exam.name}`, exam.id);
      return exam;
    },
  },
  {
    method: "PUT",
    path: "/exams/:id/status",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const exam = getExam(ctx.db, ctx.params.id);
      const { status } = ctx.body ?? {};
      const allowed: Record<string, string[]> = { scheduled: ["marks_entry"], marks_entry: ["review"], review: ["marks_entry"] };
      if (!allowed[exam.status]?.includes(status)) fail(409, "invalid_transition", "That status change isn't allowed.");
      exam.status = status;
      audit(ctx, "exam.status", "Exam", `${exam.name}: ${status === "marks_entry" ? "opened marks entry" : status === "review" ? "closed marks entry" : status}`, exam.id);
      return exam;
    },
  },
  {
    method: "GET",
    path: "/exams/:id/progress",
    handler: (ctx): ExamProgress => {
      const s = requirePerm(ctx, "marks.view");
      const db = ctx.db;
      const exam = getExam(db, ctx.params.id);
      const full = hasFullScope(s, "marks.view", db);
      const visible = new Set(s.classSubjectIds);
      const classes = new Map(currentClasses(db).map((c) => [c.id, c]));
      const sheets = db.classSubjects.rows
        .filter((cs) => classes.has(cs.classId) && (full || visible.has(cs.id)))
        .map((cs) => {
          const cls = classes.get(cs.classId)!;
          const roster = sheetRoster(db, cs.classId, cs.subjectId);
          return {
            classId: cs.classId,
            className: cls.name,
            gradeNumber: db.grades.get(cls.gradeId)!.number,
            subjectId: cs.subjectId,
            subjectName: db.subjects.get(cs.subjectId)!.name,
            teacherName: db.staff.get(cs.teacherId)?.name,
            entered: roster.filter((st) => markOf(db, exam.id, st.id, cs.subjectId) !== null).length,
            total: roster.length,
            submitted: db.submittedSheets.has(sheetKey(exam.id, cs.classId, cs.subjectId)),
          };
        })
        .sort((a, b) => a.gradeNumber - b.gradeNumber || a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
      return { exam, sheets };
    },
  },
  {
    method: "GET",
    path: "/exams/:id/marks",
    handler: (ctx): MarkSheet => {
      const s = requirePerm(ctx, "marks.view");
      const db = ctx.db;
      const exam = getExam(db, ctx.params.id);
      const { classId, subjectId } = ctx.query;
      const cls = db.classes.get(classId) ?? fail(404, "not_found", "Class not found.");
      if (!db.classSubjects.rows.some((cs) => cs.classId === classId && cs.subjectId === subjectId)) fail(404, "not_found", "This class doesn't take that subject.");
      const full = hasFullScope(s, "marks.view", db);
      if (!full && !teachesSheet(ctx, classId, subjectId)) fail(403, "forbidden", "You can only open mark sheets for subjects you teach.");
      const submitted = db.submittedSheets.has(sheetKey(exam.id, classId, subjectId));
      const canEdit = s.permissions.includes("marks.edit") && (hasFullScope(s, "marks.edit", db) || teachesSheet(ctx, classId, subjectId));
      return {
        examId: exam.id,
        classId,
        className: cls.name,
        subjectId,
        subjectName: db.subjects.get(subjectId)!.name,
        submitted,
        editable: exam.status === "marks_entry" && !submitted && canEdit,
        rows: sheetRoster(db, classId, subjectId).map((st) => ({
          studentId: st.id,
          admissionNo: st.admissionNo,
          fullName: fullName(st),
          mark: markOf(db, exam.id, st.id, subjectId),
        })),
      };
    },
  },
  {
    method: "PUT",
    path: "/exams/:id/marks",
    handler: (ctx) => {
      const s = requirePerm(ctx, "marks.edit");
      const db = ctx.db;
      const exam = getExam(db, ctx.params.id);
      const { classId, subjectId, marks, submit } = ctx.body ?? {};
      if (exam.status !== "marks_entry") fail(409, "locked", "Marks entry is closed for this exam.");
      if (!hasFullScope(s, "marks.edit", db) && !teachesSheet(ctx, classId, subjectId)) fail(403, "forbidden", "You can only enter marks for subjects you teach.");
      const key = sheetKey(exam.id, classId, subjectId);
      if (db.submittedSheets.has(key)) fail(409, "locked", "This mark sheet has been submitted and is locked.");
      const roster = new Set(sheetRoster(db, classId, subjectId).map((x) => x.id));
      const fields: Record<string, string> = {};
      for (const { studentId, mark } of marks as { studentId: string; mark: MarkValue }[]) {
        if (!roster.has(studentId)) continue;
        if (mark !== null && mark !== "AB" && !(Number.isInteger(mark) && mark >= 0 && mark <= 100)) fields[studentId] = "Enter 0–100 or AB";
      }
      if (Object.keys(fields).length) fail(422, "validation", "Some marks are invalid.", fields);
      for (const { studentId, mark } of marks as { studentId: string; mark: MarkValue }[]) {
        if (!roster.has(studentId)) continue;
        const k = `${exam.id}|${studentId}|${subjectId}`;
        if (mark === null) db.marks.delete(k);
        else db.marks.set(k, mark);
      }
      const subjectName = db.subjects.get(subjectId)?.name;
      const className = db.classes.get(classId)?.name;
      if (submit) {
        const missing = [...roster].filter((id) => markOf(db, exam.id, id, subjectId) === null).length;
        if (missing) fail(422, "incomplete", `${missing} student${missing === 1 ? "" : "s"} still need a mark (or AB) before you can submit.`);
        db.submittedSheets.add(key);
        audit(ctx, "marks.submit", "Mark sheet", `Submitted ${subjectName} marks for ${className} (${exam.termName})`);
      } else {
        audit(ctx, "marks.save", "Mark sheet", `Saved ${subjectName} marks for ${className} (${exam.termName})`);
      }
      return { submitted: !!submit, saved: marks.length };
    },
  },
  {
    method: "POST",
    path: "/exams/:id/marks/unlock",
    handler: (ctx) => {
      const s = requirePerm(ctx, "marks.edit");
      if (!hasFullScope(s, "marks.edit", ctx.db)) fail(403, "forbidden", "Only an administrator can unlock a submitted mark sheet.");
      const exam = getExam(ctx.db, ctx.params.id);
      const { classId, subjectId, reason } = ctx.body ?? {};
      if (reportStatus(ctx.db, exam.id, classId) === "released" || reportStatus(ctx.db, exam.id, classId) === "approved") {
        fail(409, "locked", "Report cards for this class are already approved. Revert approval first.");
      }
      ctx.db.submittedSheets.delete(sheetKey(exam.id, classId, subjectId));
      audit(ctx, "marks.unlock", "Mark sheet", `Unlocked ${ctx.db.subjects.get(subjectId)?.name} for ${ctx.db.classes.get(classId)?.name}${reason ? `: ${reason}` : ""}`);
      return { ok: true };
    },
  },

  // ---------- Report cards ----------
  {
    method: "GET",
    path: "/report-cards",
    handler: (ctx): ReportCardClassView => {
      const { examId, classId } = ctx.query;
      assertClassTeacherOrFull(ctx, classId, "reportCards.view");
      const db = ctx.db;
      const exam = getExam(db, examId);
      const cls = db.classes.get(classId) ?? fail(404, "not_found", "Class not found.");
      const res = classResults(db, examId, classId);
      const status = reportStatus(db, examId, classId);
      return {
        exam, classId, className: cls.name, status, marksComplete: marksComplete(db, examId, classId),
        rows: res.rows
          .map((r) => ({
            examId, studentId: r.student.id, admissionNo: r.student.admissionNo, fullName: fullName(r.student),
            total: r.total, average: r.average, rank: r.rank, classSize: res.classSize,
            grades: gradeCounts(db, r.subjects.map((x) => x.mark)), status,
            hasRemark: !!db.remarks.get(`${examId}|${r.student.id}`)?.classTeacher,
          }))
          .sort((a, b) => a.rank - b.rank),
      };
    },
  },
  {
    method: "GET",
    path: "/report-cards/overview",
    handler: (ctx) => {
      const s = requirePerm(ctx, "reportCards.view");
      const db = ctx.db;
      const exam = getExam(db, ctx.query.examId);
      const full = hasFullScope(s, "reportCards.view", db);
      return currentClasses(db)
        .filter((c) => full || s.classIds.includes(c.id))
        .map((c) => {
          const total = db.classSubjects.rows.filter((cs) => cs.classId === c.id).length;
          const submitted = db.classSubjects.rows.filter((cs) => cs.classId === c.id && db.submittedSheets.has(sheetKey(exam.id, c.id, cs.subjectId))).length;
          return {
            classId: c.id, className: c.name, gradeNumber: db.grades.get(c.gradeId)!.number,
            classTeacherName: db.staff.get(c.classTeacherId)?.name, status: reportStatus(db, exam.id, c.id),
            sheetsSubmitted: submitted, sheetsTotal: total, students: classRoster(db, c.id).length,
          };
        })
        .sort((a, b) => a.gradeNumber - b.gradeNumber || a.className.localeCompare(b.className));
    },
  },
  {
    method: "GET",
    path: "/report-cards/batch",
    handler: (ctx): ReportCard[] => {
      const { examId, classId } = ctx.query;
      assertClassTeacherOrFull(ctx, classId, "reportCards.view");
      const db = ctx.db;
      getExam(db, examId);
      const today = todayISO(ctx);
      return classResults(db, examId, classId)
        .rows.sort((a, b) => a.student.firstName.localeCompare(b.student.firstName))
        .map((r) => buildReportCard(db, examId, r.student.id, today));
    },
  },
  {
    method: "GET",
    path: "/report-cards/:examId/:studentId",
    handler: (ctx) => {
      const s = requireAuth(ctx);
      const db = ctx.db;
      const student = db.students.get(ctx.params.studentId) ?? fail(404, "not_found", "Student not found.");
      if (s.kind === "parent") {
        if (!canSeeStudent(ctx, student.id)) fail(403, "forbidden", "You can only view your own children's report cards.");
        if (reportStatus(db, ctx.params.examId, student.classId) !== "released") fail(404, "not_released", "This report card hasn't been released yet.");
      } else {
        assertClassTeacherOrFull(ctx, student.classId, "reportCards.view");
      }
      return buildReportCard(db, ctx.params.examId, student.id, todayISO(ctx));
    },
  },
  {
    method: "PUT",
    path: "/report-cards/:examId/:studentId/remarks",
    handler: (ctx) => {
      const db = ctx.db;
      const student = db.students.get(ctx.params.studentId) ?? fail(404, "not_found", "Student not found.");
      assertClassTeacherOrFull(ctx, student.classId, "reportCards.edit");
      const status = reportStatus(db, ctx.params.examId, student.classId);
      if (status === "approved" || status === "released") fail(409, "locked", "Remarks are locked after approval.");
      const key = `${ctx.params.examId}|${student.id}`;
      const current = db.remarks.get(key) ?? {};
      const { classTeacherRemark, principalRemark } = ctx.body ?? {};
      if (typeof classTeacherRemark === "string" && classTeacherRemark.length > 300) fail(422, "validation", "Keep remarks under 300 characters.", { classTeacherRemark: "Max 300 characters" });
      if (principalRemark !== undefined && !ctx.session!.permissions.includes("reportCards.approve")) fail(403, "forbidden", "Only the principal can add a principal's remark.");
      db.remarks.set(key, {
        classTeacher: classTeacherRemark ?? current.classTeacher,
        principal: principalRemark ?? current.principal,
      });
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "/report-cards/approve",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const db = ctx.db;
      const { examId, classId } = ctx.body ?? {};
      const status = reportStatus(db, examId, classId);
      if (status === "pending_marks") fail(409, "incomplete", "All mark sheets must be submitted before approval.");
      if (status !== "draft") fail(409, "invalid_transition", "Report cards are already approved.");
      const missing = classRoster(db, classId).filter((st) => !db.remarks.get(`${examId}|${st.id}`)?.classTeacher).length;
      if (missing && !ctx.body?.force) fail(409, "missing_remarks", `${missing} student${missing === 1 ? " has" : "s have"} no class-teacher remark yet.`);
      db.reportStatus.set(`${examId}|${classId}`, "approved");
      const exam = getExam(db, examId);
      if (exam.status === "marks_entry") exam.status = "review";
      audit(ctx, "reportCards.approve", "Report cards", `Approved ${exam.name} report cards for ${db.classes.get(classId)?.name}`);
      return { status: "approved" };
    },
  },
  {
    method: "POST",
    path: "/report-cards/release",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const db = ctx.db;
      const { examId, classId } = ctx.body ?? {};
      if (reportStatus(db, examId, classId) !== "approved") fail(409, "invalid_transition", "Approve the report cards before releasing them.");
      db.reportStatus.set(`${examId}|${classId}`, "released");
      refreshExamStatus(db, examId);
      const exam = getExam(db, examId);
      const parents = classRoster(db, classId).length;
      db.messages.insert({
        id: nextId(db, "msg"), channel: "email", kind: "system",
        audience: { type: "class", ids: [classId], label: `Parents of ${db.classes.get(classId)?.name}` },
        subject: `${exam.name} report card is available`,
        body: `The ${exam.name} report card for {student} is now available in the parent portal.`,
        recipients: parents, delivered: 0, failed: 0, status: "queued", createdAt: isoNow(ctx), createdBy: ctx.session!.name,
      });
      audit(ctx, "reportCards.release", "Report cards", `Released ${exam.name} report cards for ${db.classes.get(classId)?.name}`);
      return { status: "released", notified: parents };
    },
  },
  {
    method: "POST",
    path: "/report-cards/revert",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const db = ctx.db;
      const { examId, classId } = ctx.body ?? {};
      if (reportStatus(db, examId, classId) !== "approved") fail(409, "invalid_transition", "Only approved (unreleased) report cards can be reverted.");
      db.reportStatus.delete(`${examId}|${classId}`);
      audit(ctx, "reportCards.revert", "Report cards", `Reverted approval for ${db.classes.get(classId)?.name}`);
      return { status: "draft" };
    },
  },

  // ---------- Promotions ----------
  {
    method: "GET",
    path: "/promotions/preview",
    handler: (ctx): PromotionPreview => {
      requirePerm(ctx, "promotions.view");
      const db = ctx.db;
      const year = db.years.get(db.school.currentYearId)!;
      const classes = currentClasses(db);
      const done = db.years.rows.find((y) => y.name === NEXT_YEAR);
      const finalExam = [...db.exams.rows].filter((e) => e.yearId === year.id && reportStatus(db, e.id, classes[0].id) !== "pending_marks").pop();
      const averages = new Map<string, number>();
      if (finalExam) for (const c of classes) for (const r of classResults(db, finalExam.id, c.id).rows) averages.set(r.student.id, r.average);
      const targetFor = (classId: string) => {
        const c = db.classes.get(classId)!;
        const g = db.grades.get(c.gradeId)!.number;
        if (g === 13) return undefined;
        if (g === 11) return undefined; // A/L stream must be chosen
        return `next_${g + 1}${c.section.toLowerCase()}`;
      };
      const rows: PromotionRow[] = classes.flatMap((c) =>
        classRoster(db, c.id).map((s) => {
          const g = db.grades.get(c.gradeId)!.number;
          return {
            studentId: s.id, admissionNo: s.admissionNo, fullName: fullName(s), fromClassId: c.id, fromClassName: c.name,
            average: averages.get(s.id), action: g === 13 ? "graduate" : "promote", toClassId: targetFor(c.id),
          };
        }),
      );
      // Next year's classes mirror this year's structure.
      const targetClasses = classes
        .map((c) => {
          const g = db.grades.get(c.gradeId)!.number;
          return { id: `next_${g}${c.section.toLowerCase()}`, name: c.name, gradeNumber: g };
        })
        .sort((a, b) => a.gradeNumber - b.gradeNumber || a.name.localeCompare(b.name));
      return {
        fromYear: year, toYearName: NEXT_YEAR, rows, targetClasses,
        completed: done ? db.promotionSummary : undefined,
      };
    },
  },
  {
    method: "POST",
    path: "/promotions/confirm",
    handler: (ctx) => {
      requirePerm(ctx, "promotions.approve");
      const db = ctx.db;
      if (db.years.rows.some((y) => y.name === NEXT_YEAR)) fail(409, "already_done", `Promotion to ${NEXT_YEAR} has already been confirmed.`);
      const rows = (ctx.body?.rows ?? []) as PromotionRow[];
      const missing = rows.filter((r) => (r.action === "promote" || r.action === "repeat") && !r.toClassId);
      if (missing.length) fail(422, "validation", `${missing.length} student${missing.length === 1 ? "" : "s"} still need a target class.`);
      const year = db.years.insert({ id: `year_${NEXT_YEAR}`, name: NEXT_YEAR, startDate: `${NEXT_YEAR}-01-05`, endDate: `${NEXT_YEAR}-12-03`, status: "upcoming" });
      const created = new Map<string, string>();
      for (const r of rows) {
        if (!r.toClassId) continue;
        if (!created.has(r.toClassId)) {
          const [, rest] = r.toClassId.split("_");
          const g = parseInt(rest, 10);
          const section = rest.slice(String(g).length).toUpperCase();
          const cls = db.classes.insert({ id: `cls_${NEXT_YEAR}_${rest}`, yearId: year.id, gradeId: `grade_${g}`, section, name: `${g}-${section}` });
          created.set(r.toClassId, cls.id);
        }
        db.enrollments.insert({ id: nextId(db, "enr"), studentId: r.studentId, yearId: year.id, classId: created.get(r.toClassId)! });
      }
      const summary = {
        at: isoNow(ctx),
        promoted: rows.filter((r) => r.action === "promote").length,
        repeated: rows.filter((r) => r.action === "repeat").length,
        left: rows.filter((r) => r.action === "leave").length,
        graduated: rows.filter((r) => r.action === "graduate").length,
      };
      db.promotionSummary = summary;
      audit(ctx, "promotions.confirm", "Promotions", `Confirmed ${NEXT_YEAR} promotions: ${summary.promoted} promoted, ${summary.repeated} repeating, ${summary.graduated} graduating, ${summary.left} leaving`);
      return summary;
    },
  },
];
