import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, setToday, type Json } from "./helpers";

const EXAM = "exam_2026_3";

beforeAll(async () => {
  await resetData();
  await setToday("2026-10-23");
});

describe("exams", () => {
  it("schedules one term test per term, inside the term", async () => {
    await login("admin");
    const terms: Json[] = await get("/terms");
    const term3 = terms.find((t) => t.number === 3);
    const bad = await expectStatus(422, call("POST", "/exams", { termId: term3.id, name: "", startDate: "2026-01-01", endDate: "2026-01-05" }));
    expect(Object.keys(bad.fields)).toEqual(expect.arrayContaining(["name"]));
    await expectStatus(422, call("POST", "/exams", { termId: term3.id, name: "Mock test", startDate: "2026-01-01", endDate: "2026-01-05" }));
    await expectStatus(409, call("POST", "/exams", { termId: term3.id, name: "Second test", startDate: term3.startDate, endDate: term3.startDate }));
    // A released exam can't be reopened.
    const exams: Json[] = await get("/exams");
    const released = exams.find((e) => e.status === "released");
    await expectStatus(409, call("PUT", `/exams/${released.id}/status`, { status: "marks_entry" }));
  });

  it("lets an administrator reopen a submitted sheet", async () => {
    await login("admin");
    const overview: Json[] = await get("/report-cards/overview", { examId: EXAM });
    const progress = await get(`/exams/${EXAM}/progress`);
    const open = new Set(overview.filter((c) => c.status === "draft" || c.status === "pending_marks").map((c) => c.classId));
    const sheet = progress.sheets.find((s: Json) => s.submitted && open.has(s.classId));
    const where = { classId: sheet.classId, subjectId: sheet.subjectId };

    await login("teacher");
    await expectStatus(403, call("POST", `/exams/${EXAM}/marks/unlock`, where));
    await login("admin");
    await call("POST", `/exams/${EXAM}/marks/unlock`, { ...where, reason: "Wrong paper marked" });
    const reopened = await get(`/exams/${EXAM}/marks`, where);
    expect(reopened).toMatchObject({ submitted: false, editable: true });
    // A mark for a student who isn't on the sheet is refused.
    await expectStatus(422, call("PUT", `/exams/${EXAM}/marks`, { ...where, marks: [{ studentId: "stu_nobody", mark: 50 }] }));
    await call("PUT", `/exams/${EXAM}/marks`, { ...where, submit: true, marks: reopened.rows.map((r: Json) => ({ studentId: r.studentId, mark: r.mark })) });
    expect((await get(`/exams/${EXAM}/marks`, where)).submitted).toBe(true);
  });
});

describe("report cards", () => {
  it("locks remarks and mark sheets once approved, until approval is reverted", async () => {
    await login("admin");
    const overview: Json[] = await get("/report-cards/overview", { examId: EXAM });
    const cls = overview.find((c) => c.status === "draft");
    expect(cls, "a class with every sheet submitted").toBeTruthy();
    const view = await get("/report-cards", { examId: EXAM, classId: cls.classId });
    const student = view.rows[0].studentId;
    await call("PUT", `/report-cards/${EXAM}/${student}/remarks`, { classTeacherRemark: "Works hard and helps others." });
    await expectStatus(422, call("PUT", `/report-cards/${EXAM}/${student}/remarks`, { classTeacherRemark: "x".repeat(301) }));

    await call("POST", "/report-cards/approve", { examId: EXAM, classId: cls.classId, force: true });
    await expectStatus(409, call("POST", "/report-cards/approve", { examId: EXAM, classId: cls.classId, force: true }));
    await expectStatus(409, call("PUT", `/report-cards/${EXAM}/${student}/remarks`, { classTeacherRemark: "Changed" }));
    const progress = await get(`/exams/${EXAM}/progress`);
    const sheet = progress.sheets.find((s: Json) => s.classId === cls.classId);
    await expectStatus(409, call("POST", `/exams/${EXAM}/marks/unlock`, { classId: cls.classId, subjectId: sheet.subjectId }));

    const card = await get(`/report-cards/${EXAM}/${student}`);
    expect(card).toMatchObject({ status: "approved", classTeacherRemark: "Works hard and helps others.", student: { id: student, classId: cls.classId } });
    expect(card.subjects.length).toBeGreaterThan(0);
    const approved = await get("/report-cards", { examId: EXAM, classId: cls.classId });
    expect(approved.rows.map((r: Json) => r.rank)).toEqual(view.rows.map((r: Json) => r.rank));

    await call("POST", "/report-cards/revert", { examId: EXAM, classId: cls.classId });
    await expectStatus(409, call("POST", "/report-cards/revert", { examId: EXAM, classId: cls.classId }));
    await call("PUT", `/report-cards/${EXAM}/${student}/remarks`, { classTeacherRemark: "Works hard." });
    expect((await get(`/report-cards/${EXAM}/${student}`)).status).toBe("draft");
  });

  it("shows parents released report cards only", async () => {
    await login("parent");
    const [child] = await get("/portal/children");
    const results = await get(`/students/${child.id}/results`);
    const unreleased = results.exams.find((e: Json) => !e.released);
    expect(unreleased.subjects).toBeUndefined();
    await expectStatus(404, get(`/report-cards/${unreleased.exam.id}/${child.id}`));
    const released = results.exams.filter((e: Json) => e.released).pop();
    const card = await get(`/report-cards/${released.exam.id}/${child.id}`);
    expect(card).toMatchObject({ status: "released", student: { id: child.id } });
    expect(child.latestExamName).toBe(released.exam.name);
  });
});
