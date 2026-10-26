import { ApiError } from "@whizchool/shared/api";
import type { PortalChild, StudentResults } from "@whizchool/shared/types";
import { canSeeStudent } from "../auth/scope";
import { fromIsoDate, schoolToday } from "../dates";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { currentYearId } from "../school";
import { classResults, examInclude, toExam, type SubjectResult } from "../services/results";
import { toFileRef } from "../storage";
import { balances, fullName } from "../students";

/** A student's term-test results this year. Parents see released results only. */
async function studentResults(student: { id: string; classId: string }, releasedOnly: boolean): Promise<StudentResults> {
  const exams = await prisma.exam.findMany({ where: { yearId: await currentYearId() }, include: examInclude, orderBy: { startDate: "asc" } });
  const cards = await prisma.reportCard.findMany({ where: { studentId: student.id, examId: { in: exams.map((e) => e.id) }, classId: { not: null } } });
  const reports = await prisma.classReport.findMany({ where: { examId: { in: exams.map((e) => e.id) }, classId: { in: [...new Set(cards.map((c) => c.classId!))] } } });
  const released = new Set(reports.filter((r) => r.status === "released").map((r) => `${r.examId}|${r.classId}`));
  const out: StudentResults["exams"] = [];
  for (const exam of exams) {
    const card = cards.find((c) => c.examId === exam.id);
    const isReleased = !!card && released.has(`${exam.id}|${card.classId}`);
    if (releasedOnly && !isReleased) {
      out.push({ exam: toExam(exam), released: false });
      continue;
    }
    const pick = (subjects: SubjectResult[]) => subjects.map((s) => ({ name: s.name, mark: s.mark, grade: s.grade }));
    if (card) {
      out.push({ exam: toExam(exam), released: isReleased, average: Number(card.average), rank: card.rank!, classSize: card.classSize!, subjects: pick(card.subjects as unknown as SubjectResult[]) });
      continue;
    }
    // Not approved yet: what the marks say so far.
    const res = await classResults(prisma, exam.id, student.classId);
    const row = res.rows.find((r) => r.student.id === student.id);
    out.push(row ? { exam: toExam(exam), released: false, average: row.average, rank: row.rank, classSize: res.classSize, subjects: pick(row.subjects) } : { exam: toExam(exam), released: false });
  }
  return { exams: out };
}

export const resultRoutes = [
  defineRoute({
    method: "GET",
    path: "/students/:id/results",
    access: "session",
    summary: "A student's term-test results this year (parents: released results only)",
    handler: async ({ auth, params }) => {
      const s = await prisma.student.findUnique({ where: { id: params.id }, select: { id: true, classId: true } });
      if (!s) throw new ApiError(404, "not_found", "Student not found.");
      if (!canSeeStudent(auth, s)) throw new ApiError(403, "forbidden", "You can only view your own students.");
      return studentResults(s, auth.session.kind === "parent");
    },
  }),
  defineRoute({
    method: "GET",
    path: "/portal/children",
    access: "session",
    summary: "The signed-in parent's children with attendance, latest released result and fees",
    handler: async ({ auth }): Promise<PortalChild[]> => {
      if (auth.session.kind !== "parent") throw new ApiError(403, "forbidden", "Parent portal only.");
      const ids = auth.session.studentIds;
      const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: await currentYearId() } });
      const today = fromIsoDate(schoolToday());
      const [students, attendance, owed, overdue] = await Promise.all([
        prisma.student.findMany({ where: { id: { in: ids } }, include: { class: { select: { name: true } }, photo: true } }),
        prisma.attendanceRecord.groupBy({ by: ["studentId", "status"], where: { studentId: { in: ids }, date: { gte: year.startDate, lte: today } }, _count: { _all: true } }),
        balances(prisma, ids),
        prisma.invoice.findMany({ where: { studentId: { in: ids }, status: { in: ["unpaid", "partial"] }, dueDate: { lt: today } }, select: { studentId: true, total: true, paid: true } }),
      ]);
      const out: PortalChild[] = [];
      for (const s of students.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))) {
        const days = attendance.filter((a) => a.studentId === s.id);
        const total = days.reduce((n, a) => n + a._count._all, 0);
        const attended = days.filter((a) => a.status === "present" || a.status === "late").reduce((n, a) => n + a._count._all, 0);
        const latest = (await studentResults(s, true)).exams.filter((e) => e.released && e.average !== undefined).pop();
        out.push({
          id: s.id,
          fullName: fullName(s),
          ...(s.photo ? { photoUrl: toFileRef(s.photo).url } : {}),
          admissionNo: s.admissionNo,
          className: s.class.name,
          attendanceRate: total ? Math.round((attended / total) * 1000) / 10 : 100,
          ...(latest ? { latestAverage: latest.average, latestExamName: latest.exam.name, latestRank: latest.rank, classSize: latest.classSize } : {}),
          balance: owed.get(s.id) ?? 0,
          overdue: overdue.filter((i) => i.studentId === s.id).reduce((n, i) => n + Number(i.total) - Number(i.paid), 0),
        });
      }
      return out;
    },
  }),
];
