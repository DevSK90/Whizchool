import type { Route } from "../router";
import type { ClassTimetableView, TimetableBlockInput, TimetableOverviewRow, TimetablePublishResult, TimetableVersion } from "@whizchool/shared/types";
import {
  classTimetableView,
  reassignmentClash,
  settlePublish,
  studentTimetable,
  teacherTimetable,
  timetableOverview,
  timetableProblem,
  type StoredBlock,
  type YearTimetables,
} from "@whizchool/shared/timetable";
import { assertStudentAccess, audit, fail, hasFullScope, isoNow, requireAuth, requirePerm, type Ctx } from "../helpers";
import { nextId, type DB } from "../db";

export function yearTimetables(db: DB, yearId: string): YearTimetables {
  const classes = db.classes.rows.filter((c) => c.yearId === yearId);
  const ids = new Set(classes.map((c) => c.id));
  return {
    hours: { start: db.school.timetableStart, end: db.school.timetableEnd },
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      gradeId: c.gradeId,
      gradeNumber: db.grades.get(c.gradeId)!.number,
      ...(c.room ? { room: c.room } : {}),
      ...(db.staff.get(c.classTeacherId) ? { classTeacherName: db.staff.get(c.classTeacherId)!.name } : {}),
    })),
    subjects: db.classSubjects.rows
      .filter((cs) => ids.has(cs.classId))
      .map((cs) => {
        const subject = db.subjects.get(cs.subjectId)!;
        const teacher = db.staff.get(cs.teacherId);
        return {
          id: cs.id,
          classId: cs.classId,
          subjectId: cs.subjectId,
          subjectName: subject.name,
          subjectCode: subject.code,
          ...(cs.optionGroup ? { optionGroup: cs.optionGroup } : {}),
          ...(teacher ? { teacherId: teacher.id, teacherName: teacher.name } : {}),
        };
      }),
    timetables: db.timetables.filter((t) => ids.has(t.classId)),
    blocks: db.timetableBlocks.filter((b) => ids.has(b.classId)),
  };
}

const viewer = (ctx: Ctx, classId: string) => {
  const s = requirePerm(ctx, "timetable.view");
  const taught = ctx.db.classSubjects.rows.some((cs) => cs.classId === classId && s.classSubjectIds.includes(cs.id));
  if (!hasFullScope(s, "timetable.view", ctx.db) && !s.classIds.includes(classId) && !taught) fail(403, "forbidden", "You can only see the timetables of classes you teach.");
  return s;
};

function loadClass(ctx: Ctx) {
  return ctx.db.classes.get(ctx.params.id) ?? fail(404, "not_found", "Class not found.");
}

function goLive(ctx: Ctx, classId: string, by: string) {
  const db = ctx.db;
  db.timetableBlocks = db.timetableBlocks.filter((b) => !(b.classId === classId && b.version === "published"));
  for (const b of db.timetableBlocks.filter((x) => x.classId === classId && x.version === "draft")) {
    db.timetableBlocks.push({ ...b, id: nextId(db, "ttb"), version: "published" });
  }
  const t = db.timetables.find((x) => x.classId === classId)!;
  Object.assign(t, { publishedRevision: t.revision, publishedAt: isoNow(ctx), publishedBy: by });
}

/** Next year's class starts from a copy of this year's draft, unpublished, with subjects matched by name of subject. */
export function copyTimetable(db: DB, fromClassId: string, toClassId: string) {
  const subjectOf = new Map(db.classSubjects.rows.filter((cs) => cs.classId === toClassId).map((cs) => [cs.subjectId, cs.id]));
  const from = new Map(db.classSubjects.rows.filter((cs) => cs.classId === fromClassId).map((cs) => [cs.id, cs.subjectId]));
  const blocks = db.timetableBlocks.filter((b) => b.classId === fromClassId && b.version === "draft");
  if (!blocks.length) return;
  for (const b of blocks) {
    const { classSubjectId, ...rest } = b;
    const mapped = classSubjectId ? subjectOf.get(from.get(classSubjectId) ?? "") : undefined;
    db.timetableBlocks.push({ ...rest, id: nextId(db, "ttb"), classId: toClassId, ...(mapped ? { classSubjectId: mapped } : {}) });
  }
  db.timetables.push({ classId: toClassId, revision: 1 });
}

/** Refuses a change of teacher that would clash with a published timetable. */
export function checkReassignment(db: DB, classSubjectId: string, teacherId: string | undefined) {
  if (!teacherId) return;
  const cs = db.classSubjects.get(classSubjectId)!;
  const cls = db.classes.get(cs.classId)!;
  const clash = reassignmentClash(yearTimetables(db, cls.yearId), classSubjectId, teacherId, db.staff.get(teacherId)!.name);
  if (clash) fail(409, "timetable_clash", clash.message, { teacherId: clash.message });
}

/** Refuses school hours that would leave a saved block outside the day. */
export function checkSchoolHours(db: DB, start: number, end: number) {
  const inYear = new Set(db.classes.rows.filter((c) => c.yearId === db.school.currentYearId).map((c) => c.id));
  if (db.timetableBlocks.some((b) => inYear.has(b.classId) && (b.start < start || b.end > end))) {
    fail(409, "timetable_hours", "Some timetables have blocks outside those hours. Move them first.", { timetableEnd: "Timetables use times outside these hours" });
  }
}

export const timetableRoutes: Route[] = [
  {
    method: "GET",
    path: "/timetables/overview",
    handler: (ctx): TimetableOverviewRow[] => {
      const s = requirePerm(ctx, "timetable.view");
      const rows = timetableOverview(yearTimetables(ctx.db, ctx.db.school.currentYearId));
      if (s.permissions.includes("timetable.edit")) return rows;
      const taught = new Set(ctx.db.classSubjects.rows.filter((cs) => s.classSubjectIds.includes(cs.id)).map((cs) => cs.classId));
      const full = hasFullScope(s, "timetable.view", ctx.db);
      return rows
        .filter((r) => r.publishedLessons > 0 && (full || s.classIds.includes(r.classId) || taught.has(r.classId)))
        .map((r) => ({ ...r, lessons: r.publishedLessons, hasUnpublishedChanges: false, clashes: 0 }));
    },
  },
  {
    method: "POST",
    path: "/timetables/publish",
    handler: (ctx): TimetablePublishResult => {
      const s = requirePerm(ctx, "timetable.edit");
      const y = yearTimetables(ctx.db, ctx.db.school.currentYearId);
      const waiting = timetableOverview(y).filter((r) => r.hasUnpublishedChanges && r.lessons > 0);
      const { publishable, blocked } = settlePublish(y, waiting.map((r) => r.classId));
      for (const id of publishable) goLive(ctx, id, s.name);
      const nameOf = new Map(waiting.map((r) => [r.classId, r.className]));
      if (publishable.length) audit(ctx, "timetable.publish", "Timetable", `Published ${publishable.length} class timetables`);
      return {
        published: publishable.map((classId) => ({ classId, className: nameOf.get(classId)! })),
        blocked: [...blocked].map(([classId, clashes]) => ({ classId, className: nameOf.get(classId)!, message: clashes[0]!.message })),
      };
    },
  },
  {
    method: "GET",
    path: "/timetables/me",
    handler: (ctx) => {
      requirePerm(ctx, "timetable.view");
      const staff = ctx.db.staff.get(ctx.user?.staffId) ?? fail(403, "forbidden", "Staff only.");
      return teacherTimetable(yearTimetables(ctx.db, ctx.db.school.currentYearId), staff!);
    },
  },
  {
    method: "GET",
    path: "/staff/:id/timetable",
    handler: (ctx) => {
      const s = requirePerm(ctx, "timetable.view");
      if (!hasFullScope(s, "timetable.view", ctx.db)) fail(403, "forbidden", "You can only see your own timetable.");
      const staff = ctx.db.staff.get(ctx.params.id) ?? fail(404, "not_found", "Staff member not found.");
      return teacherTimetable(yearTimetables(ctx.db, ctx.db.school.currentYearId), staff!);
    },
  },
  {
    method: "GET",
    path: "/students/:id/timetable",
    handler: (ctx) => {
      const s = requireAuth(ctx);
      if (s.kind !== "parent") requirePerm(ctx, "timetable.view");
      assertStudentAccess(ctx, ctx.params.id);
      const student = ctx.db.students.get(ctx.params.id)!;
      const cls = ctx.db.classes.get(student.classId)!;
      return studentTimetable(yearTimetables(ctx.db, cls.yearId), { id: student.id, classId: cls.id, electiveSubjectIds: student.electiveSubjectIds ?? [] });
    },
  },
  {
    method: "GET",
    path: "/classes/:id/timetable",
    handler: (ctx): ClassTimetableView => {
      const cls = loadClass(ctx)!;
      const s = viewer(ctx, cls.id);
      const canEdit = s.permissions.includes("timetable.edit");
      const version = (ctx.query.version ?? (canEdit ? "draft" : "published")) as TimetableVersion;
      if (version !== "draft" && version !== "published") fail(422, "validation", "Choose draft or published.");
      if (version === "draft" && !canEdit) fail(403, "forbidden", "Only staff who build timetables can see drafts.");
      return classTimetableView(yearTimetables(ctx.db, cls.yearId), cls.id, version);
    },
  },
  {
    method: "PUT",
    path: "/classes/:id/timetable",
    handler: (ctx): ClassTimetableView => {
      const cls = loadClass(ctx)!;
      viewer(ctx, cls.id);
      const s = requirePerm(ctx, "timetable.edit");
      const db = ctx.db;
      const blocks = (ctx.body?.blocks ?? []) as TimetableBlockInput[];
      const y = yearTimetables(db, cls.yearId);
      const current = y.timetables.find((t) => t.classId === cls.id);
      if ((current?.revision ?? 0) !== ctx.body?.revision) fail(409, "stale", "Someone else saved this timetable after you opened it. Reload to see their changes.");
      const view = classTimetableView(y, cls.id, "draft");
      const problem = timetableProblem(blocks, { hours: y.hours, subjects: view.subjects });
      if (problem) fail(422, "validation", problem.message);
      db.timetableBlocks = db.timetableBlocks.filter((b) => !(b.classId === cls.id && b.version === "draft"));
      for (const b of blocks) {
        const row: StoredBlock = {
          id: nextId(db, "ttb"),
          classId: cls.id,
          version: "draft",
          day: b.day,
          start: b.start,
          end: b.end,
          kind: b.kind,
          ...(b.kind === "lesson" ? { classSubjectId: b.classSubjectId } : { label: b.label!.trim() }),
          ...(b.room?.trim() ? { room: b.room.trim() } : {}),
        };
        db.timetableBlocks.push(row);
      }
      if (current) Object.assign(current, { revision: current.revision + 1, savedBy: s.name });
      else db.timetables.push({ classId: cls.id, revision: 1, savedBy: s.name });
      audit(ctx, "timetable.save", "Timetable", `Saved the ${cls.name} timetable draft (${blocks.length} blocks)`, cls.id);
      return classTimetableView(yearTimetables(db, cls.yearId), cls.id, "draft");
    },
  },
  {
    method: "POST",
    path: "/classes/:id/timetable/publish",
    handler: (ctx): ClassTimetableView => {
      const cls = loadClass(ctx)!;
      viewer(ctx, cls.id);
      const s = requirePerm(ctx, "timetable.edit");
      const y = yearTimetables(ctx.db, cls.yearId);
      if (!y.blocks.some((b) => b.classId === cls.id && b.version === "draft")) fail(422, "validation", "Add something to the timetable before publishing it.");
      const clash = settlePublish(y, [cls.id]).blocked.get(cls.id)?.[0];
      if (clash) fail(409, "timetable_clash", clash.message);
      goLive(ctx, cls.id, s.name);
      audit(ctx, "timetable.publish", "Timetable", `Published the ${cls.name} timetable`, cls.id);
      return classTimetableView(yearTimetables(ctx.db, cls.yearId), cls.id, "draft");
    },
  },
];
