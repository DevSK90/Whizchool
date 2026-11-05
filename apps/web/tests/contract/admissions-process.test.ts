import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, FILES, get, login, logout, resetData, setToday, upload, type Json } from "./helpers";

const TODAY = "2026-10-23";
const LATER = "2026-11-02";
const stamp = Date.now().toString(36);

const form = (over: { email?: string; phone?: string; gradeId?: string; first?: string } = {}, documents: Json[] = []) => ({
  applyingGradeId: over.gradeId ?? "grade_6",
  student: { firstName: over.first ?? "Walk", lastName: "Inchild", gender: "M", dob: "2015-03-03", address: "9 School Lane" },
  guardian: { name: "Mr. Inchild", relationship: "Father", phone: over.phone ?? "0771112222", ...(over.email ? { email: over.email } : {}) },
  documents,
});

/** What the parent was sent about this application, newest first. */
async function sentAbout(refNo: string) {
  const list = await get("/messages", { pageSize: 100 });
  return (list.items as Json[]).filter((m) => m.audience.label.includes(refNo));
}
const walkIn = (body: Json) => call("POST", "/applications/walk-in", body);
const appOf = async (refNo: string) => (await get("/applications", { search: refNo })).items[0].id as string;
const firstClass = async (grade: string) => (await get("/classes") as Json[]).find((c) => c.gradeId === grade)!;

beforeAll(async () => {
  await resetData();
  await setToday(TODAY);
  await login("admin");
});

describe("an application entered at the office", () => {
  it("needs no email or documents, and records who entered it", async () => {
    const saved = await walkIn(form());
    expect(saved.refNo).toMatch(/^APP-\d{4}-\d{4}$/);
    expect(saved.phone).toBe("077 111 2222");
    expect(saved.notified).toBe(true);

    const app = await get(`/applications/${saved.id}`);
    expect(app.guardian.email).toBeUndefined();
    expect(app.documents).toEqual([]);
    expect(app.timeline[0]).toMatchObject({ stage: "new", note: "Entered at the school office" });
    expect(app.timeline[0].by).not.toBe("Online form");
    const sms = (await sentAbout(saved.refNo)).filter((m) => m.channel === "sms");
    expect(sms).toHaveLength(1);
    expect(sms[0].body).toContain(saved.refNo);
    expect((await sentAbout(saved.refNo)).some((m) => m.channel === "email")).toBe(false);
  });

  it("isn't held back by the public form's limit, and still checks the details", async () => {
    for (let i = 0; i < 7; i++) await walkIn(form({ first: `Walk${i}` }));
    const res = await expectStatus(422, walkIn({ applyingGradeId: "x", student: {}, guardian: { phone: "12" } }));
    expect(Object.keys(res.fields)).toEqual(expect.arrayContaining(["student.firstName", "guardian.phone"]));
    expect(res.fields["guardian.email"]).toBeUndefined();
    expect((await expectStatus(422, walkIn(form({ email: "nope" })))).fields["guardian.email"]).toBeTruthy();
  });

  it("is only for staff allowed to create applications", async () => {
    await logout();
    await expectStatus(401, walkIn(form()));
    await login("teacher");
    await expectStatus(403, walkIn(form()));
    await login("admin");
  });

  it("still needs an email on the public form", async () => {
    await logout();
    expect((await expectStatus(422, call("POST", "/applications", form()))).fields["guardian.email"]).toBeTruthy();
    await login("admin");
  });

  it("accepts a landline, with no SMS, and says nobody could be told", async () => {
    const saved = await walkIn(form({ phone: "0112345678" }));
    expect(saved.notified).toBe(false);
    expect(await sentAbout(saved.refNo)).toEqual([]);
  });

  it("takes documents the parent brings later, which can be opened", async () => {
    const saved = await walkIn(form());
    const file = await upload(FILES.png("later.png"), "application-document");
    const app = await call("POST", `/applications/${saved.id}/documents`, { name: "later.pdf", size: 100, kind: "birth_certificate", fileId: file.id });
    expect(app.documents).toHaveLength(1);
    expect((await get(`/applications/${saved.id}`)).documents[0].url).toEqual(expect.any(String));
    await expectStatus(422, call("POST", `/applications/${saved.id}/documents`, { name: "later.pdf", size: 100, kind: "birth_certificate", fileId: file.id }));
    await login("teacher");
    await expectStatus(403, call("POST", `/applications/${saved.id}/documents`, { name: "x.pdf", size: 1, kind: "other", fileId: file.id }));
    await login("admin");
  });
});

describe("tracking an application", () => {
  it("works with the phone number or the email, however it's typed, and nothing else", async () => {
    const email = `track-${stamp}@example.com`;
    const { refNo } = await walkIn(form({ email, phone: "077 333 4444" }));
    await logout();
    for (const contact of ["077 333 4444", "0773334444", "+94 77 333 4444", email, email.toUpperCase()]) {
      expect((await get("/applications/status", { refNo, contact })).stage).toBe("new");
    }
    for (const contact of ["", "0770000000", "someone@example.com"]) await expectStatus(404, get("/applications/status", { refNo, contact }));
    await login("admin");
  });
});

describe("telling parents", () => {
  it("sends an SMS and an email at each step, with the right dates", async () => {
    const email = `steps-${stamp}@example.com`;
    const { refNo, id } = await walkIn(form({ email }));
    const countOf = async () => (await sentAbout(refNo)).length;
    expect(await countOf()).toBe(2);

    await call("POST", `/applications/${id}/transition`, { to: "interview", interviewAt: "2026-10-28T10:30:00+05:30" });
    expect(await countOf()).toBe(4);
    expect((await sentAbout(refNo)).filter((m) => m.channel === "sms").some((m) => m.body.includes("28 Oct 2026"))).toBe(true);

    // Rescheduling tells them again, and the time follows.
    const moved = await call("POST", `/applications/${id}/transition`, { to: "interview", interviewAt: "2026-10-29T09:00:00+05:30" });
    expect(moved.stage).toBe("interview");
    expect(new Date(moved.interviewAt).toISOString()).toBe("2026-10-29T03:30:00.000Z");
    expect(await countOf()).toBe(6);

    await call("POST", `/applications/${id}/transition`, { to: "rejected", note: "Full" });
    const all = await sentAbout(refNo);
    expect(all).toHaveLength(8);
    expect(all.some((m) => m.channel === "email" && /can't offer a place/.test(m.body))).toBe(true);
    expect(all.every((m) => m.kind === "system")).toBe(true);
  });

  it("doesn't message anyone for a withdrawal", async () => {
    const { refNo, id } = await walkIn(form());
    await call("POST", `/applications/${id}/transition`, { to: "withdrawn" });
    expect(await sentAbout(refNo)).toHaveLength(1);
  });
});

describe("the enrolment date", () => {
  it("is needed to accept, can't be past, and an interview isn't", async () => {
    const { id } = await walkIn(form());
    expect((await expectStatus(422, call("POST", `/applications/${id}/transition`, { to: "accepted" }))).fields.enrollmentDate).toBeTruthy();
    expect((await expectStatus(422, call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: "2026-10-22" }))).fields.enrollmentDate).toBeTruthy();
    const accepted = await call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: TODAY });
    expect(accepted).toMatchObject({ stage: "accepted", enrollmentDate: TODAY });
  });

  it("holds Enroll until the day, tells the parent, and can be changed", async () => {
    const { refNo, id } = await walkIn(form());
    await call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: LATER });
    expect((await sentAbout(refNo)).find((m) => /offered a place/.test(m.body)).body).toContain("2 Nov 2026");

    await logout();
    const status = await get("/applications/status", { refNo, contact: "077 111 2222" });
    expect(status).toMatchObject({ stage: "accepted", enrollmentDate: LATER });
    await login("admin");

    const classId = (await firstClass("grade_6")).id;
    const early = await expectStatus(409, call("POST", `/applications/${id}/enroll`, { classId }));
    expect(early.code).toBe("too_early");

    const changed = await call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: TODAY });
    expect(changed).toMatchObject({ stage: "accepted", enrollmentDate: TODAY });
    expect((await sentAbout(refNo)).some((m) => /enrolment date .* is now/.test(m.body))).toBe(true);
    await login("teacher");
    await expectStatus(403, call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: LATER }));
    await login("admin");

    const done = await call("POST", `/applications/${id}/enroll`, { classId });
    expect(done.inviteLink).toBeUndefined();
    expect((await sentAbout(refNo)).some((m) => m.body.includes(done.admissionNo))).toBe(true);
  });

  it("opens on the day itself", async () => {
    const { id } = await walkIn(form());
    await call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: LATER });
    await setToday(LATER);
    const classId = (await firstClass("grade_6")).id;
    await call("POST", `/applications/${id}/enroll`, { classId });
    await setToday(TODAY);
  });

  it("appears in the list", async () => {
    const { refNo, id } = await walkIn(form());
    await call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: LATER });
    expect((await get("/applications", { search: refNo })).items[0].enrollmentDate).toBe(LATER);
    expect(await appOf(refNo)).toBe(id);
  });
});

describe("enrolling", () => {
  it("takes subject choices, and makes the application's photo the profile photo", async () => {
    const photo = await upload(FILES.png("me.png"), "application-document");
    const { id } = await walkIn(form({ gradeId: "grade_10" }, [{ name: "me.png", size: 100, kind: "photo", fileId: photo.id }]));
    await call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: TODAY });
    const cls = await get(`/classes/${(await firstClass("grade_10")).id}`);
    const of = (g: string) => cls.subjects.filter((s: Json) => s.optionGroup === g).map((s: Json) => s.subjectId);
    // Two from one group is refused, as on the student form.
    await expectStatus(422, call("POST", `/applications/${id}/enroll`, { classId: cls.id, electiveSubjectIds: of("basket1").slice(0, 2) }));

    const some = [of("first_language")[0], of("religion")[0], of("basket1")[0]];
    const { studentId } = await call("POST", `/applications/${id}/enroll`, { classId: cls.id, electiveSubjectIds: some });
    const student = await get(`/students/${studentId}`);
    expect(student.electiveSubjectIds.sort()).toEqual([...some].sort());
    expect(student.subjectChoices).toBe("pending");
    expect(student.photoUrl).toEqual(expect.any(String));
    expect(student.documents.map((d: Json) => d.kind)).toContain("photo");

    await call("PUT", `/students/${studentId}`, {
      firstName: student.firstName, lastName: student.lastName, gender: student.gender, dob: student.dob, address: student.address, medical: student.medical,
      classId: student.classId, electiveSubjectIds: [...some, of("basket2")[0], of("basket3")[0]], discountIds: student.discountIds,
    });
    expect((await get(`/students/${studentId}`)).subjectChoices).toBe("done");
  });

  it("doesn't use a PDF as a photo, and has no choices to make in a primary class", async () => {
    const pdf = await upload(FILES.pdf("photo.pdf"), "application-document");
    const { id } = await walkIn(form({ gradeId: "grade_1" }, [{ name: "photo.pdf", size: 100, kind: "photo", fileId: pdf.id }]));
    await call("POST", `/applications/${id}/transition`, { to: "accepted", enrollmentDate: TODAY });
    const { studentId } = await call("POST", `/applications/${id}/enroll`, { classId: (await firstClass("grade_1")).id });
    const student = await get(`/students/${studentId}`);
    expect(student.photoUrl).toBeUndefined();
    expect(student.subjectChoices).toBeUndefined();
  });
});
