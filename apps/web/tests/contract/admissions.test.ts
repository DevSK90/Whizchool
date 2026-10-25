import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, FILES, get, login, logout, resetData, upload, type Json } from "./helpers";

beforeAll(() => resetData());

const application = (fileId?: string) => ({
  applyingGradeId: "grade_6",
  student: { firstName: "Test", lastName: "Child", gender: "F", dob: "2015-02-02", address: "1 Main St" },
  guardian: { name: "Mrs. Test", relationship: "Mother", phone: "077 123 4567", email: "test.parent@example.com" },
  documents: [{ name: "bc.pdf", size: 1000, kind: "birth_certificate", fileId }],
});

describe("admissions: apply → interview → accept → enroll → parent invite", () => {
  let refNo: string;
  let appId: string;
  let enrolled: Json;

  it("lets a visitor upload a document and apply, once per idempotency key", async () => {
    await logout();
    await expectStatus(401, upload(FILES.png(), "student-photo"));
    await expectStatus(415, upload(FILES.gif(), "application-document"));
    await expectStatus(413, upload(FILES.tooBig(), "application-document"));
    const file = await upload(FILES.pdf("bc.pdf"), "application-document");

    const first = await call("POST", "/applications", application(file.id), undefined, "apply-1");
    const retry = await call("POST", "/applications", application(file.id), undefined, "apply-1");
    expect(retry.refNo).toBe(first.refNo);
    refNo = first.refNo;
    expect(refNo).toMatch(/^APP-\d{4}-\d{4}$/);

    const status = await get("/applications/status", { refNo, email: "test.parent@example.com" });
    expect(status.stage).toBe("new");
    await expectStatus(404, get("/applications/status", { refNo, email: "someone.else@example.com" }));
  });

  it("validates the application with field errors", async () => {
    const error = await expectStatus(422, call("POST", "/applications", { applyingGradeId: "x", student: {}, guardian: {} }));
    expect(Object.keys(error.fields)).toEqual(expect.arrayContaining(["student.firstName", "guardian.phone"]));
  });

  it("moves the application through the pipeline and enrolls it", async () => {
    await login("admin");
    appId = (await get("/applications", { search: refNo })).items[0].id;
    await call("POST", `/applications/${appId}/transition`, { to: "interview", interviewAt: "2026-11-02T10:00:00+05:30" });
    await call("POST", `/applications/${appId}/transition`, { to: "accepted" });
    const classes: Json[] = await get("/classes");
    enrolled = await call("POST", `/applications/${appId}/enroll`, { classId: classes.find((c) => c.name === "6-A").id, inviteParent: true });
    expect(enrolled.admissionNo).toBeTruthy();
    expect(enrolled.inviteLink).toMatch(/\/invite\//);

    const student = await get(`/students/${enrolled.studentId}`);
    expect(student.documents.map((d: Json) => d.kind)).toEqual(["birth_certificate"]);
    await expectStatus(409, call("POST", `/applications/${appId}/enroll`, { classId: student.classId }));
  });

  it("lets the parent accept the invite and see their child", async () => {
    await logout();
    const token = enrolled.inviteLink.split("/").pop();
    expect((await get(`/auth/invites/${token}`)).email).toBe("test.parent@example.com");
    const parent = await call("POST", `/auth/invites/${token}/accept`, { password: "newpass123" });
    expect(parent.studentIds).toEqual([enrolled.studentId]);
    expect((await get(`/students/${enrolled.studentId}`)).fullName).toBe("Test Child");
    // Invites are single-use.
    await expectStatus(404, call("POST", `/auth/invites/${token}/accept`, { password: "again1234" }));
  });
});
