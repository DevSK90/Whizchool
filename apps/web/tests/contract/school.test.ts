import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, type Json } from "./helpers";

beforeAll(() => resetData());

describe("school profile", () => {
  it("is readable by anyone signed in and editable only with settings.edit", async () => {
    await login("teacher");
    const school = await get("/settings/school");
    expect(school).toMatchObject({ name: "Whizchool Demo College", currency: "LKR", currentYearId: "year_2026" });
    await expectStatus(403, call("PUT", "/settings/school", school));

    await login("admin");
    const bad = await expectStatus(422, call("PUT", "/settings/school", { ...school, name: " ", shortName: "", email: "nope", smsSenderId: "has space" }));
    expect(Object.keys(bad.fields).sort()).toEqual(["email", "name", "shortName", "smsSenderId"]);

    const saved = await call("PUT", "/settings/school", { ...school, motto: "Learn and lead", smsSenderId: "wdcschool", currentYearId: "ignored" });
    expect(saved).toMatchObject({ motto: "Learn and lead", smsSenderId: "WDCSCHOOL", currentYearId: "year_2026" });
    expect((await get("/public/school")).motto).toBe("Learn and lead");
  });
});

describe("academic calendar", () => {
  it("lists years and the current year's terms in order", async () => {
    await login("admin");
    const years: Json[] = await get("/academic-years");
    expect(years.find((y) => y.id === "year_2026")).toMatchObject({ status: "active", startDate: "2026-01-02", endDate: "2026-12-04" });
    const terms: Json[] = await get("/terms");
    expect(terms.map((t) => t.number)).toEqual([1, 2, 3]);
  });

  it("moves adjacent terms together and rejects overlaps or dates outside the year", async () => {
    await login("admin");
    const [t1, t2] = await get("/terms");
    // Term 1 ends later and Term 2 starts later: fine as one change, an overlap if applied one by one.
    const moved = await call("PUT", "/terms", {
      terms: [
        { id: t1.id, startDate: t1.startDate, endDate: "2026-04-24" },
        { id: t2.id, startDate: "2026-04-27", endDate: t2.endDate },
      ],
    });
    expect(moved.map((t: Json) => [t.endDate, t.startDate])).toEqual([
      ["2026-04-24", t1.startDate],
      [t2.endDate, "2026-04-27"],
      [moved[2].endDate, moved[2].startDate],
    ]);

    const overlap = await expectStatus(422, call("PUT", "/terms", { terms: [{ id: t2.id, startDate: "2026-04-20", endDate: t2.endDate }] }));
    expect(overlap.message).toMatch(/^Term 2: Must start after Term 1 ends/);
    await expectStatus(422, call("PUT", `/terms/${t1.id}`, { startDate: "2025-12-15", endDate: "2026-04-24" }));
    await expectStatus(422, call("PUT", `/terms/${t1.id}`, { startDate: "2026-03-01", endDate: "2026-02-01" }));
    await login("principal");
    await expectStatus(403, call("PUT", "/terms", { terms: [{ id: t1.id, startDate: t1.startDate, endDate: t1.endDate }] }));
  });
});

describe("subjects and grading", () => {
  it("adds and edits subjects with unique codes", async () => {
    await login("admin");
    const subjects: Json[] = await get("/subjects");
    expect(subjects.find((s) => s.code === "MAT")).toMatchObject({ name: "Mathematics", levels: ["primary", "junior", "ol"] });
    await expectStatus(409, call("POST", "/subjects", { name: "Maths again", code: "mat", levels: ["ol"] }));
    const bad = await expectStatus(422, call("POST", "/subjects", { name: "", code: "x1", levels: [] }));
    expect(Object.keys(bad.fields).sort()).toEqual(["code", "levels", "name"]);

    const dance = await call("POST", "/subjects", { name: "Dancing", code: "dan", levels: ["junior", "ol"], basket: 2 });
    expect(dance).toMatchObject({ code: "DAN", basket: 2 });
    const renamed = await call("PUT", `/subjects/${dance.id}`, { name: "Dance", levels: ["ol"], basket: "" });
    expect(renamed).toMatchObject({ name: "Dance", code: "DAN", levels: ["ol"] });
    expect(renamed.basket).toBeUndefined();
  });

  it("keeps the grading scale gap-free", async () => {
    await login("admin");
    const bands: Json[] = await get("/grade-bands");
    expect(bands.map((b) => b.grade)).toEqual(["A", "B", "C", "S", "W"]);
    const gap = bands.map((b) => (b.grade === "B" ? { ...b, min: 66 } : b));
    await expectStatus(422, call("PUT", "/grade-bands", { bands: gap }));
    await expectStatus(422, call("PUT", "/grade-bands", { bands: bands.map((b) => ({ ...b, grade: "A" })) }));
    const shifted = bands.map((b) => (b.grade === "A" ? { ...b, min: 80 } : b.grade === "B" ? { ...b, max: 79 } : b));
    expect((await call("PUT", "/grade-bands", { bands: shifted }))[0]).toMatchObject({ grade: "A", min: 80 });
    await call("PUT", "/grade-bands", { bands });
  });
});

describe("classes", () => {
  it("lists the current year's classes in grade order, for staff only", async () => {
    await login("teacher");
    const classes: Json[] = await get("/classes");
    expect(classes).toHaveLength(30);
    expect(classes[0]).toMatchObject({ name: "1-A", gradeNumber: 1 });
    expect(classes.find((c) => c.id === "cls_2026_10a")).toMatchObject({ classTeacherName: "Mr. Kasun Fernando" });
    await login("parent");
    await expectStatus(403, get("/classes"));
  });

  it("opens only classes a teacher teaches, and shows balances only to fee viewers", async () => {
    await login("teacher");
    const own = await get("/classes/cls_2026_10a");
    expect(own.subjects.length).toBeGreaterThan(5);
    expect(own.students.length).toBe(own.studentCount);
    expect(own.students.every((s: Json) => s.balance === 0)).toBe(true);
    await expectStatus(403, get("/classes/cls_2026_1a"));

    await login("accountant");
    const anyClass = await get("/classes/cls_2026_10a");
    expect(anyClass.students.some((s: Json) => s.balance > 0)).toBe(true);
  });

  it("creates classes with their subjects, a stream for A/L, and one class per class teacher", async () => {
    await login("admin");
    const staff: Json[] = await get("/staff");
    const classes: Json[] = await get("/classes");
    const leading = new Set(classes.map((c) => c.classTeacherId));
    const free = staff.find((s) => s.designation.startsWith("Teacher") && !leading.has(s.id));

    const junior = await call("POST", "/classes", { gradeId: "grade_8", section: "z", streamId: "", classTeacherId: free.id, room: " J8Z " });
    expect(junior).toMatchObject({ name: "8-Z", section: "Z", room: "J8Z", classTeacherId: free.id, studentCount: 0 });
    expect(junior.streamId).toBeUndefined();
    expect((await get(`/classes/${junior.id}`)).subjects).toHaveLength(12);

    await expectStatus(409, call("POST", "/classes", { gradeId: "grade_8", section: "Z" }));
    const busy = await expectStatus(409, call("POST", "/classes", { gradeId: "grade_9", section: "Z", classTeacherId: free.id }));
    expect(busy.fields.classTeacherId).toMatch(/8-Z/);

    expect((await expectStatus(422, call("POST", "/classes", { gradeId: "grade_12", section: "X" }))).fields.streamId).toBeTruthy();
    const streams: Json[] = await get("/streams");
    const commerce = streams.find((s) => s.code === "COM");
    const al = await call("POST", "/classes", { gradeId: "grade_12", section: "COM2", streamId: commerce.id });
    expect(al).toMatchObject({ name: "12-COM2", streamName: commerce.name });
    const alSubjects = (await get(`/classes/${al.id}`)).subjects.map((s: Json) => s.subjectName).sort();
    expect(alSubjects).toEqual(["Accounting", "Business Studies", "Economics", "General English"]);
  });

  it("changes class teachers and subject teachers", async () => {
    await login("admin");
    const detail = await get("/classes/cls_2026_7b");
    const staff: Json[] = await get("/staff");
    const maths = detail.subjects.find((s: Json) => s.subjectName === "Mathematics");
    // A teacher who's free whenever 7-B has Maths: a busy one is refused, see the timetables tests.
    const board = await get("/classes/cls_2026_7b/timetable");
    const lessons = (await get("/classes/cls_2026_7b/timetable", { version: "published" })).blocks.filter((b: Json) => b.classSubjectId === maths.id);
    const busy = new Set(board.busy.filter((b: Json) => lessons.some((m: Json) => m.day === b.day && m.start < b.end && b.start < m.end)).map((b: Json) => b.teacherId));
    const other = staff.find((s) => s.id !== maths.teacherId && s.designation.startsWith("Teacher") && !busy.has(s.id));
    await call("PUT", `/class-subjects/${maths.id}`, { teacherId: other.id });
    expect((await get("/classes/cls_2026_7b")).subjects.find((s: Json) => s.id === maths.id).teacherName).toBe(other.name);
    await expectStatus(422, call("PUT", `/class-subjects/${maths.id}`, { teacherId: "st_nope" }));

    const teacherOf10A = (await get("/classes/cls_2026_10a")).classTeacherId;
    await expectStatus(409, call("PUT", "/classes/cls_2026_7b", { classTeacherId: teacherOf10A, room: "" }));
    const cleared = await call("PUT", "/classes/cls_2026_7b", { classTeacherId: "", room: "Lab 2" });
    expect(cleared.classTeacherId).toBeUndefined();
    expect(cleared.room).toBe("Lab 2");
    await login("teacher");
    await expectStatus(403, call("PUT", "/classes/cls_2026_10a", { classTeacherId: "", room: "" }));
  });
});
