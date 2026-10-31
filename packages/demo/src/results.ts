// Result computations shared by exam, report-card, student and portal handlers.
import { sitsSubject } from "@whizchool/shared/curriculum";
import { gradeFor, rankByAverage, summarizeMarks } from "@whizchool/shared/grading";
import type { ClassSubject, MarkValue, ReportCardStatus, Student, Term } from "@whizchool/shared/types";
import type { DB } from "./db";

export function studentClassSubjects(db: DB, s: Student): ClassSubject[] {
  // What everyone takes, plus what they chose in the class's option groups.
  const electives = new Set(s.electiveSubjectIds);
  return db.classSubjects.rows.filter((cs) => cs.classId === s.classId && sitsSubject(cs.optionGroup, cs.subjectId, electives));
}

export function classRoster(db: DB, classId: string) {
  return db.students.rows
    .filter((s) => s.classId === classId && s.status === "active")
    .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
}

export function markOf(db: DB, examId: string, studentId: string, subjectId: string): MarkValue {
  return db.marks.get(`${examId}|${studentId}|${subjectId}`) ?? null;
}

export function marksComplete(db: DB, examId: string, classId: string) {
  return db.classSubjects.rows
    .filter((cs) => cs.classId === classId)
    .every((cs) => db.submittedSheets.has(`${examId}|${classId}|${cs.subjectId}`));
}

export function reportStatus(db: DB, examId: string, classId: string): ReportCardStatus {
  return db.reportStatus.get(`${examId}|${classId}`) ?? (marksComplete(db, examId, classId) ? "draft" : "pending_marks");
}

export function classResults(db: DB, examId: string, classId: string) {
  const roster = classRoster(db, classId);
  const rows = roster.map((s) => {
    const subjects = studentClassSubjects(db, s).map((cs) => ({
      subjectId: cs.subjectId,
      mark: markOf(db, examId, s.id, cs.subjectId),
    }));
    const { total, average } = summarizeMarks(subjects.map((x) => x.mark));
    return { student: s, subjects, total, average };
  });
  const ranked = rankByAverage(rows);
  const subjectAverages: Record<string, number> = {};
  for (const cs of db.classSubjects.rows.filter((x) => x.classId === classId)) {
    const ms = rows
      .map((r) => r.subjects.find((x) => x.subjectId === cs.subjectId)?.mark)
      .filter((m): m is number => typeof m === "number");
    subjectAverages[cs.subjectId] = ms.length ? Math.round((ms.reduce((a, b) => a + b, 0) / ms.length) * 10) / 10 : 0;
  }
  return { rows: ranked, classSize: roster.length, subjectAverages };
}

export function gradeCounts(db: DB, marks: MarkValue[]) {
  const counts: Record<string, number> = {};
  for (const m of marks) {
    const g = gradeFor(m, db.gradeBands);
    if (g !== "—") counts[g] = (counts[g] ?? 0) + 1;
  }
  return counts;
}

function hash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Attendance for a term: real records where they exist (Term 3), synthesized for earlier terms. */
export function termAttendance(db: DB, studentId: string, term: Term, upTo: string) {
  const student = db.students.get(studentId)!;
  if (term.number < 3) {
    const total = term.number === 1 ? 58 : 62;
    const absent = hash(studentId + term.id) % 6;
    return { present: total - absent, total };
  }
  let present = 0;
  let total = 0;
  for (const [key, day] of db.attendance) {
    const [classId, date] = key.split("|");
    if (classId !== student.classId || date < term.startDate || date > term.endDate || date > upTo) continue;
    total++;
    const st = day.exceptions[studentId];
    if (!st || st === "late") present++;
  }
  return { present, total };
}
