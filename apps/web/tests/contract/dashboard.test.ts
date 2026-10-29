import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, setToday, type Json } from "./helpers";

const TODAY = "2026-10-23";

beforeAll(async () => {
  await resetData();
  await setToday(TODAY);
});

describe("staff dashboard", () => {
  it("adds up for the admin", async () => {
    await login("admin");
    const d = await get("/dashboard");
    expect(d.activeStudents).toBeGreaterThan(0);
    expect(d.enrollmentByLevel.map((l: Json) => l.level)).toEqual(["primary", "junior", "ol", "al"]);
    expect(d.enrollmentByLevel.reduce((s: number, l: Json) => s + l.count, 0)).toBe(d.activeStudents);
    expect(d.newStudentsThisYear).toBeLessThanOrEqual(d.activeStudents);
    expect(d.staffCount).toBeGreaterThan(0);

    const classes: Json[] = await get("/classes");
    expect(d.attendanceToday.totalClasses).toBe(classes.length);
    expect(d.attendanceToday.rate).toBeGreaterThan(0);
    expect(d.attendanceToday.rate).toBeLessThanOrEqual(100);
    const dates = d.attendanceTrend.map((t: Json) => t.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThanOrEqual(15);
    expect([...dates].sort()).toEqual(dates);
    expect(dates.at(-1)).toBe(TODAY);

    const fees = await get("/fees/summary");
    expect(d.fees).toEqual({ collectedThisMonth: fees.collectedThisMonth, outstanding: fees.outstanding });
    expect(d.feesMonthly).toEqual(fees.monthly);

    const submitted = d.recentApplications.map((a: Json) => a.submittedAt);
    expect(submitted.length).toBeLessThanOrEqual(5);
    expect([...submitted].sort().reverse()).toEqual(submitted);
    expect(d.pendingApplications).toBeGreaterThan(0);
    expect(d.pendingReportCards.every((r: Json) => r.status !== "released")).toBe(true);
  });

  it("counts a register as soon as it is marked", async () => {
    const before = await get("/dashboard");
    const summary = await get("/attendance/summary", { date: TODAY });
    const unmarked = summary.classes.find((c: Json) => !c.marked && c.total > 0);
    expect(unmarked, "the demo school leaves some registers unmarked today").toBeDefined();
    const sheet = await get("/attendance", { classId: unmarked.classId, date: TODAY });
    await call("PUT", "/attendance", { classId: unmarked.classId, date: TODAY, records: sheet.records.map((r: Json) => ({ studentId: r.studentId, status: "present" })) });
    const after = await get("/dashboard");
    expect(after.attendanceToday.marked).toBe(before.attendanceToday.marked + 1);
    expect(after.attendanceToday.rate).toBeGreaterThanOrEqual(before.attendanceToday.rate);
  });

  it("shows each role only what it may see", async () => {
    await login("teacher");
    const teacher = await get("/dashboard");
    expect(teacher.fees).toEqual({ collectedThisMonth: 0, outstanding: 0 });
    expect(teacher.feesMonthly).toEqual([]);
    expect(teacher.recentApplications).toEqual([]);
    expect(teacher.pendingApplications).toBe(0);
    const me = await get("/auth/me");
    expect(teacher.pendingReportCards.every((r: Json) => me.classIds.includes(r.classId))).toBe(true);

    await login("accountant");
    const accountant = await get("/dashboard");
    expect(accountant.feesMonthly).toHaveLength(10);
    expect(accountant.pendingReportCards).toEqual([]);

    await login("parent");
    await expectStatus(403, get("/dashboard"));
  });
});
