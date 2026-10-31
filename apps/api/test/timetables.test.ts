import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/http/rate-limit";
import { signIn } from "./helpers";

beforeEach(() => resetRateLimits());

const CLASS_A = "cls_2026_9a";
const CLASS_B = "cls_2026_9b";

async function board(admin: Awaited<ReturnType<typeof signIn>>, classId: string) {
  const res = await admin.get(`/api/v1/classes/${classId}/timetable`).query({ version: "draft" });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

describe("timetable writes", () => {
  it("can't both publish when two classes clash at the same moment", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const a = await board(admin, CLASS_A);
    const b = await board(admin, CLASS_B);
    // Before lessons begin, nothing else in the school uses this room.
    const lesson = (subjects: { id: string }[]) => ({ day: 3, start: 450, end: 455, kind: "lesson", classSubjectId: subjects[0]!.id, room: "Hall" });
    const save = (classId: string, revision: number, subjects: { id: string }[]) => admin.put(`/api/v1/classes/${classId}/timetable`).send({ revision, blocks: [lesson(subjects)] });
    expect((await save(CLASS_A, a.revision, a.subjects)).status).toBe(200);
    expect((await save(CLASS_B, b.revision, b.subjects)).status).toBe(200);

    const results = await Promise.all([admin.post(`/api/v1/classes/${CLASS_A}/timetable/publish`), admin.post(`/api/v1/classes/${CLASS_B}/timetable/publish`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const live = await prisma.timetableBlock.count({ where: { version: "published", room: "Hall" } });
    expect(live).toBe(1);
  });

  it("lets only one of two simultaneous saves through", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const view = await board(admin, "cls_2026_7a");
    const body = { revision: view.revision, blocks: [] };
    const results = await Promise.all([admin.put("/api/v1/classes/cls_2026_7a/timetable").send(body), admin.put("/api/v1/classes/cls_2026_7a/timetable").send(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("records saves and publishes in the audit log", async () => {
    expect(await prisma.auditLog.count({ where: { action: "timetable.save", entityId: CLASS_A } })).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: "timetable.publish" } })).toBeGreaterThan(0);
  });

  it("gives built-in roles the timetable permissions in existing databases", async () => {
    const roles = await prisma.role.findMany({ where: { name: { in: ["Admin", "Principal", "Class Teacher", "Subject Teacher", "Accountant"] } } });
    const has = (name: string, key: string) => roles.find((r) => r.name === name)!.permissions.includes(key);
    expect(has("Principal", "timetable.edit")).toBe(true);
    expect(has("Class Teacher", "timetable.view")).toBe(true);
    expect(has("Class Teacher", "timetable.edit")).toBe(false);
    expect(has("Subject Teacher", "timetable.view")).toBe(true);
    expect(has("Accountant", "timetable.view")).toBe(false);

    // The migration's own statements, on a role that has lost them, as one from before this feature would.
    await prisma.role.update({ where: { name: "Subject Teacher" }, data: { permissions: { set: ["dashboard.view"] } } });
    await prisma.$executeRaw`UPDATE "Role" SET "permissions" = array_append("permissions", 'timetable.view')
      WHERE "name" IN ('Admin', 'Principal', 'Class Teacher', 'Subject Teacher', 'Office Staff') AND NOT 'timetable.view' = ANY("permissions")`;
    const after = await prisma.role.findUniqueOrThrow({ where: { name: "Subject Teacher" } });
    expect(after.permissions).toContain("timetable.view");
    expect((await prisma.role.findUniqueOrThrow({ where: { name: "Principal" } })).permissions.filter((p) => p === "timetable.view")).toHaveLength(1);
  });
});
