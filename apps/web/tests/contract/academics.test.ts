import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, type Json } from "./helpers";

beforeAll(() => resetData());

const EXAM = "exam_2026_3";

describe("attendance and results: marks → approve → release → parent", () => {
  let classId: string;

  it("lets the class teacher mark attendance for their own class only", async () => {
    const teacher = await login("teacher");
    classId = teacher.classIds[0];
    const sheet = await get("/attendance", { classId, date: "2026-10-23" });
    const records = sheet.records.map((r: Json, i: number) => ({ studentId: r.studentId, status: i < 2 ? "absent" : "present" }));
    const saved = await call("PUT", "/attendance", { classId, date: "2026-10-23", records });
    expect(saved.absent).toBe(2);
    expect(saved.smsQueued).toBeGreaterThan(0);
    const classes: Json[] = await get("/classes");
    await expectStatus(403, get("/attendance", { classId: classes.find((c) => c.name === "1-A").id }));
  });

  it("validates marks and locks a sheet once submitted", async () => {
    const progress = await get(`/exams/${EXAM}/progress`);
    const sheet = progress.sheets.find((s: Json) => !s.submitted);
    const where = { classId: sheet.classId, subjectId: sheet.subjectId };
    const marks = await get(`/exams/${EXAM}/marks`, where);
    const first = marks.rows[0].studentId;
    await expectStatus(422, call("PUT", `/exams/${EXAM}/marks`, { ...where, marks: [{ studentId: first, mark: 120 }] }));
    await call("PUT", `/exams/${EXAM}/marks`, {
      ...where,
      submit: true,
      marks: marks.rows.map((r: Json, i: number) => ({ studentId: r.studentId, mark: i === 0 ? "AB" : 40 + (i % 50) })),
    });
    await expectStatus(409, call("PUT", `/exams/${EXAM}/marks`, { ...where, marks: [{ studentId: first, mark: 50 }] }));
    await expectStatus(403, call("POST", "/report-cards/approve", { examId: EXAM, classId }));
  });

  it("approves and releases report cards, then batch prints them", async () => {
    await login("admin");
    const progress = await get(`/exams/${EXAM}/progress`);
    for (const s of progress.sheets.filter((x: Json) => x.classId === classId && !x.submitted)) {
      const where = { classId: s.classId, subjectId: s.subjectId };
      const sh = await get(`/exams/${EXAM}/marks`, where);
      await call("PUT", `/exams/${EXAM}/marks`, { ...where, submit: true, marks: sh.rows.map((r: Json) => ({ studentId: r.studentId, mark: r.mark ?? 55 })) });
    }
    await login("principal");
    // Missing class-teacher remarks block approval unless forced.
    await expectStatus(409, call("POST", "/report-cards/approve", { examId: EXAM, classId }));
    await call("POST", "/report-cards/approve", { examId: EXAM, classId, force: true });
    const released = await call("POST", "/report-cards/release", { examId: EXAM, classId });
    expect(released.notified).toBeGreaterThan(0);

    const batch: Json[] = await get("/report-cards/batch", { examId: EXAM, classId });
    const overview = await get("/report-cards", { examId: EXAM, classId });
    expect(batch).toHaveLength(overview.rows.length);
    expect(Math.min(...batch.map((c) => c.rank))).toBe(1);
    expect(batch.every((c) => c.classSize === batch.length)).toBe(true);
  });

  it("shows parents released results only for their own children", async () => {
    await login("parent");
    const [child] = await get("/portal/children");
    const results = await get(`/students/${child.id}/results`);
    expect(results.exams.length).toBeGreaterThan(0);
    await expectStatus(403, get("/report-cards/batch", { examId: EXAM, classId }));
  });
});
