import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { resetRateLimits } from "../src/http/rate-limit";
import { app, client, signIn, tokenFromEmail, unique } from "./helpers";

beforeEach(() => resetRateLimits());

describe("access to user management", () => {
  it("requires a session and the users.view permission", async () => {
    expect((await request(app).get("/api/v1/users")).status).toBe(401);
    expect((await (await signIn("teacher@whizchool.lk")).get("/api/v1/users")).status).toBe(403);
    expect((await (await signIn("parent@whizchool.lk")).get("/api/v1/roles")).status).toBe(403);
  });
});

describe("users", () => {
  it("lists, filters, searches, sorts and paginates", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const all = (await admin.get("/api/v1/users").query({ pageSize: 10 })).body;
    expect(all.items).toHaveLength(10);
    expect(all.total).toBeGreaterThan(500);
    expect(all.items[0]).toHaveProperty("roleNames");
    expect(all.items[0]).not.toHaveProperty("passwordHash");

    const staff = (await admin.get("/api/v1/users").query({ kind: "staff", pageSize: 100 })).body;
    expect(staff.items.every((u: { kind: string }) => u.kind === "staff")).toBe(true);

    const found = (await admin.get("/api/v1/users").query({ search: "PRINCIPAL@" })).body;
    expect(found.items.map((u: { email: string }) => u.email)).toEqual(["principal@whizchool.lk"]);

    const teachers = (await admin.get("/api/v1/users").query({ roleId: "role_class_teacher", pageSize: 100 })).body;
    expect(teachers.items.every((u: { roleIds: string[] }) => u.roleIds.includes("role_class_teacher"))).toBe(true);

    const names = (await admin.get("/api/v1/users").query({ kind: "staff", sort: "-name", pageSize: 5 })).body.items.map((u: { name: string }) => u.name);
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));

    // Out-of-range paging is clamped, not rejected.
    const clamped = (await admin.get("/api/v1/users").query({ page: 0, pageSize: 1000 })).body;
    expect(clamped).toMatchObject({ page: 1, pageSize: 100 });
  });

  it("validates invitations field by field", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const res = await admin.post("/api/v1/users/invite").send({ name: " ", email: "not-an-email", roleIds: [] });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["email", "name", "roleIds"]);
  });
});

describe("roles", () => {
  it("lists built-in roles first, Admin at the top, with active user counts", async () => {
    const roles = (await (await signIn("admin@whizchool.lk")).get("/api/v1/roles")).body;
    expect(roles[0]).toMatchObject({ id: "role_admin", system: true, scope: "all" });
    expect(roles.slice(0, 6).every((r: { system: boolean }) => r.system)).toBe(true);
    expect(roles.find((r: { id: string }) => r.id === "role_parent").userCount).toBeGreaterThan(300);
  });

  it("creates, assigns, updates and deletes a custom role; changes apply immediately", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const name = `Librarian ${unique()}`;
    const created = await admin.post("/api/v1/roles").send({ name, description: "Books", scope: "all", permissions: ["students.view", "not.a.permission"] });
    expect(created.status).toBe(200);
    expect(created.body.permissions).toEqual(["students.view"]);
    const roleId = created.body.id;

    const dup = await admin.post("/api/v1/roles").send({ name: name.toUpperCase(), scope: "all", permissions: [] });
    expect(dup.status).toBe(409);

    // A new staff member with just this role.
    const email = `lib.${unique()}@example.com`;
    const invited = await admin.post("/api/v1/users/invite").send({ name: "Lib", email, roleIds: [roleId] });
    const lib = client();
    await lib.post(`/api/v1/auth/invites/${tokenFromEmail(email)}/accept`).send({ password: "library-pass" });
    expect((await lib.get("/api/v1/auth/me")).body.permissions).toEqual(["students.view"]);
    expect((await lib.get("/api/v1/users")).status).toBe(403);

    // Granting users.view to the role takes effect on the user's very next request.
    await admin.put(`/api/v1/roles/${roleId}`).send({ name, scope: "all", permissions: ["students.view", "users.view"] });
    expect((await lib.get("/api/v1/users")).status).toBe(200);

    expect((await admin.delete(`/api/v1/roles/${roleId}`)).body.error.code).toBe("in_use");
    await admin.put(`/api/v1/users/${invited.body.id}/roles`).send({ roleIds: ["role_subject_teacher"] });
    expect((await lib.get("/api/v1/users")).status).toBe(403);
    expect((await admin.delete(`/api/v1/roles/${roleId}`)).status).toBe(200);
  });

  it("protects built-in roles", async () => {
    const admin = await signIn("admin@whizchool.lk");
    expect((await admin.put("/api/v1/roles/role_admin").send({ name: "Admin", scope: "all", permissions: [] })).body.error.code).toBe("protected");
    expect((await admin.delete("/api/v1/roles/role_teacher_nope")).status).toBe(404);
    expect((await admin.delete("/api/v1/roles/role_principal")).body.error.code).toBe("protected");
    // Built-in roles keep their name and scope even if a request tries to change them.
    const res = await admin.put("/api/v1/roles/role_accountant").send({ name: "Bursar", scope: "own_class", permissions: ["fees.view", "payments.view", "payments.create"] });
    expect(res.body).toMatchObject({ name: "Accountant", scope: "all" });
  });
});

describe("audit log", () => {
  it("records who did what, newest first, and filters by entity", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const name = `Audited ${unique()}`;
    await admin.post("/api/v1/roles").send({ name, scope: "all", permissions: [] });
    const log = (await admin.get("/api/v1/audit-log").query({ entity: "Role", pageSize: 5 })).body;
    expect(log.items[0]).toMatchObject({ actor: "Ms. Nimali Perera", action: "role.create", entity: "Role", summary: `Created role ${name}` });
    expect(log.items.every((e: { entity: string }) => e.entity === "Role")).toBe(true);
    expect((await (await signIn("teacher@whizchool.lk")).get("/api/v1/audit-log")).status).toBe(403);
  });
});
