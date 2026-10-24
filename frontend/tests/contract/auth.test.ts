import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, logout, resetMockData } from "./helpers";

beforeAll(() => resetMockData());

describe("auth", () => {
  it("rejects anonymous requests with 401 and bad passwords with 401", async () => {
    await expectStatus(401, get("/auth/me"));
    await expectStatus(401, get("/students"));
    await expectStatus(401, login("admin", "wrong-password"));
  });

  it("returns the session with roles, permissions and data scope", async () => {
    const admin = await login("admin");
    expect(admin.permissions).toContain("users.edit");
    const teacher = await login("teacher");
    expect(teacher.permissions).not.toContain("users.view");
    expect(teacher.classIds.length).toBeGreaterThan(0);
    expect((await get("/auth/me")).email).toBe("teacher@whizchool.lk");
  });

  it("logs out and changes passwords", async () => {
    await logout();
    await expectStatus(401, get("/auth/me"));
    await login("parent");
    await call("POST", "/auth/change-password", { currentPassword: "demo1234", newPassword: "demo12345" });
    await logout();
    await expectStatus(401, login("parent"));
    await login("parent", "demo12345");
  });

  it("only shows public endpoints to visitors", async () => {
    await logout();
    expect((await get("/public/school")).name).toBeTruthy();
    expect((await get("/grades")).length).toBe(13);
  });
});
