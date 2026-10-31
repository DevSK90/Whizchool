import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, setToday, type Json } from "./helpers";

let subjects: Json[];
let classes: Json[];
const subject = (code: string) => subjects.find((s) => s.code === code);
const classNamed = (name: string) => classes.find((c) => c.name === name);

beforeAll(async () => {
  await resetData();
  await setToday("2026-10-23");
  await login("admin");
  subjects = await get("/subjects");
  classes = await get("/classes");
});

describe("the national curriculum", () => {
  it("has the official A/L subject numbers and the six streams", async () => {
    expect(subject("CMATH")).toMatchObject({ name: "Combined Mathematics", examNo: "10", levels: ["al"] });
    expect(subject("HISC")).toMatchObject({ name: "History of Sri Lanka & Modern World", examNo: "25C" });
    expect(subject("JAPA").examNo).toBe("87");
    expect(subject("CGT").examNo).toBe("12");

    const streams: Json[] = await get("/streams");
    expect(streams.map((s) => s.code).sort()).toEqual(["ART", "BS", "BT", "COM", "ET", "PS"]);
    expect(streams.find((s) => s.code === "PS").optionsRequired).toBe(1);
    expect(streams.find((s) => s.code === "ART").optionsRequired).toBe(3);

    // Physics is a must for Physical Science and a choice for Biological Science.
    const physics = subject("PHY");
    const id = (code: string) => streams.find((s) => s.code === code).id;
    expect(physics.streamIds).toEqual(expect.arrayContaining([id("PS"), id("BS")]));
    expect(physics.optionalStreamIds).toEqual([id("BS")]);
  });

  it("has the O/L core, choices and three baskets", () => {
    for (const code of ["ENG", "MAT", "SCI", "HIS"]) expect(subject(code).levels).toContain("ol");
    expect(subject("TML")).toMatchObject({ choiceGroup: "first_language" });
    expect(subject("BUD")).toMatchObject({ choiceGroup: "religion" });
    expect(subject("ENT").basket).toBe(1);
    expect(subject("DRAM").basket).toBe(2);
    expect(subject("MEDIA").basket).toBe(3);
    const inBasket = (n: number) => subjects.filter((s) => s.basket === n && s.levels.includes("ol")).length;
    expect([inBasket(1), inBasket(2), inBasket(3)]).toEqual([16, 11, 11]);
  });

  it("marks each class's subjects as compulsory or a choice", async () => {
    const ol = await get(`/classes/${classNamed("10-A").id}`);
    const group = (d: Json, name: string) => d.subjects.find((s: Json) => s.subjectName === name)?.optionGroup;
    expect(group(ol, "Mathematics")).toBeUndefined();
    expect(group(ol, "Sinhala")).toBe("first_language");
    expect(group(ol, "Buddhism")).toBe("religion");
    expect(group(ol, "Business & Accounting Studies")).toBe("basket1");
    expect(ol.pendingChoices).toBe(0);

    const ps = await get(`/classes/${classNamed("12-PS").id}`);
    expect(ps.optionsRequired).toBe(1);
    expect(group(ps, "Combined Mathematics")).toBeUndefined();
    expect(group(ps, "General English")).toBeUndefined();
    expect(group(ps, "Chemistry")).toBe("options");
    expect(group(ps, "Information & Communication Technology")).toBe("options");
  });
});

describe("a subject's teachers", () => {
  it("lists more than one teacher, and a class's teacher comes from the list", async () => {
    const sinhala = subject("SIN");
    expect(sinhala.teacherIds.length).toBeGreaterThan(1);

    const cs = (await get(`/classes/${classNamed("1-A").id}`)).subjects.find((s: Json) => s.subjectName === "Environmental Studies");
    const env = subject("ENV");
    const staff: Json[] = await get("/staff");
    const stranger = staff.find((s) => s.designation.startsWith("Teacher") && !env.teacherIds.includes(s.id));
    expect((await expectStatus(422, call("PUT", `/class-subjects/${cs.id}`, { teacherId: stranger.id }))).message).toMatch(/teacher list/);

    // On the list, they can be given it (when free at those times: clear the class's timetable out of the way first).
    const view = await get(`/classes/${classNamed("1-A").id}/timetable`);
    await call("PUT", `/classes/${classNamed("1-A").id}/timetable`, { revision: view.revision, blocks: [{ day: 1, start: 450, end: 455, kind: "activity", label: "Assembly" }] });
    await call("POST", `/classes/${classNamed("1-A").id}/timetable/publish`);
    const updated = await call("PUT", `/subjects/${env.id}`, { name: env.name, levels: env.levels, teacherIds: [...env.teacherIds, stranger.id] });
    expect(updated.teacherIds).toContain(stranger.id);
    await call("PUT", `/class-subjects/${cs.id}`, { teacherId: stranger.id });
    expect((await get(`/classes/${classNamed("1-A").id}`)).subjects.find((s: Json) => s.id === cs.id).teacherId).toBe(stranger.id);
  });

  it("keeps a teacher on the list while they teach it in a class", async () => {
    const env = (await get("/subjects")).find((s: Json) => s.code === "ENV");
    const teaching = (await get(`/classes/${classNamed("1-A").id}`)).subjects.find((s: Json) => s.subjectName === "Environmental Studies").teacherId;
    const others = env.teacherIds.filter((id: string) => id !== teaching);
    const refused = await expectStatus(409, call("PUT", `/subjects/${env.id}`, { name: env.name, levels: env.levels, teacherIds: others }));
    expect(refused.message).toContain("1-A");
    await expectStatus(422, call("PUT", `/subjects/${env.id}`, { name: env.name, levels: env.levels, teacherIds: [...env.teacherIds, "nobody"] }));
    // Leaving the list out changes nothing.
    const same = await call("PUT", `/subjects/${env.id}`, { name: env.name, levels: env.levels });
    expect(same.teacherIds.sort()).toEqual([...env.teacherIds].sort());
  });
});

describe("what a class offers", () => {
  it("adds subjects of its level or stream, and removes them until they're in use", async () => {
    const id = classNamed("11-B").id;
    const added = await call("POST", `/classes/${id}/subjects`, { subjectId: subject("DRAM").id });
    expect(added.optionGroup).toBe("basket2");
    await expectStatus(409, call("POST", `/classes/${id}/subjects`, { subjectId: subject("DRAM").id }));
    await expectStatus(422, call("POST", `/classes/${id}/subjects`, { subjectId: subject("CMATH").id }));
    await call("DELETE", `/class-subjects/${added.id}`);
    expect((await get(`/classes/${id}`)).subjects.some((s: Json) => s.id === added.id)).toBe(false);

    // Physics is only offered by the streams it belongs to.
    const commerce = classNamed("12-COM").id;
    await expectStatus(422, call("POST", `/classes/${commerce}/subjects`, { subjectId: subject("PHY").id }));
    const japanese = await call("POST", `/classes/${classNamed("12-ART").id}/subjects`, { subjectId: subject("JAPA").id });
    expect(japanese.optionGroup).toBe("options");

    const maths = (await get(`/classes/${id}`)).subjects.find((s: Json) => s.subjectName === "Mathematics");
    expect((await expectStatus(409, call("DELETE", `/class-subjects/${maths.id}`))).message).toMatch(/marks/);
    await login("teacher");
    await expectStatus(403, call("POST", `/classes/${id}/subjects`, { subjectId: subject("DRAM").id }));
    await login("admin");
  });

  it("starts a new class with what's compulsory and what its grade already offers", async () => {
    const streams: Json[] = await get("/streams");
    const created = await call("POST", "/classes", { gradeId: "grade_12", section: "PS2", streamId: streams.find((s) => s.code === "PS").id });
    const names = (await get(`/classes/${created.id}`)).subjects.map((s: Json) => s.subjectName).sort();
    expect(names).toEqual(["Chemistry", "Combined Mathematics", "Common General Test", "General English", "Information & Communication Technology", "Physics"]);
  });
});

describe("students' choices", () => {
  const studentIn = async (name: string) => (await get("/students", { classId: classNamed(name).id, pageSize: 5 })).items[0];
  const edit = async (id: string, electiveSubjectIds: string[]) => {
    const s = await get(`/students/${id}`);
    return call("PUT", `/students/${id}`, {
      firstName: s.firstName, lastName: s.lastName, gender: s.gender, dob: s.dob, address: s.address, religion: s.religion, medical: s.medical,
      classId: s.classId, electiveSubjectIds, discountIds: s.discountIds,
    });
  };

  it("takes three Commerce options and only those on mark sheets and report cards", async () => {
    const student = await studentIn("12-COM");
    const offered = (await get(`/classes/${classNamed("12-COM").id}`)).subjects;
    const options = offered.filter((s: Json) => s.optionGroup === "options");
    expect(options.length).toBeGreaterThan(3);
    await expectStatus(422, edit(student.id, options.slice(0, 4).map((s: Json) => s.subjectId)));

    const chosen = options.slice(0, 3);
    const left = options[3];
    await edit(student.id, [...chosen.map((s: Json) => s.subjectId), subject("PHY").id]);
    const detail = await get(`/students/${student.id}`);
    expect(detail.electiveSubjectIds.sort()).toEqual(chosen.map((s: Json) => s.subjectId).sort());
    const taken = detail.subjects.map((s: Json) => s.name);
    expect(taken).toContain(chosen[0].subjectName);
    expect(taken).toContain("General English");
    expect(taken).not.toContain(left.subjectName);

    const exam = (await get("/exams")).find((e: Json) => e.status === "marks_entry") ?? (await get("/exams")).at(-1);
    const sheet = (subjectId: string) => get(`/exams/${exam.id}/marks`, { classId: classNamed("12-COM").id, subjectId });
    const on = (await sheet(chosen[0].subjectId)).rows;
    const off = (await sheet(left.subjectId)).rows;
    expect(on.some((r: Json) => r.studentId === student.id)).toBe(true);
    expect(off.some((r: Json) => r.studentId === student.id)).toBe(false);
  });

  it("takes one from each O/L group, and counts who hasn't chosen", async () => {
    const student = await studentIn("10-B");
    const offered = (await get(`/classes/${classNamed("10-B").id}`)).subjects;
    const of = (g: string) => offered.filter((s: Json) => s.optionGroup === g).map((s: Json) => s.subjectId);
    const two = of("basket1").slice(0, 2);
    expect((await expectStatus(422, edit(student.id, two))).message).toMatch(/one subject/);
    const before = (await get(`/classes/${classNamed("10-B").id}`)).pendingChoices;
    await edit(student.id, [of("first_language")[0], of("religion")[0], of("basket1")[0], of("basket2")[0]]);
    expect((await get(`/classes/${classNamed("10-B").id}`)).pendingChoices).toBe(before + 1);
    await edit(student.id, [of("first_language")[0], of("religion")[0], of("basket1")[0], of("basket2")[0], of("basket3")[0]]);
    expect((await get(`/classes/${classNamed("10-B").id}`)).pendingChoices).toBe(before);
  });
});
