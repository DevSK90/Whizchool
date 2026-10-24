import type { Route } from "../router";
import type { ClassDetail, ClassSummary, GradeBand, GradeLevel, Subject } from "@whizchool/shared/types";
import { validateTerms } from "@whizchool/shared/calendar";
import { validateBands } from "@whizchool/shared/grading";
import {
  audit,
  currentClasses,
  fail,
  hasFullScope,
  requireAuth,
  requirePerm,
  toStudentListItem,
  type Ctx,
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A class teacher must be active staff and lead at most one class per academic year. */
function checkClassTeacher(ctx: Ctx, teacherId: string | undefined, yearId: string, exceptClassId?: string) {
  if (!teacherId) return;
  const teacher = ctx.db.staff.get(teacherId);
  if (!teacher || teacher.status !== "active") fail(422, "validation", "Choose an active staff member.", { classTeacherId: "Choose an active staff member" });
  const other = ctx.db.classes.rows.find((c) => c.yearId === yearId && c.classTeacherId === teacherId && c.id !== exceptClassId);
  if (other) fail(409, "duplicate", `${teacher!.name} is already the class teacher of ${other.name}.`, { classTeacherId: `Already class teacher of ${other.name}` });
}

/** Applies term date changes after validating the whole year's set together. */
function saveTerms(ctx: Ctx, changes: { id: string; startDate?: string; endDate?: string }[]) {
  const terms = changes.map((c) => ctx.db.terms.get(c.id) ?? fail(404, "not_found", "Term not found."));
  const yearIds = new Set(terms.map((t) => t!.yearId));
  if (yearIds.size !== 1) fail(422, "validation", "Save one academic year's terms at a time.");
  const year = ctx.db.years.get([...yearIds][0])!;
  const dated = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  for (const c of changes) if (!dated(c.startDate) || !dated(c.endDate)) fail(422, "validation", "Enter valid dates.", { [`${c.id}.startDate`]: "Enter a valid date" });
  const byId = new Map(changes.map((c) => [c.id, c]));
  const merged = ctx.db.terms.rows.filter((t) => t.yearId === year.id).map((t) => ({ ...t, ...byId.get(t.id) }) as typeof t);
  const problem = validateTerms(year, merged);
  if (problem) {
    const term = merged.find((t) => t.id === problem.termId)!;
    fail(422, "validation", `${term.name}: ${problem.message}`, { [`${term.id}.${problem.field}`]: problem.message });
  }
  for (const c of changes) Object.assign(ctx.db.terms.get(c.id)!, { startDate: c.startDate, endDate: c.endDate });
  audit(ctx, "term.update", "Term", `Updated ${merged.filter((t) => byId.has(t.id)).map((t) => t.name).join(", ")} dates for ${year.name}`);
  return ctx.db.terms.rows.filter((t) => t.yearId === year.id).sort((a, b) => a.number - b.number);
}

const LEVELS: GradeLevel[] = ["primary", "junior", "ol", "al"];

/** Field errors for a subject's name, levels and basket (all reported at once, like the real API). */
function subjectErrors(name: unknown, levels: unknown, basket: unknown) {
  const f: Record<string, string> = {};
  if (typeof name !== "string" || !name.trim()) f.name = "Required";
  if (!Array.isArray(levels) || !levels.length || levels.some((l) => !LEVELS.includes(l))) f.levels = "Choose at least one level";
  if (basket !== undefined && basket !== null && basket !== "" && ![1, 2, 3].includes(Number(basket))) f.basket = "Choose basket 1, 2 or 3";
  return f;
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
      const f: Record<string, string> = {};
      if (!name?.trim()) f.name = "Required";
      if (!shortName?.trim()) f.shortName = "Required";
      if (email && !EMAIL.test(email)) f.email = "Enter a valid email";
      if (!/^[A-Za-z0-9]{3,11}$/.test(smsSenderId ?? "")) f.smsSenderId = "3–11 letters or digits, no spaces.";
      if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
      Object.assign(ctx.db.school, {
        name: name.trim(), shortName: shortName.trim(), motto: motto ?? "", address: address ?? "", phone: phone ?? "", email: email ?? "",
        website: website || undefined, principalName: principalName ?? "", smsSenderId: smsSenderId.toUpperCase(),
      });
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
    path: "/terms",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const terms = ctx.body?.terms;
      if (!Array.isArray(terms) || !terms.length) fail(422, "validation", "Send the terms to update.");
      return saveTerms(ctx, terms);
    },
  },
  {
    method: "PUT",
    path: "/terms/:id",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      return saveTerms(ctx, [{ id: ctx.params.id, ...ctx.body }]).find((t) => t.id === ctx.params.id);
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
      const s = requirePerm(ctx, "classes.view");
      const c = ctx.db.classes.get(ctx.params.id) ?? fail(404, "not_found", "Class not found.");
      const db = ctx.db;
      // Teachers only open classes they lead or teach in; fee balances only for fee viewers.
      const teaches = s.classIds.includes(c!.id) || s.classSubjectIds.some((id) => db.classSubjects.get(id)?.classId === c!.id);
      if (s.kind !== "staff" || (!hasFullScope(s, "classes.view", db) && !teaches)) fail(403, "forbidden", "You can only open classes you teach.");
      const withBalance = s.permissions.includes("fees.view");
      return {
        ...toClassSummary(db, c!),
        subjects: db.classSubjects.rows
          .filter((cs) => cs.classId === c!.id)
          .map((cs) => ({ ...cs, subjectName: db.subjects.get(cs.subjectId)!.name, teacherName: db.staff.get(cs.teacherId)?.name })),
        students: db.students.rows
          .filter((s) => s.classId === c!.id && s.status === "active")
          .map((st) => {
            const row = toStudentListItem(db, st);
            return withBalance ? row : { ...row, balance: 0 };
          })
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
      if (!/^[A-Z0-9]{1,6}$/.test(sec)) fail(422, "validation", "Please fix the highlighted fields.", { section: "1–6 letters or digits, e.g. A or PS." });
      // Streams only apply to A/L; a stale value from a hidden field is ignored for other grades.
      const stream = grade!.level === "al" ? ctx.db.streams.get(streamId) : undefined;
      if (grade!.level === "al" && !stream) fail(422, "validation", "Choose a stream for an A/L class.", { streamId: "Required for Grades 12–13" });
      const name = `${grade!.number}-${sec}`;
      if (currentClasses(ctx.db).some((c) => c.name === name)) fail(409, "duplicate", `Class ${name} already exists.`, { section: "Already exists" });
      checkClassTeacher(ctx, classTeacherId || undefined, ctx.db.school.currentYearId);
      const c = ctx.db.classes.insert({
        id: nextId(ctx.db, "cls"), yearId: ctx.db.school.currentYearId, gradeId, section: sec, name,
        streamId: stream?.id, classTeacherId: classTeacherId || undefined, room: room?.trim() || undefined,
      });
      // A class starts with the subjects of its grade level, or of its stream for A/L.
      const subjects = ctx.db.subjects.rows.filter((sub) =>
        grade!.level === "al" ? sub.levels.includes("al") && (sub.streamIds ?? []).includes(stream!.id) : sub.levels.includes(grade!.level),
      );
      for (const sub of subjects) ctx.db.classSubjects.insert({ id: nextId(ctx.db, "cs"), classId: c.id, subjectId: sub.id });
      audit(ctx, "class.create", "Class", `Created class ${name} with ${subjects.length} subjects`, c.id);
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
      checkClassTeacher(ctx, classTeacherId || undefined, c!.yearId, c!.id);
      c!.classTeacherId = classTeacherId || undefined;
      c!.room = room?.trim() || undefined;
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
      const teacherId = ctx.body?.teacherId || undefined;
      if (teacherId && ctx.db.staff.get(teacherId)?.status !== "active") fail(422, "validation", "Choose an active staff member.", { teacherId: "Choose an active staff member" });
      cs!.teacherId = teacherId;
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
      const upper = String(code ?? "").trim().toUpperCase();
      const f = subjectErrors(name, levels, basket);
      if (!/^[A-Z]{2,6}$/.test(upper)) f.code = "2–6 letters.";
      if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
      if (ctx.db.subjects.rows.some((s) => s.code === upper)) fail(409, "duplicate", "Code already in use.", { code: "Already in use" });
      const s = ctx.db.subjects.insert({ id: `sub_${upper.toLowerCase()}`, name: name.trim(), code: upper, levels: [...new Set(levels as GradeLevel[])], basket: (Number(basket) || undefined) as Subject["basket"] });
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
      const f = subjectErrors(name, levels, basket);
      if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
      Object.assign(s!, { name: name.trim(), levels: [...new Set(levels as GradeLevel[])], basket: (Number(basket) || undefined) as Subject["basket"] });
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
      const letters = Array.isArray(bands) ? bands.map((b) => String(b.grade).trim().toUpperCase()) : [];
      const dup = letters.find((g, i) => letters.indexOf(g) !== i);
      const err = !Array.isArray(bands) || bands.length < 2 ? "Use at least two bands." : dup ? `Grade ${dup} is used twice.` : validateBands(bands);
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
