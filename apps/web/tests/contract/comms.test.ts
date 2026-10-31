import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, setToday, type Json } from "./helpers";

const FRIDAY = "2026-10-23";

beforeAll(async () => {
  await resetData();
  await setToday(FRIDAY);
});

describe("attendance", () => {
  it("shows each class's register state, scoped to the teacher's own class", async () => {
    await login("admin");
    const all = await get("/attendance/summary", { date: FRIDAY });
    expect(all.classes).toHaveLength(34);
    const teacher = await login("teacher");
    const mine = await get("/attendance/summary", { date: FRIDAY });
    expect(mine.classes.map((c: Json) => c.classId)).toEqual(teacher.classIds);
  });

  it("texts parents of students newly absent today, once", async () => {
    const teacher = await login("teacher");
    const classId = teacher.classIds[0];
    const sheet = await get("/attendance", { classId, date: FRIDAY });
    const [first, second] = sheet.records;
    const records = sheet.records.map((r: Json) => ({ studentId: r.studentId, status: r.studentId === first.studentId || r.studentId === second.studentId ? "absent" : "present" }));
    const firstSave = await call("PUT", "/attendance", { classId, date: FRIDAY, records });
    expect(firstSave).toMatchObject({ absent: 2, smsQueued: 2, total: sheet.records.length });
    // Saving again (or adding a late arrival) doesn't text the same parents twice.
    const again = await call("PUT", "/attendance", { classId, date: FRIDAY, records: records.map((r: Json, i: number) => (i === 5 ? { ...r, status: "late" } : r)) });
    expect(again).toMatchObject({ absent: 2, late: 1, smsQueued: 0 });

    const reread = await get("/attendance", { classId, date: FRIDAY });
    expect(reread.marked).toBe(true);
    expect(reread.records.filter((r: Json) => r.status === "absent")).toHaveLength(2);
  });

  it("doesn't text parents about an earlier day's register", async () => {
    const teacher = await login("teacher");
    const sheet = await get("/attendance", { classId: teacher.classIds[0], date: "2026-10-22" });
    const records = sheet.records.map((r: Json, i: number) => ({ studentId: r.studentId, status: i === 0 ? "absent" : "present" }));
    expect((await call("PUT", "/attendance", { classId: teacher.classIds[0], date: "2026-10-22", records })).smsQueued).toBe(0);
  });

  it("refuses weekends, future dates and other classes", async () => {
    const teacher = await login("teacher");
    const classId = teacher.classIds[0];
    await expectStatus(422, call("PUT", "/attendance", { classId, date: "2026-10-24", records: [] }));
    await expectStatus(422, call("PUT", "/attendance", { classId, date: "2026-10-26", records: [] }));
    const classes: Json[] = await get("/classes");
    await expectStatus(403, call("PUT", "/attendance", { classId: classes.find((c) => c.name === "1-A").id, date: FRIDAY, records: [] }));
    await login("parent");
    await expectStatus(403, get("/attendance/summary"));
  });
});

describe("messages", () => {
  it("previews an audience per channel and sends to it", async () => {
    await login("admin");
    const classes: Json[] = await get("/classes");
    const tenA = classes.find((c) => c.name === "10-A").id;
    const sms = await get("/messages/audience", { type: "class", ids: tenA, channel: "sms" });
    const email = await get("/messages/audience", { type: "class", ids: tenA, channel: "email" });
    expect(sms.label).toBe("Parents of 10-A");
    expect(sms.count).toBeGreaterThan(0);
    // Every guardian has a phone; not all have an email address.
    expect(email.count + email.unreachable).toBe(sms.count);

    const sent = await call("POST", "/messages", { channel: "sms", audience: { type: "class", ids: [tenA] }, body: "Sports meet on Friday. Please send your child in house colours." });
    expect(sent).toMatchObject({ channel: "sms", kind: "manual", recipients: sms.count, audience: { label: "Parents of 10-A" } });
    const list = await get("/messages", { channel: "sms", kind: "manual", pageSize: 50 });
    expect(list.items.map((m: Json) => m.id)).toContain(sent.id);
  });

  it("checks messages before sending: SMS length in parts, email subject, audience", async () => {
    await login("admin");
    // Sinhala SMS fit 67 characters per part: 201 is exactly 3 parts, 202 needs a fourth.
    const sinhala = "ප".repeat(202);
    const tooLong = await expectStatus(422, call("POST", "/messages", { channel: "sms", audience: { type: "all_parents" }, body: sinhala }));
    expect(tooLong.fields.body).toMatch(/4 SMS parts/);
    const noSubject = await expectStatus(422, call("POST", "/messages", { channel: "email", audience: { type: "all_staff" }, body: "Hello" }));
    expect(noSubject.fields.subject).toBeTruthy();
    await expectStatus(422, call("POST", "/messages", { channel: "sms", audience: { type: "class", ids: [] }, body: "Hi" }));
    await login("teacher");
    await expectStatus(403, call("POST", "/messages", { channel: "sms", audience: { type: "all_parents" }, body: "Hi" }));
  });
});

describe("notices", () => {
  it("publishes, edits and removes notices; parents only see theirs", async () => {
    await login("admin");
    const staffOnly = await call("POST", "/notices", { title: "Staff meeting", body: "Monday 2 pm in the library.", audience: "staff", pinned: false });
    const forParents = await call("POST", "/notices", { title: "Parents' day", body: "Saturday 9 am.", audience: "parents", pinned: true });
    const bad = await expectStatus(422, call("POST", "/notices", { title: "", body: "" }));
    expect(Object.keys(bad.fields).sort()).toEqual(["body", "title"]);

    const edited = await call("PUT", `/notices/${forParents.id}`, { title: "Parents' day (moved)", body: "Sunday 9 am.", audience: "parents", pinned: true });
    expect(edited.title).toBe("Parents' day (moved)");

    await login("parent");
    const seen: Json[] = await get("/notices");
    expect(seen[0].id).toBe(forParents.id);
    expect(seen.some((n) => n.id === staffOnly.id)).toBe(false);
    await expectStatus(403, call("DELETE", `/notices/${forParents.id}`));

    await login("admin");
    await call("DELETE", `/notices/${forParents.id}`);
    expect((await get("/notices")).some((n: Json) => n.id === forParents.id)).toBe(false);
  });
});
