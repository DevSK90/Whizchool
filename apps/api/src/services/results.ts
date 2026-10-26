// Term-test results: live from the marks while a class's report cards are in draft, and frozen into
// ReportCard rows when they're approved, so released results never change afterwards (a later edit
// to the grade bands, a student moving class, or a new year doesn't rewrite them).
import { gradeFor, rankByAverage, summarizeMarks } from "@whizchool/shared/grading";
import type { Exam, GradeBand, MarkValue, ReportCard, ReportCardStatus } from "@whizchool/shared/types";
import { Prisma } from "../generated/prisma/client";
import type { Db } from "../db";
import { fromIsoDate, schoolToday, toIsoDate } from "../dates";
import { fullName } from "../students";

type Client = Db | Prisma.TransactionClient;

export interface SubjectResult {
  subjectId: string;
  name: string;
  mark: MarkValue;
  grade: string;
  classAverage: number;
}

export const markValue = (m: { value: number | null; absent: boolean } | undefined): MarkValue => (!m ? null : m.absent ? "AB" : m.value);

export const examInclude = { term: { select: { name: true } } } satisfies Prisma.ExamInclude;

export function toExam(e: Prisma.ExamGetPayload<{ include: typeof examInclude }>): Exam {
  return {
    id: e.id,
    yearId: e.yearId,
    termId: e.termId,
    name: e.name,
    termName: e.term.name,
    status: e.status,
    startDate: toIsoDate(e.startDate),
    endDate: toIsoDate(e.endDate),
  };
}

/** O/L students sit the core subjects plus their chosen basket electives; everyone else sits all the class's subjects. */
export const sitsSubject = (level: string, basket: number | null, subjectId: string, electives: Set<string>) =>
  level !== "ol" || basket === null || electives.has(subjectId);

/** The class register for results: active students, alphabetical, with their electives. */
export const classRoster = (db: Client, classId: string) =>
  db.student.findMany({
    where: { classId, status: "active" },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, subjects: { select: { subjectId: true } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

const classInclude = {
  grade: { select: { name: true, number: true, level: true } },
  classTeacher: { select: { name: true } },
  subjects: { select: { subjectId: true, subject: { select: { name: true, basket: true } } }, orderBy: { subject: { name: "asc" } } },
} satisfies Prisma.ClassSectionInclude;

export const gradeBands = async (db: Client): Promise<GradeBand[]> =>
  (await db.gradeBand.findMany({ orderBy: { min: "desc" } })).map((b) => ({ grade: b.grade, min: b.min, max: b.max, label: b.label, pass: b.pass }));

/** Live results for one class: each student's marks, total, average and rank, plus subject averages. */
export async function classResults(db: Client, examId: string, classId: string) {
  const [cls, roster, bands] = await Promise.all([
    db.classSection.findUniqueOrThrow({ where: { id: classId }, include: classInclude }),
    classRoster(db, classId),
    gradeBands(db),
  ]);
  const marks = await db.mark.findMany({
    where: { examId, studentId: { in: roster.map((s) => s.id) } },
    select: { studentId: true, subjectId: true, value: true, absent: true },
  });
  const byKey = new Map(marks.map((m) => [`${m.studentId}|${m.subjectId}`, m]));
  const rows = roster.map((s) => {
    const electives = new Set(s.subjects.map((x) => x.subjectId));
    const subjects = cls.subjects
      .filter((cs) => sitsSubject(cls.grade.level, cs.subject.basket, cs.subjectId, electives))
      .map((cs) => ({ subjectId: cs.subjectId, name: cs.subject.name, mark: markValue(byKey.get(`${s.id}|${cs.subjectId}`)) }));
    const { total, average } = summarizeMarks(subjects.map((x) => x.mark));
    return { student: s, subjects, total, average };
  });
  const subjectAverages: Record<string, number> = {};
  for (const cs of cls.subjects) {
    // Absent students don't pull a subject's class average down.
    const ms = rows.map((r) => r.subjects.find((x) => x.subjectId === cs.subjectId)?.mark).filter((m): m is number => typeof m === "number");
    subjectAverages[cs.subjectId] = ms.length ? Math.round((ms.reduce((a, b) => a + b, 0) / ms.length) * 10) / 10 : 0;
  }
  const ranked = rankByAverage(rows).map((r) => ({
    ...r,
    subjects: r.subjects.map((x): SubjectResult => ({ ...x, grade: gradeFor(x.mark, bands), classAverage: subjectAverages[x.subjectId] ?? 0 })),
  }));
  return { cls, rows: ranked, classSize: roster.length, bands };
}

/** Report-card status for several classes at once: approved/released are stored; otherwise draft once every mark sheet is submitted. */
export async function reportStatuses(db: Client, examId: string, classIds: string[]) {
  const [reports, subjects, sheets] = await Promise.all([
    db.classReport.findMany({ where: { examId, classId: { in: classIds } }, select: { classId: true, status: true } }),
    db.classSubject.groupBy({ by: ["classId"], where: { classId: { in: classIds } }, _count: { _all: true } }),
    db.markSheet.groupBy({ by: ["classId"], where: { examId, classId: { in: classIds }, submittedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const stored = new Map(reports.map((r) => [r.classId, r.status]));
  const total = new Map(subjects.map((s) => [s.classId, s._count._all]));
  const submitted = new Map(sheets.map((s) => [s.classId, s._count._all]));
  return new Map(
    classIds.map((id): [string, { status: ReportCardStatus; sheetsSubmitted: number; sheetsTotal: number }] => {
      const sheetsTotal = total.get(id) ?? 0;
      const sheetsSubmitted = submitted.get(id) ?? 0;
      const status = stored.get(id) ?? (sheetsSubmitted >= sheetsTotal ? "draft" : "pending_marks");
      return [id, { status, sheetsSubmitted, sheetsTotal }];
    }),
  );
}

export async function reportStatus(db: Client, examId: string, classId: string) {
  return (await reportStatuses(db, examId, [classId])).get(classId)!.status;
}

/** Freezes a class's results into its students' report cards (keeping their remarks). Run inside the approval transaction. */
export async function snapshotClass(db: Client, examId: string, classId: string) {
  const res = await classResults(db, examId, classId);
  if (!res.rows.length) return res;
  // Two statements for the whole class rather than one per student.
  await db.reportCard.createMany({ data: res.rows.map((r) => ({ examId, studentId: r.student.id })), skipDuplicates: true });
  const values = res.rows.map(
    (r) => Prisma.sql`(${r.student.id}, ${r.total}::numeric, ${r.average}::numeric, ${r.rank}::int, ${JSON.stringify(r.subjects)}::jsonb)`,
  );
  await db.$executeRaw`
    UPDATE "ReportCard" rc
    SET "classId" = ${classId}, "classSize" = ${res.classSize}, "total" = v.total, "average" = v.average, "rank" = v.rank, "subjects" = v.subjects
    FROM (VALUES ${Prisma.join(values)}) AS v("studentId", total, average, rank, subjects)
    WHERE rc."examId" = ${examId} AND rc."studentId" = v."studentId"`;
  return res;
}

/** Undoes `snapshotClass` when approval is reverted; remarks stay. */
export function clearSnapshot(db: Client, examId: string, classId: string) {
  return db.reportCard.updateMany({
    where: { examId, classId },
    data: { classId: null, total: null, average: null, rank: null, classSize: null, subjects: Prisma.DbNull },
  });
}

export interface ResultRow {
  student: { id: string; admissionNo: string; firstName: string; lastName: string };
  subjects: SubjectResult[];
  total: number;
  average: number;
  rank: number;
  classTeacherRemark?: string;
  principalRemark?: string;
}

/**
 * A class's results as its report cards show them: the frozen snapshot once approved, live otherwise.
 * Rows come back best rank first.
 */
export async function classReportRows(db: Client, examId: string, classId: string) {
  const status = await reportStatus(db, examId, classId);
  const cls = await db.classSection.findUniqueOrThrow({ where: { id: classId }, include: classInclude });
  if (status === "approved" || status === "released") {
    const cards = await db.reportCard.findMany({
      where: { examId, classId },
      include: { student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } } },
      orderBy: { rank: "asc" },
    });
    const rows = cards.map(
      (c): ResultRow => ({
        student: c.student,
        subjects: c.subjects as unknown as SubjectResult[],
        total: Number(c.total),
        average: Number(c.average),
        rank: c.rank!,
        ...(c.classTeacherRemark ? { classTeacherRemark: c.classTeacherRemark } : {}),
        ...(c.principalRemark ? { principalRemark: c.principalRemark } : {}),
      }),
    );
    return { status, cls, rows, classSize: cards[0]?.classSize ?? 0 };
  }
  const res = await classResults(db, examId, classId);
  const remarks = await db.reportCard.findMany({ where: { examId, studentId: { in: res.rows.map((r) => r.student.id) } } });
  const byStudent = new Map(remarks.map((r) => [r.studentId, r]));
  const rows = res.rows.map((r): ResultRow => {
    const card = byStudent.get(r.student.id);
    return {
      ...r,
      ...(card?.classTeacherRemark ? { classTeacherRemark: card.classTeacherRemark } : {}),
      ...(card?.principalRemark ? { principalRemark: card.principalRemark } : {}),
    };
  });
  return { status, cls, rows, classSize: res.classSize };
}

/** Present (or late) days out of the days the register was taken during the exam's term, up to today. */
async function termAttendance(db: Client, studentIds: string[], term: { startDate: Date; endDate: Date }) {
  const today = fromIsoDate(schoolToday());
  const upTo = term.endDate < today ? term.endDate : today;
  const rows = await db.attendanceRecord.groupBy({
    by: ["studentId", "status"],
    where: { studentId: { in: studentIds }, date: { gte: term.startDate, lte: upTo } },
    _count: { _all: true },
  });
  const out = new Map(studentIds.map((id) => [id, { present: 0, total: 0 }]));
  for (const r of rows) {
    const a = out.get(r.studentId)!;
    a.total += r._count._all;
    if (r.status === "present" || r.status === "late") a.present += r._count._all;
  }
  return out;
}

/** Full report cards for a class (for printing, or to pick one student's card from). */
export async function classReportCards(db: Client, examId: string, classId: string): Promise<ReportCard[]> {
  const [exam, school, { status, cls, rows, classSize }] = await Promise.all([
    db.exam.findUniqueOrThrow({ where: { id: examId }, include: { term: true } }),
    db.school.findUniqueOrThrow({ where: { id: "school" }, select: { name: true, motto: true, address: true, phone: true, principalName: true } }),
    classReportRows(db, examId, classId),
  ]);
  const attendance = await termAttendance(db, rows.map((r) => r.student.id), exam.term);
  return rows.map((r) => ({
    exam: toExam(exam),
    school,
    student: { id: r.student.id, admissionNo: r.student.admissionNo, fullName: fullName(r.student), classId: cls.id, className: cls.name, gradeName: cls.grade.name },
    status,
    subjects: r.subjects,
    total: r.total,
    average: r.average,
    rank: r.rank,
    classSize,
    attendance: attendance.get(r.student.id)!,
    ...(r.classTeacherRemark ? { classTeacherRemark: r.classTeacherRemark } : {}),
    ...(r.principalRemark ? { principalRemark: r.principalRemark } : {}),
    ...(cls.classTeacher ? { classTeacherName: cls.classTeacher.name } : {}),
  }));
}

/** The class a student's report card for an exam belongs to: the one it was frozen in, else their current class. */
export async function reportClassOf(db: Client, examId: string, student: { id: string; classId: string }) {
  const card = await db.reportCard.findUnique({ where: { examId_studentId: { examId, studentId: student.id } }, select: { classId: true } });
  return card?.classId ?? student.classId;
}
