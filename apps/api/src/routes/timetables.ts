import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import {
  classTimetableView,
  settlePublish,
  studentTimetable,
  teacherTimetable,
  timetableOverview,
  timetableProblem,
} from "@whizchool/shared/timetable";
import type { ClassTimetableView, TimetableOverviewRow, TimetablePublishResult } from "@whizchool/shared/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth/context";
import { canSeeClass, canSeeStudent, hasFullScope, scopedClassIds } from "../auth/scope";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { currentYearId } from "../school";
import { loadYear, lockTimetables, publishClass } from "../services/timetables";

async function loadClass(auth: AuthContext, id: string) {
  const cls = await prisma.classSection.findUnique({ where: { id }, select: { id: true, name: true, yearId: true } });
  if (!cls) throw new ApiError(404, "not_found", "Class not found.");
  if (!canSeeClass(auth, cls.id, "timetable.view")) throw new ApiError(403, "forbidden", "You can only see the timetables of classes you teach.");
  return cls;
}

const blockBody = z.object({
  day: z.number().int(),
  start: z.number().int(),
  end: z.number().int(),
  kind: z.enum(["lesson", "interval", "activity"]),
  classSubjectId: z.string().max(100).nullish(),
  label: z.string().trim().max(40).nullish(),
  room: z.string().trim().max(40).nullish(),
});

export const timetableRoutes = [
  defineRoute({
    method: "GET",
    path: "/timetables/overview",
    access: { permission: "timetable.view" },
    summary: "This year's classes and their timetables; staff who only view see the published ones they may see",
    handler: async ({ auth }): Promise<TimetableOverviewRow[]> => {
      const rows = timetableOverview(await loadYear(prisma, await currentYearId()));
      if (auth.session.permissions.includes("timetable.edit")) return rows;
      const mine = new Set(scopedClassIds(auth));
      const full = hasFullScope(auth, "timetable.view");
      return rows
        .filter((r) => r.publishedLessons > 0 && (full || mine.has(r.classId)))
        .map((r) => ({ ...r, lessons: r.publishedLessons, hasUnpublishedChanges: false, clashes: 0 }));
    },
  }),
  defineRoute({
    method: "POST",
    path: "/timetables/publish",
    access: { permission: "timetable.edit" },
    summary: "Publish every class with unpublished changes that has no clash; the rest are listed with the reason",
    handler: async ({ auth }): Promise<TimetablePublishResult> => {
      const yearId = await currentYearId();
      return prisma.$transaction(
        async (tx) => {
          await lockTimetables(tx);
          const y = await loadYear(tx, yearId);
          const waiting = timetableOverview(y).filter((r) => r.hasUnpublishedChanges && r.lessons > 0);
          const nameOf = new Map(waiting.map((r) => [r.classId, r.className]));
          const { publishable, blocked } = settlePublish(y, waiting.map((r) => r.classId));
          for (const id of publishable) await publishClass(tx, id, auth.session.name);
          if (publishable.length) await audit(tx, auth, { action: "timetable.publish", entity: "Timetable", summary: `Published ${publishable.length} class timetables` });
          return {
            published: publishable.map((classId) => ({ classId, className: nameOf.get(classId)! })),
            blocked: [...blocked].map(([classId, clashes]) => ({ classId, className: nameOf.get(classId)!, message: clashes[0]!.message })),
          };
        },
        { timeout: 30_000 },
      );
    },
  }),
  defineRoute({
    method: "GET",
    path: "/timetables/me",
    access: { permission: "timetable.view" },
    summary: "The caller's published teaching week",
    handler: async ({ auth }) => {
      const staff = await prisma.staff.findUnique({ where: { userId: auth.session.id }, select: { id: true, name: true } });
      if (!staff) throw new ApiError(403, "forbidden", "Staff only.");
      return teacherTimetable(await loadYear(prisma, await currentYearId()), staff);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/staff/:id/timetable",
    access: { permission: "timetable.view" },
    summary: "A teacher's published teaching week (for staff who can see every class)",
    handler: async ({ auth, params }) => {
      if (!hasFullScope(auth, "timetable.view")) throw new ApiError(403, "forbidden", "You can only see your own timetable.");
      const staff = await prisma.staff.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
      if (!staff) throw new ApiError(404, "not_found", "Staff member not found.");
      return teacherTimetable(await loadYear(prisma, await currentYearId()), staff);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/students/:id/timetable",
    access: "session",
    summary: "A student's published week, with only the O/L electives they take",
    handler: async ({ auth, params }) => {
      const student = await prisma.student.findUnique({
        where: { id: params.id },
        select: { id: true, classId: true, class: { select: { yearId: true } }, subjects: { select: { subjectId: true } } },
      });
      const allowed = student && (auth.session.kind === "parent" ? canSeeStudent(auth, student) : auth.session.permissions.includes("timetable.view") && canSeeStudent(auth, student, "timetable.view"));
      if (!student) throw new ApiError(404, "not_found", "Student not found.");
      if (!allowed) throw new ApiError(403, "forbidden", "You don't have access to this student.");
      return studentTimetable(await loadYear(prisma, student.class.yearId), { id: student.id, classId: student.classId, electiveSubjectIds: student.subjects.map((s) => s.subjectId) });
    },
  }),
  defineRoute({
    method: "GET",
    path: "/classes/:id/timetable",
    access: { permission: "timetable.view" },
    summary: "A class's board: the draft for staff who build timetables, otherwise the published version",
    query: z.object({ version: z.enum(["draft", "published"]).optional() }),
    handler: async ({ auth, params, query }): Promise<ClassTimetableView> => {
      const cls = await loadClass(auth, params.id);
      const canEdit = auth.session.permissions.includes("timetable.edit");
      const version = query.version ?? (canEdit ? "draft" : "published");
      if (version === "draft" && !canEdit) throw new ApiError(403, "forbidden", "Only staff who build timetables can see drafts.");
      return classTimetableView(await loadYear(prisma, cls.yearId), cls.id, version);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/classes/:id/timetable",
    access: { permission: "timetable.edit" },
    summary: "Save a class's draft board; refused if someone else saved since `revision`",
    body: z.object({ revision: z.number().int().min(0), blocks: z.array(blockBody).max(300) }),
    handler: async ({ auth, params, body }): Promise<ClassTimetableView> => {
      const cls = await loadClass(auth, params.id);
      await prisma.$transaction(async (tx) => {
        await lockTimetables(tx);
        const y = await loadYear(tx, cls.yearId);
        const current = y.timetables.find((t) => t.classId === cls.id)?.revision ?? 0;
        if (current !== body.revision) throw new ApiError(409, "stale", "Someone else saved this timetable after you opened it. Reload to see their changes.");
        const blocks = body.blocks.map((b) => ({ ...b, classSubjectId: b.classSubjectId ?? undefined, label: b.label ?? undefined, room: b.room || undefined }));
        const problem = timetableProblem(blocks, { hours: y.hours, subjects: y.subjects.filter((s) => s.classId === cls.id) });
        if (problem) throw new ApiError(422, "validation", problem.message);
        await tx.timetableBlock.deleteMany({ where: { classId: cls.id, version: "draft" } });
        await tx.timetableBlock.createMany({
          data: blocks.map((b) => ({
            classId: cls.id,
            version: "draft" as const,
            day: b.day,
            start: b.start,
            end: b.end,
            kind: b.kind,
            classSubjectId: b.kind === "lesson" ? b.classSubjectId! : null,
            label: b.kind === "lesson" ? null : b.label!,
            room: b.room ?? null,
          })),
        });
        await tx.classTimetable.upsert({
          where: { classId: cls.id },
          update: { revision: current + 1, savedBy: auth.session.name },
          create: { classId: cls.id, revision: 1, savedBy: auth.session.name },
        });
        await audit(tx, auth, { action: "timetable.save", entity: "Timetable", entityId: cls.id, summary: `Saved the ${cls.name} timetable draft (${blocks.length} blocks)` });
      });
      return classTimetableView(await loadYear(prisma, cls.yearId), cls.id, "draft");
    },
  }),
  defineRoute({
    method: "POST",
    path: "/classes/:id/timetable/publish",
    access: { permission: "timetable.edit" },
    summary: "Publish a class's draft; refused if it clashes with what is live",
    handler: async ({ auth, params }): Promise<ClassTimetableView> => {
      const cls = await loadClass(auth, params.id);
      await prisma.$transaction(async (tx) => {
        await lockTimetables(tx);
        const y = await loadYear(tx, cls.yearId);
        if (!y.blocks.some((b) => b.classId === cls.id && b.version === "draft")) throw new ApiError(422, "validation", "Add something to the timetable before publishing it.");
        const clash = settlePublish(y, [cls.id]).blocked.get(cls.id)?.[0];
        if (clash) throw new ApiError(409, "timetable_clash", clash.message);
        await publishClass(tx, cls.id, auth.session.name);
        await audit(tx, auth, { action: "timetable.publish", entity: "Timetable", entityId: cls.id, summary: `Published the ${cls.name} timetable` });
      });
      return classTimetableView(await loadYear(prisma, cls.yearId), cls.id, "draft");
    },
  }),
];
