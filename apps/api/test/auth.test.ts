import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/auth/crypto";
import { prisma } from "../src/db";
import { sentEmails } from "../src/email/mailer";
import { resetRateLimits } from "../src/http/rate-limit";
import { app, client, PASSWORD, signIn, tokenFromEmail, unique } from "./helpers";
import request from "supertest";

beforeEach(() => resetRateLimits());

const sessionCookie = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("wz_sid="));

/** Invites a fresh staff user as admin and accepts the invitation; returns their email and signed-in agent. */
async function newStaffUser(roleIds = ["role_subject_teacher"]) {
  const admin = await signIn("admin@whizchool.lk");
  const email = `staff.${unique()}@example.com`;
  const invited = await admin.post("/api/v1/users/invite").send({ name: "Test Teacher", email, kind: "staff", roleIds });
  expect(invited.status, JSON.stringify(invited.body)).toBe(200);
  const agent = client();
  const accepted = await agent.post(`/api/v1/auth/invites/${tokenFromEmail(email)}/accept`).send({ password: "first-pass-1" });
  expect(accepted.status).toBe(200);
  return { email, agent, id: invited.body.id as string };
}

describe("sign-in and sessions", () => {
  it("signs in, sets a hardened cookie and returns the session user", async () => {
    const res = await client().post("/api/v1/auth/login").send({ email: "  Admin@Whizchool.lk ", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "admin@whizchool.lk", kind: "staff" });
    expect(res.body.permissions).toContain("users.edit");
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=43200/); // staff: 12 hours idle
  });

  it("stores only a hash of the session token", async () => {
    const res = await client().post("/api/v1/auth/login").send({ email: "parent@whizchool.lk", password: PASSWORD });
    const token = decodeURIComponent(sessionCookie(res)!.split(";")[0].split("=")[1]);
    expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0);
    expect(await prisma.session.count({ where: { tokenHash: sha256(token) } })).toBe(1);
    expect(sessionCookie(res)).toMatch(/Max-Age=604800/); // parents: 7 days idle
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const wrong = await client().post("/api/v1/auth/login").send({ email: "admin@whizchool.lk", password: "nope-nope" });
    const unknown = await client().post("/api/v1/auth/login").send({ email: "nobody@example.com", password: "nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("returns the session from /auth/me and forgets it after logout", async () => {
    const agent = await signIn("teacher@whizchool.lk");
    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.classIds.length).toBeGreaterThan(0);
    expect(me.body.classSubjectIds.length).toBeGreaterThan(0);
    const out = await agent.post("/api/v1/auth/logout");
    expect(out.status).toBe(200);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    // Logging out again is harmless.
    expect((await agent.post("/api/v1/auth/logout")).status).toBe(200);
  });

  it("lists a parent's linked children as their data scope", async () => {
    const me = await (await signIn("parent@whizchool.lk")).get("/api/v1/auth/me");
    expect(me.body.kind).toBe("parent");
    expect(me.body.studentIds.length).toBeGreaterThanOrEqual(1);
    expect(me.body.classIds).toEqual([]);
  });

  it("expires idle sessions and extends active ones", async () => {
    const agent = await signIn("accountant@whizchool.lk");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "accountant@whizchool.lk" } });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

    // Active 10 minutes ago: the next request slides the expiry forward.
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() + 60_000) } });
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    const slid = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(slid.expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 60 * 60_000);

    // Past its expiry: treated as signed out and removed.
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await agent.get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(await prisma.session.count({ where: { id: session.id } })).toBe(0);
  });

  it("blocks sign-in from another site", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("Origin", "https://evil.example").send({ email: "admin@whizchool.lk", password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it("rate-limits repeated sign-in attempts for one account", async () => {
    const attempt = () => client().post("/api/v1/auth/login").send({ email: "principal@whizchool.lk", password: "guess-guess" });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("invitations", () => {
  it("emails a single-use link that activates the account and signs in", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const email = `new.${unique()}@example.com`;
    const invited = await admin.post("/api/v1/users/invite").send({ name: "Nadeesha Perera", email, kind: "staff", designation: "Teacher – Art", roleIds: ["role_subject_teacher"] });
    expect(invited.status).toBe(200);
    expect(invited.body.inviteLink).toMatch(/^\/invite\//);
    const mail = sentEmails.findLast((e) => e.to === email)!;
    expect(mail.text).toContain(`http://localhost:3000${invited.body.inviteLink}`);

    const token = tokenFromEmail(email);
    expect((await client().get(`/api/v1/auth/invites/${token}`)).body).toEqual({ name: "Nadeesha Perera", email, kind: "staff" });
    expect((await client().post("/api/v1/auth/login").send({ email, password: "anything-1" })).status).toBe(401);

    const short = await client().post(`/api/v1/auth/invites/${token}/accept`).send({ password: "short" });
    expect(short.status).toBe(422);
    expect(short.body.error.fields.password).toMatch(/8 characters/);

    const agent = client();
    const accepted = await agent.post(`/api/v1/auth/invites/${token}/accept`).send({ password: "a-good-password" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.email).toBe(email);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    expect((await client().post(`/api/v1/auth/invites/${token}/accept`).send({ password: "again-again" })).status).toBe(404);

    const staff = await prisma.staff.findFirstOrThrow({ where: { email } });
    expect(staff.empNo).toMatch(/^EMP\d{3}$/);
    expect(staff.designation).toBe("Teacher – Art");
  });

  it("rejects duplicate emails and replaces the link on resend", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const dup = await admin.post("/api/v1/users/invite").send({ name: "X", email: "teacher@whizchool.lk", roleIds: ["role_subject_teacher"] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.email).toBeTruthy();

    const email = `resend.${unique()}@example.com`;
    const { body } = await admin.post("/api/v1/users/invite").send({ name: "Resend Me", email, kind: "parent", roleIds: ["role_parent"] });
    const first = tokenFromEmail(email);
    expect((await admin.post(`/api/v1/users/${body.id}/resend-invite`)).status).toBe(200);
    const second = tokenFromEmail(email);
    expect(second).not.toBe(first);
    expect((await client().get(`/api/v1/auth/invites/${first}`)).status).toBe(404);
    expect((await client().get(`/api/v1/auth/invites/${second}`)).status).toBe(200);
  });
});

describe("passwords", () => {
  it("resets by email link, signing out every session", async () => {
    const { email, agent } = await newStaffUser();
    const before = sentEmails.length;
    expect((await client().post("/api/v1/auth/forgot-password").send({ email: "nobody@example.com" })).body.ok).toBe(true);
    expect(sentEmails.length).toBe(before);

    expect((await client().post("/api/v1/auth/forgot-password").send({ email })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50)); // the email is sent in the background
    const token = tokenFromEmail(email);
    expect((await client().post("/api/v1/auth/reset-password").send({ token, password: "brand-new-pass" })).status).toBe(200);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    expect((await client().post("/api/v1/auth/login").send({ email, password: "first-pass-1" })).status).toBe(401);
    await signIn(email, "brand-new-pass");
    expect((await client().post("/api/v1/auth/reset-password").send({ token, password: "another-pass" })).status).toBe(400);
  });

  it("changes the password, keeping only the current session", async () => {
    const { email } = await newStaffUser();
    const here = await signIn(email, "first-pass-1");
    const elsewhere = await signIn(email, "first-pass-1");
    const wrong = await here.post("/api/v1/auth/change-password").send({ currentPassword: "wrong-one", newPassword: "second-pass-2" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.fields.currentPassword).toBeTruthy();
    expect((await here.post("/api/v1/auth/change-password").send({ currentPassword: "first-pass-1", newPassword: "second-pass-2" })).status).toBe(200);
    expect((await here.get("/api/v1/auth/me")).status).toBe(200);
    expect((await elsewhere.get("/api/v1/auth/me")).status).toBe(401);
  });
});

describe("deactivation", () => {
  it("ends the user's sessions at once and blocks sign-in until reactivated", async () => {
    const { email, agent, id } = await newStaffUser();
    const admin = await signIn("admin@whizchool.lk");
    expect((await admin.post(`/api/v1/users/${id}/deactivate`)).status).toBe(200);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    const login = await client().post("/api/v1/auth/login").send({ email, password: "first-pass-1" });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("deactivated");
    expect((await admin.post(`/api/v1/users/${id}/reactivate`)).status).toBe(200);
    await signIn(email, "first-pass-1");
  });

  it("won't let admins lock themselves out", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const me = (await admin.get("/api/v1/auth/me")).body;
    expect((await admin.post(`/api/v1/users/${me.id}/deactivate`)).body.error.code).toBe("self_lockout");
    expect((await admin.put(`/api/v1/users/${me.id}/roles`).send({ roleIds: ["role_principal"] })).body.error.code).toBe("self_lockout");
  });
});
