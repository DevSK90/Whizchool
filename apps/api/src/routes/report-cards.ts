import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { PermissionKey } from "@whizchool/shared/permissions";
import type { ReportCard, ReportCardClassView, ReportCardOverviewRow } from "@whizchool/shared/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth/context";
import { hasFullScope } from "../auth/scope";
import { config } from "../config";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { enqueue } from "../jobs";
import { schoolName } from "../school";
import { createMessage, type Recipient } from "../services/messages";
import { classReportCards, classReportRows, clearSnapshot, examInclude, reportClassOf, reportStatus, reportStatuses, snapshotClass, toExam } from "../services/results";
import { fullName } from "../students";

/** Report cards are a class teacher's business: full-scope staff see every class, class teachers their own. */
function assertClassAccess(auth: AuthContext, classId: string, perm: PermissionKey) {
  if (!hasFullScope(auth, perm) && !auth.session.classIds.includes(classId)) {
    throw new ApiError(403, "forbidden", "You can only access report cards for your own class.");
  }
}

async function loadExam(id: string) {
  const exam = await prisma.exam.findUnique({ where: { id }, include: examInclude });
  if (!exam) throw new ApiError(404, "not_found", "Exam not found.");
  return exam;
}

async function loadClass(id: string) {
  const cls = await prisma.classSection.findUnique({ where: { id } });
  if (!cls) throw new ApiError(404, "not_found", "Class not found.");
  return cls;
}

const classExam = z.object({ examId: z.string().max(100), classId: z.string().max(100) });

/** The exam is released once every class of its year that has subjects has released its report cards. */
async function refreshExamStatus(examId: string) {
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  const classes = await prisma.classSection.findMany({ where: { yearId: exam.yearId, subjects: { some: {} } }, select: { id: true } });
  const statuses = await reportStatuses(prisma, examId, classes.map((c) => c.id));
  const all = [...statuses.values()].every((s) => s.status === "released");
  if (all && exam.status !== "released") await prisma.exam.update({ where: { id: examId }, data: { status: "released" } });
}

export const reportCardRoutes = [
  defineRoute({
    method: "GET",
    path: "/report-cards/overview",
    access: { permission: "reportCards.view" },
    summary: "Report-card progress of every class (or the caller's own) for an exam",
    query: z.object({ examId: z.string().max(100) }),
    handler: async ({ auth, query }): Promise<ReportCardOverviewRow[]> => {
      const exam = await loadExam(query.examId);
      const classes = await prisma.classSection.findMany({
        where: { yearId: exam.yearId, ...(hasFullScope(auth, "reportCards.view") ? {} : { id: { in: auth.session.classIds } }) },
        include: { grade: { select: { number: true } }, classTeacher: { select: { name: true } }, _count: { select: { students: { where: { status: "active" } } } } },
      });
      const statuses = await reportStatuses(prisma, exam.id, classes.map((c) => c.id));
      return classes
        .map((c) => ({
          classId: c.id,
          className: c.name,
          gradeNumber: c.grade.number,
          ...(c.classTeacher ? { classTeacherName: c.classTeacher.name } : {}),
          ...statuses.get(c.id)!,
          students: c._count.students,
        }))
        .sort((a, b) => a.gradeNumber - b.gradeNumber || a.className.localeCompare(b.className));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/report-cards",
    access: { permission: "reportCards.view" },
    summary: "A class's results for an exam, best rank first",
    query: classExam,
    handler: async ({ auth, query }): Promise<ReportCardClassView> => {
      const exam = await loadExam(query.examId);
      const cls = await loadClass(query.classId);
      assertClassAccess(auth, cls.id, "reportCards.view");
      const { status, rows, classSize } = await classReportRows(prisma, exam.id, cls.id);
      const sheets = (await reportStatuses(prisma, exam.id, [cls.id])).get(cls.id)!;
      return {
        exam: toExam(exam),
        classId: cls.id,
        className: cls.name,
        status,
        marksComplete: sheets.sheetsSubmitted >= sheets.sheetsTotal,
        rows: rows.map((r) => {
          const grades: Record<string, number> = {};
          for (const s of r.subjects) if (s.grade !== "—") grades[s.grade] = (grades[s.grade] ?? 0) + 1;
          return {
            examId: exam.id,
            studentId: r.student.id,
            admissionNo: r.student.admissionNo,
            fullName: fullName(r.student),
            total: r.total,
            average: r.average,
            rank: r.rank,
            classSize,
            grades,
            status,
            hasRemark: !!r.classTeacherRemark,
          };
        }),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/report-cards/batch",
    access: { permission: "reportCards.view" },
    summary: "Every report card of a class, alphabetical, for printing",
    query: classExam,
    handler: async ({ auth, query }): Promise<ReportCard[]> => {
      await loadExam(query.examId);
      const cls = await loadClass(query.classId);
      assertClassAccess(auth, cls.id, "reportCards.view");
      const cards = await classReportCards(prisma, query.examId, cls.id);
      return cards.sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/report-cards/:examId/:studentId",
    access: "session",
    summary: "One student's report card (parents: released cards of their own children)",
    handler: async ({ auth, params }): Promise<ReportCard> => {
      await loadExam(params.examId);
      const student = await prisma.student.findUnique({ where: { id: params.studentId }, select: { id: true, classId: true } });
      if (!student) throw new ApiError(404, "not_found", "Student not found.");
      const classId = await reportClassOf(prisma, params.examId, student);
      if (auth.session.kind === "parent") {
        if (!auth.session.studentIds.includes(student.id)) throw new ApiError(403, "forbidden", "You can only view your own children's report cards.");
        if ((await reportStatus(prisma, params.examId, classId)) !== "released") throw new ApiError(404, "not_released", "This report card hasn't been released yet.");
      } else {
        if (!auth.session.permissions.includes("reportCards.view")) throw new ApiError(403, "forbidden", "You don't have access to report cards.");
        assertClassAccess(auth, classId, "reportCards.view");
      }
      const card = (await classReportCards(prisma, params.examId, classId)).find((c) => c.student.id === student.id);
      if (!card) throw new ApiError(404, "not_found", "No results for this student.");
      return card;
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/report-cards/:examId/:studentId/remarks",
    access: { permission: "reportCards.edit" },
    summary: "Class teacher's (and principal's) remark on a report card; locked once approved",
    body: z.object({ classTeacherRemark: z.string().trim().max(300, "Max 300 characters").optional(), principalRemark: z.string().trim().max(300, "Max 300 characters").optional() }),
    handler: async ({ auth, params, body }) => {
      const exam = await loadExam(params.examId);
      const student = await prisma.student.findUnique({ where: { id: params.studentId }, select: { id: true, classId: true, firstName: true, lastName: true } });
      if (!student) throw new ApiError(404, "not_found", "Student not found.");
      const classId = await reportClassOf(prisma, exam.id, student);
      assertClassAccess(auth, classId, "reportCards.edit");
      const status = await reportStatus(prisma, exam.id, classId);
      if (status === "approved" || status === "released") throw new ApiError(409, "locked", "Remarks are locked after approval.");
      if (body.principalRemark !== undefined && !auth.session.permissions.includes("reportCards.approve")) {
        throw new ApiError(403, "forbidden", "Only the principal can add a principal's remark.");
      }
      const data = {
        ...(body.classTeacherRemark !== undefined ? { classTeacherRemark: body.classTeacherRemark || null } : {}),
        ...(body.principalRemark !== undefined ? { principalRemark: body.principalRemark || null } : {}),
      };
      await prisma.$transaction(async (tx) => {
        await tx.reportCard.upsert({ where: { examId_studentId: { examId: exam.id, studentId: student.id } }, update: data, create: { examId: exam.id, studentId: student.id, ...data } });
        await audit(tx, auth, { action: "reportCards.remark", entity: "Report card", entityId: student.id, summary: `Remark for ${fullName(student)} (${exam.name})` });
      });
      return { ok: true };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/report-cards/approve",
    access: { permission: "reportCards.approve" },
    summary: "Approve a class's report cards: results are frozen (marks, grades, ranks) and the sheets can no longer be unlocked",
    body: classExam.extend({ force: z.boolean().optional() }),
    handler: async ({ auth, body }) => {
      const exam = await loadExam(body.examId);
      const cls = await loadClass(body.classId);
      assertClassAccess(auth, cls.id, "reportCards.approve");
      await prisma.$transaction(
        async (tx) => {
          // Locks the class's row so two approvals can't both snapshot.
          await tx.$executeRaw`SELECT 1 FROM "Class" WHERE "id" = ${cls.id} FOR UPDATE`;
          const status = await reportStatus(tx, exam.id, cls.id);
          if (status === "pending_marks") throw new ApiError(409, "incomplete", "All mark sheets must be submitted before approval.");
          if (status !== "draft") throw new ApiError(409, "invalid_transition", "Report cards are already approved.");
          const res = await snapshotClass(tx, exam.id, cls.id);
          const remarks = await tx.reportCard.count({ where: { examId: exam.id, classId: cls.id, classTeacherRemark: { not: null } } });
          const missing = res.rows.length - remarks;
          if (missing && !body.force) {
            throw new ApiError(409, "missing_remarks", `${missing} student${missing === 1 ? " has" : "s have"} no class-teacher remark yet.`);
          }
          await tx.classReport.create({ data: { examId: exam.id, classId: cls.id, status: "approved", approvedAt: new Date(), approvedById: auth.session.id } });
          await audit(tx, auth, { action: "reportCards.approve", entity: "Report cards", summary: `Approved ${exam.name} report cards for ${cls.name}` });
        },
        { timeout: 20_000 },
      );
      return { status: "approved" };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/report-cards/release",
    access: { permission: "reportCards.approve" },
    summary: "Release approved report cards to parents and tell them (email, or SMS when there's no email address)",
    body: classExam,
    handler: async ({ auth, body }) => {
      const exam = await loadExam(body.examId);
      const cls = await loadClass(body.classId);
      assertClassAccess(auth, cls.id, "reportCards.approve");
      const school = await schoolName();
      const portal = `${config.APP_URL}/portal`;
      const messageIds = await prisma.$transaction(async (tx) => {
        const report = await tx.classReport.updateMany({
          where: { examId: exam.id, classId: cls.id, status: "approved" },
          data: { status: "released", releasedAt: new Date(), releasedById: auth.session.id },
        });
        if (!report.count) throw new ApiError(409, "invalid_transition", "Approve the report cards before releasing them.");
        // Each child's primary guardian hears about that child's card.
        const cards = await tx.reportCard.findMany({
          where: { examId: exam.id, classId: cls.id },
          select: {
            student: {
              select: { id: true, firstName: true, lastName: true, guardians: { orderBy: { position: "asc" }, take: 1, select: { guardian: { select: { id: true, email: true, phone: true } } } } },
            },
          },
        });
        const email: Recipient[] = [];
        const sms: Recipient[] = [];
        for (const { student } of cards) {
          const g = student.guardians[0]?.guardian;
          if (!g) continue;
          const name = fullName(student);
          if (g.email) email.push({ to: g.email, guardianId: g.id, studentId: student.id, body: `The ${exam.name} report card for ${name} is now available in the parent portal: ${portal}\n\n${school}` });
          else if (g.phone) sms.push({ to: g.phone, guardianId: g.id, studentId: student.id, body: `${name}'s ${exam.name} report card is now available in the parent portal. - ${school}` });
        }
        const common = {
          kind: "system" as const,
          audience: { type: "class" as const, ids: [cls.id], label: `Parents of ${cls.name}` },
          createdById: auth.session.id,
          createdBy: auth.session.name,
          relatesTo: `report:${exam.id}:${cls.id}`,
        };
        const ids: string[] = [];
        if (email.length) ids.push((await createMessage(tx, { ...common, channel: "email", subject: `${exam.name} report card is available`, body: `The ${exam.name} report card is now available in the parent portal.`, recipients: email })).id);
        if (sms.length) ids.push((await createMessage(tx, { ...common, channel: "sms", body: `The ${exam.name} report card is now available in the parent portal.`, recipients: sms })).id);
        await audit(tx, auth, { action: "reportCards.release", entity: "Report cards", summary: `Released ${exam.name} report cards for ${cls.name}` });
        return { ids, notified: email.length + sms.length };
      });
      await refreshExamStatus(exam.id);
      for (const messageId of messageIds.ids) await enqueue("messages.deliver", { messageId });
      return { status: "released", notified: messageIds.notified };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/report-cards/revert",
    access: { permission: "reportCards.approve" },
    summary: "Withdraw approval of unreleased report cards (results go back to live; remarks are kept)",
    body: classExam,
    handler: async ({ auth, body }) => {
      const exam = await loadExam(body.examId);
      const cls = await loadClass(body.classId);
      assertClassAccess(auth, cls.id, "reportCards.approve");
      await prisma.$transaction(async (tx) => {
        const removed = await tx.classReport.deleteMany({ where: { examId: exam.id, classId: cls.id, status: "approved" } });
        if (!removed.count) throw new ApiError(409, "invalid_transition", "Only approved (unreleased) report cards can be reverted.");
        await clearSnapshot(tx, exam.id, cls.id);
        await audit(tx, auth, { action: "reportCards.revert", entity: "Report cards", summary: `Reverted approval of ${exam.name} report cards for ${cls.name}` });
      });
      return { status: "draft" };
    },
  }),
];
