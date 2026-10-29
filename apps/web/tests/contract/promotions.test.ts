import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, setToday, type Json } from "./helpers";

beforeAll(async () => {
  await resetData();
  await setToday("2026-10-23");
});

const grade = (className: string) => parseInt(className, 10);

describe("year-end promotions", () => {
  let preview: Json;
  let plan: Json[];
  let repeater: Json;
  let leaver: Json;
  let graduate: Json;

  it("proposes moving everyone up a grade, with Grade 13 graduating", async () => {
    await login("admin");
    preview = await get("/promotions/preview");
    expect(preview.toYearName).toBe("2027");
    expect(preview.completed).toBeUndefined();
    const fiveA = preview.rows.find((r: Json) => r.fromClassName === "5-A");
    expect(fiveA).toMatchObject({ action: "promote", toClassId: "next_6a" });
    graduate = preview.rows.find((r: Json) => grade(r.fromClassName) === 13);
    expect(graduate.action).toBe("graduate");
    // Grade 11 students need an A/L stream chosen.
    expect(preview.rows.filter((r: Json) => grade(r.fromClassName) === 11).every((r: Json) => !r.toClassId)).toBe(true);
    await login("teacher");
    await expectStatus(403, get("/promotions/preview"));
  });

  it("refuses an incomplete or impossible plan", async () => {
    await login("admin");
    const unfinished = await expectStatus(422, call("POST", "/promotions/confirm", { rows: preview.rows }));
    expect(unfinished.message).toMatch(/need a target class/);
    const alClass = preview.targetClasses.find((c: Json) => c.gradeNumber === 12);
    plan = preview.rows.map((r: Json) => (grade(r.fromClassName) === 11 ? { ...r, toClassId: alClass.id } : r));
    const wrongGraduate = plan.map((r, i) => (i === 0 ? { ...r, action: "graduate", toClassId: undefined } : r));
    await expectStatus(422, call("POST", "/promotions/confirm", { rows: wrongGraduate }));
    await expectStatus(422, call("POST", "/promotions/confirm", { rows: plan.slice(1) }));
  });

  it("confirms the plan, which can be revised until the new year starts", async () => {
    repeater = plan.find((r) => r.fromClassName === "5-A");
    leaver = plan.find((r) => r.fromClassName === "8-A");
    plan = plan.map((r) =>
      r.studentId === repeater.studentId ? { ...r, action: "repeat", toClassId: "next_5a" } : r.studentId === leaver.studentId ? { ...r, action: "leave", toClassId: undefined } : r,
    );
    const first = await call("POST", "/promotions/confirm", { rows: plan });
    expect(first).toMatchObject({ repeated: 1, left: 1 });
    const saved = await get("/promotions/preview");
    expect(saved.completed).toMatchObject({ repeated: 1, left: 1, unplanned: 0, canStart: false });
    expect(saved.rows.find((r: Json) => r.studentId === repeater.studentId)).toMatchObject({ action: "repeat", toClassId: "next_5a" });
    expect(saved.rows.find((r: Json) => r.studentId === leaver.studentId).action).toBe("leave");
    // The new year doesn't start before this one ends.
    await expectStatus(409, call("POST", "/promotions/start"));

    // Changed their mind: the leaver stays on after all.
    plan = plan.map((r) => (r.studentId === leaver.studentId ? { ...r, action: "promote", toClassId: "next_9a" } : r));
    plan = plan.map((r) => (r.studentId === graduate.studentId ? { ...r, action: "leave" } : r));
    const revised = await call("POST", "/promotions/confirm", { rows: plan });
    expect(revised).toMatchObject({ repeated: 1, left: 1 });
    const years: Json[] = await get("/academic-years");
    expect(years.find((y) => y.name === "2027")).toMatchObject({ status: "upcoming" });
  });

  it("starts the new year: students move into their new classes", async () => {
    await setToday(preview.fromYear.endDate);
    const started = await call("POST", "/promotions/start");
    expect(started).toMatchObject({ year: "2027", left: 1 });
    await expectStatus(409, call("POST", "/promotions/start"));

    const years: Json[] = await get("/academic-years");
    expect(years.find((y) => y.name === "2027")?.status).toBe("active");
    expect(years.find((y) => y.name === "2026")?.status).toBe("closed");
    const classes: Json[] = await get("/classes");
    expect(classes.length).toBe(preview.targetClasses.length);
    expect(classes.every((c) => c.yearId !== preview.fromYear.id)).toBe(true);

    expect(await get(`/students/${repeater.studentId}`)).toMatchObject({ className: "5-A", status: "active" });
    expect(await get(`/students/${leaver.studentId}`)).toMatchObject({ className: "9-A", status: "active" });
    expect((await get(`/students/${graduate.studentId}`)).status).toBe("left");
    const terms: Json[] = await get("/terms");
    expect(terms.map((t) => t.startDate.slice(0, 4))).toEqual(["2027", "2027", "2027"]);
    // Fees carry over at last year's amounts.
    const fees: Json[] = await get("/fee-structures");
    expect(fees.length).toBeGreaterThan(0);
    expect(fees.every((f) => f.yearId !== preview.fromYear.id)).toBe(true);

    // Class teachers carry over to their class's next-year counterpart.
    const teacher = await login("teacher");
    expect(teacher.classIds.length).toBeGreaterThan(0);
    await login("admin");
    const next = await get("/promotions/preview");
    expect(next).toMatchObject({ toYearName: "2028" });
    expect(next.completed).toBeUndefined();
  });
});
