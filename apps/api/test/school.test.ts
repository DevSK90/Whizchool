import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/http/rate-limit";
import { signIn } from "./helpers";

beforeEach(() => resetRateLimits());

describe("who can read school structure", () => {
  it("lets parents read the school profile but not staff lists or classes", async () => {
    const parent = await signIn("parent@whizchool.lk");
    expect((await parent.get("/api/v1/settings/school")).status).toBe(200);
    expect((await parent.get("/api/v1/staff")).status).toBe(403);
    expect((await parent.get("/api/v1/classes")).status).toBe(403);
    expect((await parent.get("/api/v1/classes/cls_2026_10a")).status).toBe(403);
  });

  it("limits a subject-only teacher to the classes they teach in", async () => {
    // A teacher who leads no class this year but teaches subjects in some.
    const staff = await prisma.staff.findFirstOrThrow({
      where: {
        userId: { not: null },
        classes: { none: { yearId: "year_2026" } },
        classSubjects: { some: { class: { yearId: "year_2026" } } },
        user: { roles: { every: { roleId: "role_subject_teacher" } } },
      },
      include: { classSubjects: { where: { class: { yearId: "year_2026" } }, select: { classId: true } }, user: true },
    });
    const taught = new Set(staff.classSubjects.map((c) => c.classId));
    const notTaught = await prisma.classSection.findFirstOrThrow({ where: { yearId: "year_2026", id: { notIn: [...taught] } } });
    const agent = await signIn(staff.user!.email);
    expect((await agent.get(`/api/v1/classes/${[...taught][0]}`)).status).toBe(200);
    expect((await agent.get(`/api/v1/classes/${notTaught.id}`)).status).toBe(403);
  });

  it("moves a teacher's data scope as soon as they become class teacher", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const cls = await prisma.classSection.findUniqueOrThrow({ where: { id: "cls_2026_6a" } });
    const free = await prisma.staff.findFirstOrThrow({
      where: { userId: { not: null }, designation: { startsWith: "Teacher" }, classes: { none: { yearId: "year_2026" } }, classSubjects: { none: { classId: cls.id } } },
      include: { user: true },
    });
    const teacher = await signIn(free.user!.email);
    expect((await teacher.get(`/api/v1/classes/${cls.id}`)).status).toBe(403);
    expect((await admin.put(`/api/v1/classes/${cls.id}`).send({ classTeacherId: free.id, room: cls.room })).status).toBe(200);
    expect((await teacher.get("/api/v1/auth/me")).body.classIds).toContain(cls.id);
    expect((await teacher.get(`/api/v1/classes/${cls.id}`)).status).toBe(200);
    // Restore, so other tests see the seeded class teacher.
    await admin.put(`/api/v1/classes/${cls.id}`).send({ classTeacherId: cls.classTeacherId, room: cls.room });
  });
});

describe("settings validation and audit", () => {
  it("rejects impossible dates and ignores fields that aren't editable", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const bad = await admin.put("/api/v1/terms/term_2026_1").send({ startDate: "2026-02-30", endDate: "2026-04-10" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.startDate).toBe("Enter a valid date");

    const school = (await admin.get("/api/v1/settings/school")).body;
    const res = await admin.put("/api/v1/settings/school").send({ ...school, currency: "USD", timezone: "UTC", currentYearId: "year_2025" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currency: "LKR", timezone: "Asia/Colombo", currentYearId: "year_2026" });
  });

  it("records exactly what changed", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const school = (await admin.get("/api/v1/settings/school")).body;
    await admin.put("/api/v1/settings/school").send({ ...school, phone: "081 999 0000" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.update" }, orderBy: { at: "desc" } });
    expect(entry.summary).toBe("Updated school profile (phone)");
    expect(entry.before).toEqual({ phone: school.phone });
    expect(entry.after).toEqual({ phone: "081 999 0000" });

    const bands = (await admin.get("/api/v1/grade-bands")).body;
    await admin.put("/api/v1/grade-bands").send({ bands });
    const bandsEntry = await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.gradeBands" }, orderBy: { at: "desc" } });
    expect(bandsEntry.summary).toBe("Updated grading scale: A 75–100, B 65–74, C 50–64, S 35–49, W 0–34");
  });

  it("creates a class, its subjects and the audit entry together", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const res = await admin.post("/api/v1/classes").send({ gradeId: "grade_1", section: "Q" });
    expect(res.status).toBe(200);
    const subjects = await prisma.classSubject.findMany({ where: { classId: res.body.id }, include: { subject: true } });
    expect(subjects.map((s) => s.subject.code).sort()).toEqual(["ART", "ENG", "ENV", "MAT", "REL", "SIN"]);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "class.create", entityId: res.body.id } });
    expect(entry.summary).toBe("Created class 1-Q with 6 subjects");
  });
});
