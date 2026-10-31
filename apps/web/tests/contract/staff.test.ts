import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, setToday, type Json } from "./helpers";

const stamp = Date.now().toString(36);
const record = (over: Json = {}) => ({
  title: "Mrs.",
  name: "Sandya Rathnayake",
  staffType: "non_academic",
  designation: "Lab Assistant",
  phone: "0771234567",
  joinedOn: "2026-01-05",
  ...over,
});
const directory = (query: Json = {}) => get("/staff/directory", { pageSize: 100, ...query });

beforeAll(async () => {
  await resetData();
  await setToday("2026-10-23");
  await login("admin");
});

describe("who can see staff records", () => {
  it("keeps private details from people without staff.view", async () => {
    await login("teacher");
    await expectStatus(403, get("/staff/directory"));
    const colleagues: Json[] = await get("/staff");
    await expectStatus(403, get(`/staff/${colleagues[0].id}`));
    await expectStatus(403, call("POST", "/staff", record()));
    for (const field of ["nic", "dob", "address", "emergencyPhone", "qualifications", "notes", "gender"]) {
      expect(colleagues.some((c) => field in c)).toBe(false);
    }
    expect(colleagues[0]).toMatchObject({ name: expect.any(String), designation: expect.any(String) });
    await login("accountant");
    await expectStatus(403, get("/staff/directory"));
    await login("principal");
    expect((await directory()).total).toBeGreaterThan(0);
    await login("admin");
  });
});

describe("the staff list", () => {
  it("has academic and non-academic staff, with and without logins", async () => {
    const academic = await directory({ type: "academic" });
    const others = await directory({ type: "non_academic" });
    expect(academic.total).toBeGreaterThan(0);
    expect(others.items.every((s: Json) => s.staffType === "non_academic")).toBe(true);
    const cleaner = others.items.find((s: Json) => s.designation === "Cleaner");
    expect(cleaner.userId).toBeUndefined();
    expect(cleaner.email).toBeUndefined();
    expect((await get(`/staff/${cleaner.id}`)).loginStatus).toBeUndefined();
    expect((await directory({ search: cleaner.empNo })).items.map((s: Json) => s.id)).toEqual([cleaner.id]);
    expect((await directory({ search: "cLEaner" })).items.map((s: Json) => s.id)).toEqual([cleaner.id]);
    const names = (await directory({ sort: "-name" })).items.map((s: Json) => s.name);
    expect(names.length).toBeGreaterThan(1);
    expect(names[0].localeCompare(names.at(-1))).toBeGreaterThan(0);
  });

  it("shows what a teacher teaches and the full record", async () => {
    const teacher = (await directory({ search: "Kasun" })).items[0];
    const detail = await get(`/staff/${teacher.id}`);
    expect(detail.staffType).toBe("academic");
    expect(detail.loginStatus).toBe("active");
    expect(detail.teaching.length).toBeGreaterThan(0);
    expect(detail.subjects).toContain("Mathematics");
    expect(detail.nic).toEqual(expect.any(String));
    expect(detail.joinedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("adding and editing", () => {
  it("records someone with no email and no login, giving them the next number", async () => {
    const before = (await directory({ status: "all" })).total;
    const { id } = await call("POST", "/staff", record({ phone: "+94 77 123 4567", nic: "851234567v", dob: "1985-02-03", gender: "F", address: "5, Lake Rd", qualifications: "NVQ 4", emergencyName: "Mr. Rathnayake", emergencyPhone: "0112345678", notes: "Mornings" }));
    const s = await get(`/staff/${id}`);
    expect(s).toMatchObject({
      title: "Mrs.", name: "Mrs. Sandya Rathnayake", staffType: "non_academic", designation: "Lab Assistant", phone: "077 123 4567", status: "active", nic: "851234567V",
      dob: "1985-02-03", gender: "F", joinedOn: "2026-01-05", address: "5, Lake Rd", qualifications: "NVQ 4", emergencyName: "Mr. Rathnayake", emergencyPhone: "011 234 5678", notes: "Mornings",
    });
    expect(s.empNo).toMatch(/^EMP\d{3,}$/);
    expect(s.userId).toBeUndefined();
    expect((await directory({ status: "all" })).total).toBe(before + 1);
    expect((await get("/staff")).some((x: Json) => x.id === id)).toBe(true);
    const audit = await get("/audit-log", { search: "Sandya" });
    expect(audit.items.some((a: Json) => a.action === "staff.create")).toBe(true);
  });

  it("says what to fix, field by field", async () => {
    const res = await expectStatus(422, call("POST", "/staff", { phone: "123", nic: "abc", email: "nope", dob: "2099-01-01", emergencyPhone: "1" }));
    expect(Object.keys(res.fields).sort()).toEqual(["designation", "dob", "email", "emergencyPhone", "joinedOn", "name", "nic", "phone", "staffType"]);
  });

  it("clears a detail left blank, and changes the name's title", async () => {
    const { id } = await call("POST", "/staff", record({ name: "Blank Tester", notes: "To go", nic: "198512345678" }));
    const updated = await call("PUT", `/staff/${id}`, record({ title: "Dr.", name: "Blank Tester" }));
    expect(updated.name).toBe("Dr. Blank Tester");
    expect(updated.notes).toBeUndefined();
    expect(updated.nic).toBeUndefined();
  });

  it("creates a login only for people allowed to, and needs an email", async () => {
    const email = `login-${stamp}@example.com`;
    const roleIds = ["role_subject_teacher"];
    expect((await expectStatus(422, call("POST", "/staff", record({ login: { roleIds } })))).fields.email).toBeTruthy();
    await login("principal");
    await expectStatus(403, call("POST", "/staff", record({ email, login: { roleIds } })));
    await login("admin");
    const { id } = await call("POST", "/staff", record({ name: "Login Tester", email, login: { roleIds } }));
    const s = await get(`/staff/${id}`);
    expect(s.loginStatus).toBe("invited");
    await expectStatus(409, call("POST", "/staff", record({ name: "Second Tester", email, login: { roleIds } })));
    await expectStatus(409, call("POST", `/staff/${id}/invite`, { roleIds }));

    // Their login email stays as it is; a name change reaches the login.
    expect((await expectStatus(422, call("PUT", `/staff/${id}`, record({ name: "Login Tester", email: `other-${stamp}@example.com` })))).fields.email).toMatch(/login email/);
    await call("PUT", `/staff/${id}`, record({ name: "Renamed Tester", email }));
    expect((await get("/users", { search: email })).items[0].name).toBe("Mrs. Renamed Tester");
  });

  it("gives someone a login later, once they have an email", async () => {
    const { id } = await call("POST", "/staff", record({ name: "Later Tester" }));
    const roleIds = ["role_subject_teacher"];
    expect((await expectStatus(422, call("POST", `/staff/${id}/invite`, { roleIds }))).fields.email).toBeTruthy();
    const email = `later-${stamp}@example.com`;
    await call("PUT", `/staff/${id}`, record({ name: "Later Tester", email }));
    await login("principal");
    await expectStatus(403, call("POST", `/staff/${id}/invite`, { roleIds }));
    await login("admin");
    await call("POST", `/staff/${id}/invite`, { roleIds });
    expect(await get(`/staff/${id}`)).toMatchObject({ loginStatus: "invited", userId: expect.any(String) });
  });
});

describe("leaving", () => {
  it("keeps the record, stops the login and clears the teacher lists", async () => {
    const email = `leaver-${stamp}@example.com`;
    const { id } = await call("POST", "/staff", record({ name: "Leaver Tester", staffType: "academic", designation: "Teacher – Art", email, login: { roleIds: ["role_subject_teacher"] } }));
    const art = (await get("/subjects")).find((s: Json) => s.code === "ART");
    await call("PUT", `/subjects/${art.id}`, { name: art.name, levels: art.levels, teacherIds: [...art.teacherIds, id] });
    expect((await get(`/staff/${id}`)).subjects).toEqual(["Art"]);

    expect((await expectStatus(422, call("POST", `/staff/${id}/leave`, { leftOn: "2026-10-24" }))).fields.leftOn).toMatch(/future/);
    expect((await expectStatus(422, call("POST", `/staff/${id}/leave`, { leftOn: "2025-12-31" }))).fields.leftOn).toMatch(/before/);
    const left = await call("POST", `/staff/${id}/leave`, { leftOn: "2026-10-20", reason: "Resigned" });
    expect(left).toMatchObject({ status: "inactive", leftOn: "2026-10-20", leaveReason: "Resigned", loginStatus: "deactivated", subjects: [] });
    await expectStatus(409, call("POST", `/staff/${id}/leave`, { leftOn: "2026-10-20" }));

    expect((await get("/staff")).some((s: Json) => s.id === id)).toBe(false);
    expect((await directory({ search: "Leaver" })).total).toBe(0);
    expect((await directory({ search: "Leaver", status: "inactive" })).items[0].id).toBe(id);
    expect((await get("/subjects")).find((s: Json) => s.id === art.id).teacherIds).not.toContain(id);

    // Nobody can give them classes or switch their login back on while they're away.
    const user = (await get("/users", { search: email })).items[0];
    await expectStatus(409, call("POST", `/users/${user.id}/reactivate`));
    await expectStatus(409, call("POST", `/staff/${id}/invite`, { roleIds: ["role_subject_teacher"] }));

    const back = await call("POST", `/staff/${id}/return`);
    expect(back.status).toBe("active");
    expect(back.leftOn).toBeUndefined();
    expect(back.leaveReason).toBeUndefined();
    expect(back.loginStatus).toBe("deactivated");
    await expectStatus(409, call("POST", `/staff/${id}/return`));
    await call("POST", `/users/${user.id}/reactivate`);
    expect((await get(`/staff/${id}`)).loginStatus).toBe("invited");
  });

  it("refuses until their classes and subjects are handed over", async () => {
    const teachers = (await directory({ type: "academic" })).items as Json[];
    const details: Json[] = await Promise.all(teachers.map((s) => get(`/staff/${s.id}`)));
    const teacher = details.filter((d) => d.teaching.length).sort((a, b) => a.teaching.length - b.teaching.length)[0];
    const refused = await expectStatus(409, call("POST", `/staff/${teacher.id}/leave`, { leftOn: "2026-10-23" }));
    expect(refused.code).toBe("still_teaching");
    expect(refused.message).toContain(teacher.teaching[0].className);
    expect((await get(`/staff/${teacher.id}`)).status).toBe("active");

    for (const classId of new Set<string>(teacher.teaching.map((t: Json) => t.classId))) {
      const c = await get(`/classes/${classId}`);
      if (c.classTeacherId === teacher.id) await call("PUT", `/classes/${classId}`, { classTeacherId: "", room: c.room ?? "" });
      for (const cs of c.subjects.filter((x: Json) => x.teacherId === teacher.id)) await call("PUT", `/class-subjects/${cs.id}`, { teacherId: "" });
    }
    expect((await get(`/staff/${teacher.id}`)).teaching).toEqual([]);
    const left = await call("POST", `/staff/${teacher.id}/leave`, { leftOn: "2026-10-23" });
    expect(left.status).toBe("inactive");

    // Someone who has left can't be given a class.
    const cs = (await get(`/classes/${teacher.teaching[0].classId}`)).subjects[0];
    await expectStatus(422, call("PUT", `/class-subjects/${cs.id}`, { teacherId: teacher.id }));
  });

  it("protects the person acting and the last admin", async () => {
    const me = (await directory({ search: "Administrative Officer" })).items[0];
    expect((await expectStatus(409, call("POST", `/staff/${me.id}/leave`, { leftOn: "2026-10-23" }))).message).toMatch(/yourself/);
    await login("principal");
    expect((await expectStatus(409, call("POST", `/staff/${me.id}/leave`, { leftOn: "2026-10-23" }))).message).toMatch(/admin/);
    await login("admin");
  });
});
