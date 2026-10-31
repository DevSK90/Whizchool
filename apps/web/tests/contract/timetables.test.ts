import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, setToday, type Json } from "./helpers";

const toInput = (b: Json) => ({ day: b.day, start: b.start, end: b.end, kind: b.kind, classSubjectId: b.classSubjectId, label: b.label, room: b.room });
const lesson = (classSubjectId: string, day: number, start: number, end = start + 40, room?: string) => ({ day, start, end, kind: "lesson", classSubjectId, room });

let classes: Json[];
const classNamed = (name: string) => classes.find((c) => c.name === name);
const board = (id: string, version?: string) => get(`/classes/${id}/timetable`, { version });
async function save(id: string, blocks: Json[], revision?: number) {
  return call("PUT", `/classes/${id}/timetable`, { revision: revision ?? (await board(id, "draft")).revision, blocks });
}
const publish = (id: string) => call("POST", `/classes/${id}/timetable/publish`);
/** Adds a teacher to a subject's list, so a class can be given them. */
async function listTeacher(subjectId: string, teacherId: string) {
  const s = (await get("/subjects")).find((x: Json) => x.id === subjectId);
  await call("PUT", `/subjects/${subjectId}`, { name: s.name, levels: s.levels, basket: s.basket, choiceGroup: s.choiceGroup, examNo: s.examNo, teacherIds: [...s.teacherIds, teacherId] });
}

beforeAll(async () => {
  await resetData();
  await setToday("2026-10-23");
  await login("admin");
  classes = await get("/classes");
});

describe("what the school starts with", () => {
  it("has a clash-free week per class, with one class still a draft", async () => {
    const rows: Json[] = await get("/timetables/overview");
    expect(rows).toHaveLength(classes.length);
    expect(rows.every((r) => r.clashes === 0 && r.lessons > 0)).toBe(true);
    const draft = rows.find((r) => r.className === "8-B");
    expect(draft).toMatchObject({ publishedLessons: 0, hasUnpublishedChanges: true });
    expect(rows.find((r) => r.className === "10-A")).toMatchObject({ hasUnpublishedChanges: false });

    const view = await board(classNamed("10-A").id);
    expect(view).toMatchObject({ version: "draft", hours: { start: 450, end: 810 }, clashes: [] });
    expect(view.blocks.some((b: Json) => b.kind === "interval" && b.label === "Interval")).toBe(true);
    expect(view.busy.length).toBeGreaterThan(0);
    expect(view.busy.every((b: Json) => b.classId !== view.classId)).toBe(true);
  });
});

describe("saving a board", () => {
  it("refuses blocks that don't fit, and a save over someone else's", async () => {
    const id = classNamed("8-A").id;
    const view = await board(id);
    const [a, b] = view.subjects;
    const refused = async (blocks: Json[], message: RegExp) => expect((await expectStatus(422, save(id, blocks, view.revision))).message).toMatch(message);
    await refused([lesson(a.id, 6, 480)], /weekday/);
    await refused([lesson(a.id, 1, 482)], /5-minute/);
    await refused([lesson(a.id, 1, 480, 480)], /after the start/);
    await refused([lesson(a.id, 1, 420)], /within the school day/);
    await refused([lesson(a.id, 1, 790)], /within the school day/);
    await refused([lesson("nope", 1, 480)], /this class's subjects/);
    await refused([{ day: 1, start: 480, end: 490, kind: "activity" }], /name/);
    await refused([lesson(a.id, 1, 480), lesson(b.id, 1, 500)], /overlaps/);

    await expectStatus(409, save(id, [lesson(a.id, 1, 480)], view.revision + 5));
    const saved = await save(id, [lesson(a.id, 1, 480)], view.revision);
    expect(saved.revision).toBe(view.revision + 1);
    expect(saved.savedBy).toBeTruthy();
    expect(saved.hasUnpublishedChanges).toBe(true);
    // The other person's tab, still holding the old revision.
    await expectStatus(409, save(id, [lesson(b.id, 1, 480)], view.revision));
  });

  it("lets subjects of one choice run side by side, and nothing else", async () => {
    const id = classNamed("10-B").id;
    const view = await board(id);
    const basket1 = view.subjects.filter((s: Json) => s.optionGroup === "basket1");
    const basket2 = view.subjects.find((s: Json) => s.optionGroup === "basket2");
    const core = view.subjects.find((s: Json) => s.optionGroup === undefined);
    expect(basket1.length).toBeGreaterThan(1);
    const together = await save(id, basket1.map((s: Json) => lesson(s.id, 2, 540)));
    expect(together.blocks).toHaveLength(basket1.length);
    await expectStatus(422, save(id, [lesson(basket1[0].id, 2, 540), lesson(basket2.id, 2, 540)]));
    await expectStatus(422, save(id, [lesson(basket1[0].id, 2, 540), lesson(core.id, 2, 540)]));
    await expectStatus(422, save(id, [lesson(basket1[0].id, 2, 540), lesson(basket1[0].id, 2, 540)]));
  });
});

describe("clashes and publishing", () => {
  /** A subject of `id` and a time its teacher is teaching elsewhere in a published timetable. */
  async function busyTeacherSlot(id: string) {
    const view = await board(id);
    const subject = view.subjects.find((s: Json) => s.teacherId && view.busy.some((b: Json) => b.teacherId === s.teacherId && b.version === "published"));
    const other = view.busy.find((b: Json) => b.teacherId === subject.teacherId && b.version === "published");
    return { view, subject, other };
  }

  it("flags a teacher clash in the draft and refuses to publish it", async () => {
    const id = classNamed("8-B").id;
    const { subject, other } = await busyTeacherSlot(id);
    const saved = await save(id, [lesson(subject.id, other.day, other.start, other.end)]);
    expect(saved.clashes).toHaveLength(1);
    expect(saved.clashes[0]).toMatchObject({ kind: "teacher", source: "published", otherClassName: other.className });
    expect(saved.clashes[0].message).toContain(other.className);
    expect((await get("/timetables/overview")).find((r: Json) => r.classId === id).clashes).toBe(1);

    const refused = await expectStatus(409, publish(id));
    expect(refused.message).toContain(other.className);

    // A slot the teacher is free in.
    const taken = (s: number) => saved.busy.some((b: Json) => b.teacherId === subject.teacherId && b.day === 1 && b.start < s + 5 && s < b.end) || saved.busy.some((b: Json) => b.room === saved.room && b.day === 1 && b.start < s + 5 && s < b.end);
    const free = Array.from({ length: 72 }, (_, i) => 450 + i * 5).find((s) => !taken(s))!;
    const fixed = await save(id, [lesson(subject.id, 1, free, free + 5)]);
    expect(fixed.clashes).toEqual([]);
    const live = await publish(id);
    expect(live).toMatchObject({ hasUnpublishedChanges: false, publishedBy: expect.any(String) });
  });

  it("flags two classes using one room", async () => {
    const a = await board(classNamed("9-A").id);
    const b = await board(classNamed("9-B").id);
    // Nothing else in the school is on before the first lessons, so only the room can clash.
    await save(a.classId, [lesson(a.subjects[0].id, 1, 450, 455, "Science Lab")]);
    await publish(a.classId);
    const saved = await save(b.classId, [lesson(b.subjects[0].id, 1, 450, 455, "science lab")]);
    expect(saved.clashes.map((c: Json) => [c.kind, c.otherClassName])).toContainEqual(["room", "9-A"]);
    await expectStatus(409, publish(b.classId));
  });

  it("treats the same teacher, subject and grade at once as one combined lesson", async () => {
    const a = await board(classNamed("11-A").id);
    const b = await board(classNamed("11-B").id);
    const subjectA = a.subjects.find((s: Json) => s.optionGroup === "basket2");
    const subjectB = b.subjects.find((s: Json) => s.subjectId === subjectA.subjectId);
    const otherSubject = b.subjects.find((s: Json) => s.optionGroup === "basket3");
    await save(a.classId, [lesson(subjectA.id, 1, 450, 455)]);
    await save(b.classId, [lesson(subjectB.id, 1, 450, 455)]);
    await publish(a.classId);
    await publish(b.classId);
    await listTeacher(subjectB.subjectId, subjectA.teacherId);
    await call("PUT", `/class-subjects/${subjectB.id}`, { teacherId: subjectA.teacherId });
    expect((await board(b.classId)).clashes).toEqual([]);

    // Sharing a room as well, since it's the same lesson.
    await save(a.classId, [lesson(subjectA.id, 1, 450, 455, "Art room")]);
    const shared = await save(b.classId, [lesson(subjectB.id, 1, 450, 455, "Art room")]);
    expect(shared.clashes).toEqual([]);
    await publish(a.classId);
    expect((await publish(b.classId)).hasUnpublishedChanges).toBe(false);

    // A different subject at that time is a real clash.
    await listTeacher(otherSubject.subjectId, subjectA.teacherId);
    await call("PUT", `/class-subjects/${otherSubject.id}`, { teacherId: subjectA.teacherId });
    const different = await save(b.classId, [lesson(otherSubject.id, 1, 450, 455)]);
    expect(different.clashes.map((c: Json) => c.kind)).toContain("teacher");
  });

  describe("from a clean school", () => {
    beforeAll(async () => {
      await resetData();
      await setToday("2026-10-23");
      await login("admin");
    });

  it("keeps the published version until the draft is published, and publishes all that can go", async () => {
    const id = classNamed("6-A").id;
    const before = await board(id, "published");
    expect(before.blocks.length).toBeGreaterThan(0);
    const draft = await board(id);
    await save(id, draft.blocks.slice(0, 3).map(toInput));
    expect((await board(id, "published")).blocks).toHaveLength(before.blocks.length);
    expect((await board(id)).blocks).toHaveLength(3);

    const result = await call("POST", "/timetables/publish");
    expect(result.published.some((p: Json) => p.classId === id)).toBe(true);
    expect((await board(id, "published")).blocks).toHaveLength(3);
    expect((await board(id)).hasUnpublishedChanges).toBe(false);
    expect(result.blocked).toEqual([]);
  });

  it("holds back both classes when two drafts clash with each other", async () => {
    const a = await board(classNamed("12-SCI")?.id ?? classNamed("9-A").id);
    const b = await board(classNamed("7-A").id);
    const subject = a.subjects.find((s: Json) => s.teacherId);
    const other = b.subjects.find((s: Json) => s.teacherId && s.teacherId !== subject.teacherId);
    // Live at different times, with one teacher between them.
    await save(a.classId, [lesson(subject.id, 1, 450, 455)]);
    await save(b.classId, [lesson(other.id, 1, 455, 460)]);
    await publish(a.classId);
    await publish(b.classId);
    await listTeacher(other.subjectId, subject.teacherId);
    await call("PUT", `/class-subjects/${other.id}`, { teacherId: subject.teacherId });

    // Both drafts move onto the same time.
    await save(a.classId, [lesson(subject.id, 1, 455, 460)]);
    const result = await call("POST", "/timetables/publish");
    expect(result.blocked.map((x: Json) => x.classId)).toEqual([a.classId]);
    await save(b.classId, [lesson(other.id, 1, 450, 455)]);
    const both = await call("POST", "/timetables/publish");
    expect(both.blocked).toEqual([]);
    expect(both.published.map((x: Json) => x.classId).sort()).toEqual([a.classId, b.classId].sort());

    await save(a.classId, [lesson(subject.id, 1, 450, 455)]);
    await save(b.classId, [lesson(other.id, 1, 450, 455)]);
    const clashing = await call("POST", "/timetables/publish");
    expect(clashing.blocked.map((x: Json) => x.classId).sort()).toEqual([a.classId, b.classId].sort());
    expect(clashing.published).toEqual([]);
  });

  it("refuses a new teacher who is busy then, and school hours that leave blocks out", async () => {
    const id = classNamed("9-B").id;
    const view = await board(id, "published");
    const live = await board(id);
    const taught = view.blocks.find((b: Json) => b.kind === "lesson" && b.teacherId);
    const elsewhere = live.busy.find((b: Json) => b.version === "published" && b.teacherId && b.teacherId !== taught.teacherId && b.day === taught.day && b.start < taught.end && taught.start < b.end);
    expect(elsewhere).toBeDefined();
    await listTeacher(taught.subjectId, elsewhere.teacherId);
    const refused = await expectStatus(409, call("PUT", `/class-subjects/${taught.classSubjectId}`, { teacherId: elsewhere.teacherId }));
    expect(refused.message).toContain(elsewhere.className);

    const school = await get("/settings/school");
    await expectStatus(409, call("PUT", "/settings/school", { ...school, timetableEnd: 720 }));
    await expectStatus(422, call("PUT", "/settings/school", { ...school, timetableEnd: 400 }));
    const later = await call("PUT", "/settings/school", { ...school, timetableEnd: 840 });
    expect(later.timetableEnd).toBe(840);
    await call("PUT", "/settings/school", { ...school });
  });
  });
});

describe("who sees what", () => {
  it("shows teachers their published week and only their classes", async () => {
    const session = await login("teacher");
    const week = await get("/timetables/me");
    expect(week.staffName).toBeTruthy();
    expect(week.blocks.length).toBeGreaterThan(0);
    expect(week.blocks.every((b: Json) => b.kind === "lesson" && b.className && b.teacherId === week.staffId)).toBe(true);
    const sorted = [...week.blocks].sort((a: Json, b: Json) => a.day - b.day || a.start - b.start);
    expect(week.blocks.map((b: Json) => b.id)).toEqual(sorted.map((b: Json) => b.id));

    const own = session.classIds[0];
    expect((await board(own)).version).toBe("published");
    await expectStatus(403, board(own, "draft"));
    await expectStatus(403, call("PUT", `/classes/${own}/timetable`, { revision: 0, blocks: [] }));
    await expectStatus(403, call("POST", `/classes/${own}/timetable/publish`));
    await expectStatus(403, call("POST", "/timetables/publish"));
    const rows: Json[] = await get("/timetables/overview");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(classes.length);
    expect(rows.every((r) => r.clashes === 0 && !r.hasUnpublishedChanges)).toBe(true);
    const notMine = classes.find((c) => !rows.some((r) => r.classId === c.id));
    await expectStatus(403, board(notMine.id));
    await expectStatus(403, get(`/staff/${week.staffId}/timetable`));
  });

  it("lets staff with full scope look up a teacher, and keeps others out", async () => {
    await login("teacher");
    const { staffId } = await get("/timetables/me");
    await login("principal");
    expect((await get(`/staff/${staffId}/timetable`)).staffId).toBe(staffId);
    await expectStatus(404, get("/staff/nobody/timetable"));
    await login("accountant");
    await expectStatus(403, get("/timetables/overview"));
    await expectStatus(403, get("/timetables/me"));
    await expectStatus(403, board(classNamed("10-A").id));
  });

  it("shows parents their own children's published week, with only the electives they take", async () => {
    await login("admin");
    const published = await board(classNamed("10-A").id, "published");
    const basket = published.blocks.filter((b: Json) => b.optionGroup != null);
    expect(basket.length).toBeGreaterThan(0);

    await login("parent");
    const children: Json[] = await get("/portal/children");
    const kavindu = children.find((c) => c.className === "10-A");
    const week = await get(`/students/${kavindu.id}/timetable`);
    expect(week).toMatchObject({ className: "10-A", hours: { start: 450, end: 810 } });
    expect(week.blocks.some((b: Json) => b.kind === "interval")).toBe(true);
    const lessons = week.blocks.filter((b: Json) => b.optionGroup != null);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.length).toBeLessThan(basket.length);
    // Within a choice's slot the child has exactly one subject.
    const slots = new Set(lessons.map((b: Json) => `${b.day}|${b.start}`));
    expect(slots.size).toBe(lessons.length);

    await expectStatus(403, board(classNamed("10-A").id));
    await expectStatus(403, get("/timetables/me"));
    await login("admin");
    const stranger = (await get("/students", { classId: classNamed("9-A").id, pageSize: 5 })).items[0];
    await login("parent");
    await expectStatus(403, get(`/students/${stranger.id}/timetable`));
  });
});
