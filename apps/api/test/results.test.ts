import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GRADE_BANDS } from "@whizchool/shared/grading";
import { setSchoolToday } from "../src/dates";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/http/rate-limit";
import { sentSms } from "../src/sms/sender";
import { sentEmails } from "../src/email/mailer";
import { signIn } from "./helpers";

const EXAM = "exam_2026_3";

beforeAll(() => setSchoolToday("2026-10-23"));
beforeEach(() => resetRateLimits());
afterAll(async () => {
  setSchoolToday(null);
  const admin = await signIn("admin@whizchool.lk");
  await admin.put("/api/v1/grade-bands").send({ bands: DEFAULT_GRADE_BANDS });
});

/** A class whose every mark sheet is in for the exam, ready for approval. */
async function draftClass() {
  const admin = await signIn("admin@whizchool.lk");
  const overview = await admin.get("/api/v1/report-cards/overview").query({ examId: EXAM });
  const cls = overview.body.find((c: { status: string }) => c.status === "draft");
  expect(cls, "a class in draft").toBeDefined();
  return { admin, classId: cls.classId as string };
}

describe("mark sheets", () => {
  it("limit subject teachers to their own sheets and check every mark", async () => {
    const teacher = await signIn("teacher@whizchool.lk");
    const progress = await teacher.get(`/api/v1/exams/${EXAM}/progress`);
    const mine = progress.body.sheets.find((s: { submitted: boolean }) => !s.submitted);
    const where = { classId: mine.classId, subjectId: mine.subjectId };
    const other = await prisma.classSubject.findFirstOrThrow({ where: { class: { yearId: "year_2026" }, id: { notIn: (await teacher.get("/api/v1/auth/me")).body.classSubjectIds } } });
    expect((await teacher.get(`/api/v1/exams/${EXAM}/marks`).query({ classId: other.classId, subjectId: other.subjectId })).status).toBe(403);
    expect((await teacher.put(`/api/v1/exams/${EXAM}/marks`).send({ classId: other.classId, subjectId: other.subjectId, marks: [] })).status).toBe(403);

    const sheet = await teacher.get(`/api/v1/exams/${EXAM}/marks`).query(where);
    const [a, b] = sheet.body.rows;
    const invalid = await teacher.put(`/api/v1/exams/${EXAM}/marks`).send({ ...where, marks: [{ studentId: a.studentId, mark: 101 }, { studentId: b.studentId, mark: 45.5 }] });
    expect(invalid.status).toBe(422);
    expect(Object.keys(invalid.body.error.fields).sort()).toEqual([a.studentId, b.studentId].sort());

    // Saving part of the sheet is fine; submitting needs every student.
    expect((await teacher.put(`/api/v1/exams/${EXAM}/marks`).send({ ...where, marks: [{ studentId: a.studentId, mark: "AB" }, { studentId: b.studentId, mark: 0 }] })).status).toBe(200);
    const saved = await prisma.mark.findUniqueOrThrow({ where: { examId_studentId_subjectId: { examId: EXAM, studentId: a.studentId, subjectId: mine.subjectId } } });
    expect(saved).toMatchObject({ absent: true, value: null });
    // Clearing a mark removes it.
    await teacher.put(`/api/v1/exams/${EXAM}/marks`).send({ ...where, marks: [{ studentId: b.studentId, mark: null }] });
    expect(await prisma.mark.count({ where: { examId: EXAM, studentId: b.studentId, subjectId: mine.subjectId } })).toBe(0);
    const incomplete = await teacher.put(`/api/v1/exams/${EXAM}/marks`).send({ ...where, submit: true, marks: [] });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.code).toBe("incomplete");
    expect((await teacher.get(`/api/v1/exams/${EXAM}/marks`).query(where)).body.submitted).toBe(false);
  });

  it("can't be changed once marks entry is closed", async () => {
    const admin = await signIn("admin@whizchool.lk");
    expect((await admin.put(`/api/v1/exams/${EXAM}/status`).send({ status: "review" })).status).toBe(200);
    const sheet = await prisma.classSubject.findFirstOrThrow({ where: { class: { yearId: "year_2026" } } });
    const res = await admin.put(`/api/v1/exams/${EXAM}/marks`).send({ classId: sheet.classId, subjectId: sheet.subjectId, marks: [] });
    expect(res.status).toBe(409);
    expect((await admin.put(`/api/v1/exams/${EXAM}/status`).send({ status: "marks_entry" })).status).toBe(200);
  });
});

describe("approval", () => {
  it("freezes results: later mark or grading changes don't touch approved cards", async () => {
    const { admin, classId } = await draftClass();
    const before = await admin.get("/api/v1/report-cards/batch").query({ examId: EXAM, classId });
    expect((await admin.post("/api/v1/report-cards/approve").send({ examId: EXAM, classId, force: true })).status).toBe(200);
    const top = before.body.find((c: { rank: number }) => c.rank === 1);
    const subject = top.subjects.find((s: { mark: unknown }) => typeof s.mark === "number");

    // Someone changes a mark behind the system's back, and the grading scale is edited.
    await prisma.mark.update({ where: { examId_studentId_subjectId: { examId: EXAM, studentId: top.student.id, subjectId: subject.subjectId } }, data: { value: 0, absent: false } });
    const stricter = DEFAULT_GRADE_BANDS.map((b) => (b.grade === "A" ? { ...b, min: 90 } : b.grade === "B" ? { ...b, max: 89 } : b));
    expect((await admin.put("/api/v1/grade-bands").send({ bands: stricter })).status).toBe(200);

    const frozen = await admin.get(`/api/v1/report-cards/${EXAM}/${top.student.id}`);
    expect(frozen.body).toMatchObject({ status: "approved", rank: 1, average: top.average, total: top.total });
    expect(frozen.body.subjects).toEqual(top.subjects);

    // Reverting goes back to the live marks and the current scale.
    expect((await admin.post("/api/v1/report-cards/revert").send({ examId: EXAM, classId })).status).toBe(200);
    const live = await admin.get(`/api/v1/report-cards/${EXAM}/${top.student.id}`);
    expect(live.body.status).toBe("draft");
    expect(live.body.average).toBeLessThan(top.average);
    expect(live.body.subjects.find((s: { subjectId: string }) => s.subjectId === subject.subjectId)).toMatchObject({ mark: 0, grade: "W" });
  });

  it("needs every sheet submitted and, unless forced, every remark", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const overview = await admin.get("/api/v1/report-cards/overview").query({ examId: EXAM });
    const pending = overview.body.find((c: { status: string }) => c.status === "pending_marks");
    expect((await admin.post("/api/v1/report-cards/approve").send({ examId: EXAM, classId: pending.classId })).body.error.code).toBe("incomplete");
    const { classId } = await draftClass();
    const res = await admin.post("/api/v1/report-cards/approve").send({ examId: EXAM, classId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("missing_remarks");
    expect(await prisma.classReport.count({ where: { examId: EXAM, classId } })).toBe(0);
    expect(await prisma.reportCard.count({ where: { examId: EXAM, classId } })).toBe(0);
  });

  it("keeps report cards to the class teacher's own class", async () => {
    const teacher = await signIn("teacher@whizchool.lk");
    const me = (await teacher.get("/api/v1/auth/me")).body;
    const overview = await teacher.get("/api/v1/report-cards/overview").query({ examId: EXAM });
    expect(overview.body.map((c: { classId: string }) => c.classId)).toEqual(me.classIds);
    const other = await prisma.classSection.findFirstOrThrow({ where: { yearId: "year_2026", id: { notIn: me.classIds } } });
    expect((await teacher.get("/api/v1/report-cards/batch").query({ examId: EXAM, classId: other.id })).status).toBe(403);
    expect((await teacher.post("/api/v1/report-cards/approve").send({ examId: EXAM, classId: me.classIds[0] })).status).toBe(403);
  });
});

describe("release", () => {
  it("tells each child's parent by email, or by SMS when there's no email address", async () => {
    const { admin, classId } = await draftClass();
    const parents = await prisma.student.findMany({
      where: { classId, status: "active" },
      select: { firstName: true, lastName: true, guardians: { orderBy: { position: "asc" }, take: 1, select: { guardian: { select: { email: true, phone: true } } } } },
    });
    const withEmail = parents.filter((p) => p.guardians[0]?.guardian.email).length;
    const [emails, texts] = [sentEmails.length, sentSms.length];
    await admin.post("/api/v1/report-cards/approve").send({ examId: EXAM, classId, force: true });
    const res = await admin.post("/api/v1/report-cards/release").send({ examId: EXAM, classId });
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(parents.length);
    expect(sentEmails.length - emails).toBe(withEmail);
    expect(sentSms.length - texts).toBe(parents.length - withEmail);
    const named = `${parents[0]!.firstName} ${parents[0]!.lastName}`;
    expect([...sentEmails.slice(emails).map((e) => e.text), ...sentSms.slice(texts).map((s) => s.text)].some((t) => t.includes(named))).toBe(true);
    expect((await admin.post("/api/v1/report-cards/revert").send({ examId: EXAM, classId })).status).toBe(409);
  });

  it("keeps a released card as issued when the student later changes class", async () => {
    const released = await prisma.classReport.findFirstOrThrow({ where: { status: "released", examId: "exam_2026_2" } });
    const card = await prisma.reportCard.findFirstOrThrow({ where: { examId: "exam_2026_2", classId: released.classId } });
    const elsewhere = await prisma.classSection.findFirstOrThrow({ where: { yearId: "year_2026", id: { not: released.classId } } });
    const student = await prisma.student.findUniqueOrThrow({ where: { id: card.studentId } });
    await prisma.student.update({ where: { id: student.id }, data: { classId: elsewhere.id } });
    try {
      const admin = await signIn("admin@whizchool.lk");
      const res = await admin.get(`/api/v1/report-cards/exam_2026_2/${student.id}`);
      expect(res.body).toMatchObject({ status: "released", rank: card.rank, student: { classId: released.classId } });
    } finally {
      await prisma.student.update({ where: { id: student.id }, data: { classId: student.classId } });
    }
  });
});
