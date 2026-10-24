import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, logout, resetData, type Json } from "./helpers";

beforeAll(() => resetData());

const stamp = Date.now().toString(36);

describe("user management", () => {
  it("is limited to staff with the users and roles permissions", async () => {
    await logout();
    await expectStatus(401, get("/users"));
    await login("teacher");
    await expectStatus(403, get("/users"));
    await expectStatus(403, get("/audit-log"));
    await login("parent");
    await expectStatus(403, get("/roles"));
  });

  it("lists and searches accounts", async () => {
    await login("admin");
    const page = await get("/users", { pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.total).toBeGreaterThan(500);
    const found = await get("/users", { search: "principal@" });
    expect(found.items.map((u: Json) => u.email)).toEqual(["principal@whizchool.lk"]);
    expect(found.items[0].roleNames).toContain("Principal");
  });

  it("invites a staff member who sets a password, and deactivation locks them out", async () => {
    await login("admin");
    const email = `contract.${stamp}@example.com`;
    const invited = await call("POST", "/users/invite", { name: "Contract Teacher", email, kind: "staff", roleIds: ["role_subject_teacher"] });
    expect(invited.inviteLink).toMatch(/^\/invite\//);
    await expectStatus(409, call("POST", "/users/invite", { name: "Again", email, roleIds: ["role_subject_teacher"] }));

    const token = invited.inviteLink.split("/").pop();
    expect(await get(`/auth/invites/${token}`)).toMatchObject({ email, kind: "staff" });
    const session = await call("POST", `/auth/invites/${token}/accept`, { password: "teacher-pass" });
    expect(session.roles.map((r: Json) => r.id)).toEqual(["role_subject_teacher"]);
    expect((await get("/auth/me")).email).toBe(email);

    await login("admin");
    await call("POST", `/users/${invited.id}/deactivate`);
    await expectStatus(403, call("POST", "/auth/login", { email, password: "teacher-pass" }));
    await call("POST", `/users/${invited.id}/reactivate`);
    expect((await call("POST", "/auth/login", { email, password: "teacher-pass" })).email).toBe(email);
  });

  it("stops admins from locking themselves out", async () => {
    const admin = await login("admin");
    expect((await expectStatus(409, call("POST", `/users/${admin.id}/deactivate`))).code).toBe("self_lockout");
    expect((await expectStatus(409, call("PUT", `/users/${admin.id}/roles`, { roleIds: ["role_principal"] }))).code).toBe("self_lockout");
  });
});

describe("roles", () => {
  it("creates, edits and deletes custom roles; built-in roles are protected", async () => {
    await login("admin");
    const roles: Json[] = await get("/roles");
    expect(roles[0]).toMatchObject({ id: "role_admin", system: true });

    const name = `Librarian ${stamp}`;
    const role = await call("POST", "/roles", { name, description: "Library", scope: "all", permissions: ["students.view"] });
    expect(role).toMatchObject({ name, system: false, scope: "all", permissions: ["students.view"], userCount: 0 });
    await expectStatus(409, call("POST", "/roles", { name: name.toUpperCase(), scope: "all", permissions: [] }));

    const updated = await call("PUT", `/roles/${role.id}`, { name, scope: "all", permissions: ["students.view", "classes.view"] });
    expect(updated.permissions.sort()).toEqual(["classes.view", "students.view"]);

    await expectStatus(409, call("PUT", "/roles/role_admin", { name: "Admin", scope: "all", permissions: [] }));
    await expectStatus(409, call("DELETE", "/roles/role_principal"));
    await call("DELETE", `/roles/${role.id}`);
    expect((await get("/roles")).some((r: Json) => r.id === role.id)).toBe(false);

    const log = await get("/audit-log", { entity: "Role", search: name });
    expect(log.items.map((e: Json) => e.action)).toEqual(expect.arrayContaining(["role.create", "role.update", "role.delete"]));
  });
});
