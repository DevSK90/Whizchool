import { beforeAll, describe, expect, it } from "vitest";
import { get, login, resetData, setToday, type Json } from "./helpers";

// Friday 23 October 2026: a school day with the register taken.
const TODAY = "2026-10-23";

let children: Json[];

beforeAll(async () => {
  await resetData();
  await setToday(TODAY);
  await login("parent");
  children = await get("/portal/children");
});

describe("the parent portal home", () => {
  it("names each child's class teacher", () => {
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) expect(c.classTeacherName).toEqual(expect.any(String));
  });

  it("matches the child's own attendance: days absent and today's mark", async () => {
    for (const c of children) {
      const a = await get(`/students/${c.id}/attendance`);
      expect(c.absentDays).toBe(a.absent);
      expect(c.todayAttendance).toBe(a.days.find((d: Json) => d.date === TODAY)?.status);
    }
  });

  it("links the latest released result to its report card, with when it was released", async () => {
    for (const c of children) {
      const latest = (await get(`/students/${c.id}/results`)).exams.filter((e: Json) => e.released && e.average !== undefined).pop();
      expect(c.latestExamId).toBe(latest.exam.id);
      // Report cards are released after the test ends.
      expect(Date.parse(c.latestReleasedAt)).toBeGreaterThan(Date.parse(`${latest.exam.endDate}T00:00:00Z`));
      expect((await get(`/report-cards/${c.latestExamId}/${c.id}`)).status).toBe("released");
    }
  });

  it("splits what's owed into overdue and the next amount due", async () => {
    for (const c of children) {
      const open = (await get(`/students/${c.id}/invoices`)).filter((i: Json) => i.balance > 0 && i.status !== "void");
      const sum = (rows: Json[]) => rows.reduce((n, i) => n + i.balance, 0);
      expect(c.overdue).toBe(sum(open.filter((i: Json) => i.dueDate < TODAY)));
      const upcoming = open.filter((i: Json) => i.dueDate >= TODAY);
      const next = upcoming.map((i: Json) => i.dueDate).sort()[0];
      if (next) expect(c.nextDue).toEqual({ amount: sum(upcoming.filter((i: Json) => i.dueDate === next)), dueDate: next });
      else expect(c.nextDue).toBeUndefined();
    }
  });
});
