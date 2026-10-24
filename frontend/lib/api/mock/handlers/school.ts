import type { Route } from "../router";
import type { ClassDetail, ClassSummary, GradeBand } from "../../types";
import { validateBands } from "@/lib/grading";
import {
  audit,
  currentClasses,
  fail,
  requireAuth,
  requirePerm,
  toStudentListItem,
} from "../helpers";
import { nextId, type DB } from "../db";

function toClassSummary(db: DB, c: DB["classes"]["rows"][number]): ClassSummary {
  const grade = db.grades.get(c.gradeId)!;
  return {
    ...c,
    gradeName: grade.name,
    gradeNumber: grade.number,
    streamName: db.streams.get(c.streamId)?.name,
    classTeacherName: db.staff.get(c.classTeacherId)?.name,
    studentCount: db.students.rows.filter((s) => s.classId === c.id && s.status === "active").length,
  };
}

function requireStaff(ctx: Parameters<Route["handler"]>[0]) {
  const s = requireAuth(ctx);
  if (s.kind !== "staff") fail(403, "forbidden", "Staff only.");
  return s;
}

export const schoolRoutes: Route[] = [
  { method: "GET", path: "/settings/school", handler: (ctx) => (requireAuth(ctx), ctx.db.school) },
  {
    method: "PUT",
    path: "/settings/school",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const { name, shortName, motto, address, phone, email, website, principalName, smsSenderId } = ctx.body ?? {};
      if (!name?.trim()) fail(422, "validation", "School name is required.", { name: "Required" });
      if (smsSenderId && !/^[A-Za-z0-9]{3,11}$/.test(smsSenderId)) {
        fail(422, "validation", "Invalid SMS sender ID.", { smsSenderId: "3–11 letters or digits, no spaces." });
      }
      Object.assign(ctx.db.school, { name, shortName, motto, address, phone, email, website, principalName, smsSenderId });
      audit(ctx, "settings.update", "School", "Updated school profile");
      return ctx.db.school;
    },
  },
  { method: "GET", path: "/academic-years", handler: (ctx) => (requireAuth(ctx), ctx.db.years.rows) },
  {
    method: "GET",
    path: "/terms",
    handler: (ctx) => {
      requireAuth(ctx);
      const yearId = ctx.query.yearId ?? ctx.db.school.currentYearId;
      return ctx.db.terms.rows.filter((t) => t.yearId === yearId);
    },
  },
  {
    method: "PUT",
    path: "/terms/:id",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const term = ctx.db.terms.get(ctx.params.id) ?? fail(404, "not_found", "Term not found.");
      const { startDate, endDate } = ctx.body ?? {};
      if (!startDate || !endDate || startDate > endDate) {
        fail(422, "validation", "End date must be after start date.", { endDate: "Must be after the start date." });
      }
      Object.assign(term!, { startDate, endDate });
      audit(ctx, "term.update", "Term", `Updated ${term!.name} dates`);
      return term;
    },
  },
  // Public: needed by the online application form.
  { method: "GET", path: "/grades", public: true, handler: (ctx) => ctx.db.grades.rows },
  {
    method: "GET",
    path: "/public/school",
    public: true,
    handler: (ctx) => {
      const { name, shortName, motto, address, phone, email, website } = ctx.db.school;
      return { name, shortName, motto, address, phone, email, website };
    },
  },
  { method: "GET", path: "/streams", handler: (ctx) => (requireAuth(ctx), ctx.db.streams.rows) },
  {
    method: "GET",
    path: "/classes",
    handler: (ctx) => {
      requireStaff(ctx);
      const yearId = ctx.query.yearId ?? ctx.db.school.currentYearId;
      return ctx.db.classes.rows
        .filter((c) => c.yearId === yearId)
        .map((c) => toClassSummary(ctx.db, c))
        .sort((a, b) => a.gradeNumber - b.gradeNumber || a.section.localeCompare(b.section));
    },
  },
  {
    method: "GET",
    path: "/classes/:id",
    handler: (ctx): ClassDetail => {
      requirePerm(ctx, "classes.view");
      const c = ctx.db.classes.get(ctx.params.id) ?? fail(404, "not_found", "Class not found.");
      const db = ctx.db;
      return {
        ...toClassSummary(db, c!),
        subjects: db.classSubjects.rows
          .filter((cs) => cs.classId === c!.id)
          .map((cs) => ({ ...cs, subjectName: db.subjects.get(cs.subjectId)!.name, teacherName: db.staff.get(cs.teacherId)?.name })),
        students: db.students.rows
          .filter((s) => s.classId === c!.id && s.status === "active")
          .map((s) => toStudentListItem(db, s))
          .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      };
    },
  },
  {
    method: "POST",
    path: "/classes",
    handler: (ctx) => {
      requirePerm(ctx, "classes.create");
      const { gradeId, section, streamId, classTeacherId, room } = ctx.body ?? {};
      const grade = ctx.db.grades.get(gradeId) ?? fail(422, "validation", "Choose a grade.", { gradeId: "Required" });
      const sec = String(section ?? "").trim().toUpperCase();
      if (!sec) fail(422, "validation", "Section is required.", { section: "Required" });
      const name = `${grade!.number}-${sec}`;
      if (currentClasses(ctx.db).some((c) => c.name === name)) fail(409, "duplicate", `Class ${name} already exists.`, { section: "Already exists" });
      const c = ctx.db.classes.insert({
        id: nextId(ctx.db, "cls"), yearId: ctx.db.school.currentYearId, gradeId, section: sec, name,
        streamId: streamId || undefined, classTeacherId: classTeacherId || undefined, room: room || undefined,
      });
      audit(ctx, "class.create", "Class", `Created class ${name}`, c.id);
      return toClassSummary(ctx.db, c);
    },
  },
  {
    method: "PUT",
    path: "/classes/:id",
    handler: (ctx) => {
      requirePerm(ctx, "classes.edit");
      const c = ctx.db.classes.get(ctx.params.id) ?? fail(404, "not_found", "Class not found.");
      const { classTeacherId, room } = ctx.body ?? {};
      c!.classTeacherId = classTeacherId || undefined;
      c!.room = room || undefined;
      audit(ctx, "class.update", "Class", `Updated class ${c!.name}`, c!.id);
      return toClassSummary(ctx.db, c!);
    },
  },
  {
    method: "PUT",
    path: "/class-subjects/:id",
    handler: (ctx) => {
      requirePerm(ctx, "classes.edit");
      const cs = ctx.db.classSubjects.get(ctx.params.id) ?? fail(404, "not_found", "Not found.");
      cs!.teacherId = ctx.body?.teacherId || undefined;
      audit(ctx, "class.teacher", "Class", `Assigned ${ctx.db.staff.get(cs!.teacherId)?.name ?? "no teacher"} to ${ctx.db.subjects.get(cs!.subjectId)?.name} in ${ctx.db.classes.get(cs!.classId)?.name}`);
      return cs;
    },
  },
  { method: "GET", path: "/subjects", handler: (ctx) => (requireAuth(ctx), ctx.db.subjects.rows) },
  {
    method: "POST",
    path: "/subjects",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const { name, code, levels, basket } = ctx.body ?? {};
      if (!name?.trim()) fail(422, "validation", "Name is required.", { name: "Required" });
      const upper = String(code ?? "").trim().toUpperCase();
      if (!/^[A-Z]{2,6}$/.test(upper)) fail(422, "validation", "Invalid code.", { code: "2–6 letters." });
      if (ctx.db.subjects.rows.some((s) => s.code === upper)) fail(409, "duplicate", "Code already in use.", { code: "Already in use" });
      if (!Array.isArray(levels) || levels.length === 0) fail(422, "validation", "Choose at least one level.", { levels: "Required" });
      const s = ctx.db.subjects.insert({ id: `sub_${upper.toLowerCase()}`, name: name.trim(), code: upper, levels, basket: basket || undefined });
      audit(ctx, "subject.create", "Subject", `Added subject ${s.name}`, s.id);
      return s;
    },
  },
  {
    method: "PUT",
    path: "/subjects/:id",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const s = ctx.db.subjects.get(ctx.params.id) ?? fail(404, "not_found", "Subject not found.");
      const { name, levels, basket } = ctx.body ?? {};
      if (!name?.trim()) fail(422, "validation", "Name is required.", { name: "Required" });
      Object.assign(s!, { name: name.trim(), levels, basket: basket || undefined });
      audit(ctx, "subject.update", "Subject", `Updated subject ${s!.name}`, s!.id);
      return s;
    },
  },
  { method: "GET", path: "/grade-bands", handler: (ctx) => (requireAuth(ctx), ctx.db.gradeBands) },
  {
    method: "PUT",
    path: "/grade-bands",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const bands = ctx.body?.bands as GradeBand[];
      const err = Array.isArray(bands) ? validateBands(bands) : "Invalid bands.";
      if (err) fail(422, "validation", err);
      ctx.db.gradeBands = bands.map((b) => ({ ...b })).sort((a, b) => b.min - a.min);
      audit(ctx, "settings.gradeBands", "Grade bands", "Updated grading scale");
      return ctx.db.gradeBands;
    },
  },
  {
    method: "GET",
    path: "/staff",
    handler: (ctx) => {
      requireStaff(ctx);
      return ctx.db.staff.rows.filter((s) => s.status === "active").sort((a, b) => a.name.localeCompare(b.name));
    },
  },
];
