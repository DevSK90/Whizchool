import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { missingChoices, optionGroupFor, startsInClass } from "@whizchool/shared/curriculum";
import { reassignmentClash } from "@whizchool/shared/timetable";
import type { ClassDetail, ClassSubject, ClassSummary, GradeLevel } from "@whizchool/shared/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth/context";
import { canSeeClass } from "../auth/scope";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { omitNulls } from "../http/list";
import { defineRoute } from "../http/route";
import { currentYearId } from "../school";
import { loadYear, lockTimetables } from "../services/timetables";
import { studentListInclude, toStudentListItems } from "../students";

const summaryInclude = {
  grade: { select: { name: true, number: true, level: true } },
  stream: { select: { name: true, optionsRequired: true } },
  classTeacher: { select: { name: true } },
  _count: { select: { students: { where: { status: "active" } } } },
} satisfies Prisma.ClassSectionInclude;

type ClassRow = Prisma.ClassSectionGetPayload<{ include: typeof summaryInclude }>;

function toSummary(c: ClassRow): ClassSummary {
  return omitNulls({
    id: c.id,
    yearId: c.yearId,
    gradeId: c.gradeId,
    section: c.section,
    name: c.name,
    streamId: c.streamId,
    classTeacherId: c.classTeacherId,
    room: c.room,
    gradeName: c.grade.name,
    gradeNumber: c.grade.number,
    streamName: c.stream?.name ?? null,
    classTeacherName: c.classTeacher?.name ?? null,
    studentCount: c._count.students,
  });
}

const notFound = () => new ApiError(404, "not_found", "Class not found.");

/** Empty strings from cleared form fields mean "none". */
const optionalId = z
  .string()
  .max(100)
  .nullish()
  .transform((v) => v || null);

const room = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((v) => v || null);

/** A class teacher must be active staff and lead at most one class per academic year. */
async function checkClassTeacher(teacherId: string | null, yearId: string, exceptClassId?: string) {
  if (!teacherId) return;
  const teacher = await prisma.staff.findUnique({ where: { id: teacherId }, select: { name: true, status: true } });
  if (!teacher || teacher.status !== "active") {
    throw new ApiError(422, "validation", "Choose an active staff member.", { classTeacherId: "Choose an active staff member" });
  }
  const other = await prisma.classSection.findFirst({
    where: { yearId, classTeacherId: teacherId, ...(exceptClassId ? { id: { not: exceptClassId } } : {}) },
    select: { name: true },
  });
  if (other) {
    throw new ApiError(409, "duplicate", `${teacher.name} is already the class teacher of ${other.name}.`, {
      classTeacherId: `Already class teacher of ${other.name}`,
    });
  }
}

/** The subjects a level or stream can offer. */
function catalogueWhere(level: string, streamId: string | null): Prisma.SubjectWhereInput {
  return level === "al" ? { levels: { has: "al" }, streams: { some: { streamId: streamId ?? "" } } } : { levels: { has: level as "primary" } };
}

/**
 * What a new class starts with: everything that isn't a choice, plus the choices
 * another class of its grade (and stream) offers this year. The school adds or removes the rest.
 */
async function startingSubjects(grade: { id: string; level: GradeLevel }, streamId: string | null, yearId: string) {
  const [catalogue, siblings] = await Promise.all([
    prisma.subject.findMany({ where: catalogueWhere(grade.level, streamId), select: { id: true, basket: true, choiceGroup: true, streams: { where: { streamId: streamId ?? "" }, select: { optional: true } } } }),
    prisma.classSubject.findMany({ where: { class: { yearId, gradeId: grade.id, streamId } }, select: { subjectId: true } }),
  ]);
  const offered = new Set(siblings.map((s) => s.subjectId));
  return catalogue
    .map((s) => ({ subjectId: s.id, optionGroup: optionGroupFor(grade.level, s, s.streams[0]) }))
    .filter((s) => startsInClass(s.optionGroup) || offered.has(s.subjectId));
}

async function loadSummary(id: string) {
  const c = await prisma.classSection.findUnique({ where: { id }, include: summaryInclude });
  if (!c) throw notFound();
  return c;
}

function assertClassAccess(auth: AuthContext, classId: string) {
  if (!canSeeClass(auth, classId, "classes.view")) {
    throw new ApiError(403, "forbidden", "You can only open classes you teach.");
  }
}

export const classRoutes = [
  defineRoute({
    method: "GET",
    path: "/classes",
    access: "session",
    summary: "Classes of an academic year (default: current) with counts; staff only",
    query: z.object({ yearId: z.string().max(100).optional() }),
    handler: async ({ session, query }) => {
      if (session.kind !== "staff") throw new ApiError(403, "forbidden", "Staff only.");
      const yearId = query.yearId || (await currentYearId());
      const classes = await prisma.classSection.findMany({ where: { yearId }, include: summaryInclude });
      return classes.map(toSummary).sort((a, b) => a.gradeNumber - b.gradeNumber || a.section.localeCompare(b.section));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/classes/:id",
    access: { permission: "classes.view" },
    summary: "A class with its subjects, teachers and students (teachers: only classes they teach)",
    handler: async ({ auth, params }): Promise<ClassDetail> => {
      const c = await loadSummary(params.id);
      assertClassAccess(auth, c.id);
      const [subjects, students, choices] = await Promise.all([
        prisma.classSubject.findMany({
          where: { classId: c.id },
          include: { subject: { select: { name: true } }, teacher: { select: { name: true } } },
          orderBy: [{ optionGroup: { sort: "asc", nulls: "first" } }, { subject: { name: "asc" } }],
        }),
        prisma.student.findMany({ where: { classId: c.id, status: "active" }, include: studentListInclude, orderBy: [{ firstName: "asc" }, { lastName: "asc" }] }),
        prisma.studentSubject.findMany({ where: { student: { classId: c.id, status: "active" } }, select: { studentId: true, subjectId: true } }),
      ]);
      const optionsRequired = c.stream?.optionsRequired ?? 0;
      const chosen = new Map<string, Set<string>>();
      for (const x of choices) (chosen.get(x.studentId) ?? chosen.set(x.studentId, new Set()).get(x.studentId)!).add(x.subjectId);
      return {
        ...toSummary(c),
        ...(optionsRequired ? { optionsRequired } : {}),
        pendingChoices: students.filter((s) => missingChoices(subjects, chosen.get(s.id) ?? new Set(), optionsRequired)).length,
        subjects: subjects.map((cs) =>
          omitNulls({ id: cs.id, classId: cs.classId, subjectId: cs.subjectId, teacherId: cs.teacherId, optionGroup: cs.optionGroup, subjectName: cs.subject.name, teacherName: cs.teacher?.name ?? null }),
        ),
        students: await toStudentListItems(prisma, students, { withBalance: auth.session.permissions.includes("fees.view") }),
      };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/classes",
    access: { permission: "classes.create" },
    summary: "Create a class in the current year; it starts with the subjects of its grade (or stream)",
    body: z.object({
      gradeId: z.string().min(1, "Required").max(100),
      section: z
        .string()
        .trim()
        .transform((s) => s.toUpperCase())
        .pipe(z.string().regex(/^[A-Z0-9]{1,6}$/, "1–6 letters or digits, e.g. A or PS.")),
      streamId: optionalId,
      classTeacherId: optionalId,
      room,
    }),
    handler: async ({ auth, body }) => {
      const grade = await prisma.grade.findUnique({ where: { id: body.gradeId } });
      if (!grade) throw new ApiError(422, "validation", "Choose a grade.", { gradeId: "Required" });
      // Streams only apply to A/L; a stale value from a hidden field is ignored for other grades.
      const streamId = grade.level === "al" ? body.streamId : null;
      if (grade.level === "al") {
        if (!streamId || !(await prisma.stream.findUnique({ where: { id: streamId }, select: { id: true } }))) {
          throw new ApiError(422, "validation", "Choose a stream for an A/L class.", { streamId: "Required for Grades 12–13" });
        }
      }
      const yearId = await currentYearId();
      const name = `${grade.number}-${body.section}`;
      if (await prisma.classSection.findUnique({ where: { yearId_name: { yearId, name } }, select: { id: true } })) {
        throw new ApiError(409, "duplicate", `Class ${name} already exists.`, { section: "Already exists" });
      }
      await checkClassTeacher(body.classTeacherId, yearId);
      const subjects = await startingSubjects(grade, streamId, yearId);
      const created = await prisma.$transaction(async (tx) => {
        const c = await tx.classSection.create({
          data: { yearId, gradeId: grade.id, section: body.section, name, streamId, classTeacherId: body.classTeacherId, room: body.room },
        });
        await tx.classSubject.createMany({ data: subjects.map((s) => ({ classId: c.id, ...s })) });
        await audit(tx, auth, { action: "class.create", entity: "Class", entityId: c.id, summary: `Created class ${name} with ${subjects.length} subjects` });
        return c;
      });
      return toSummary(await loadSummary(created.id));
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/classes/:id",
    access: { permission: "classes.edit" },
    summary: "Change a class's class teacher or room",
    body: z.object({ classTeacherId: optionalId, room }),
    handler: async ({ auth, params, body }) => {
      const before = await loadSummary(params.id);
      await checkClassTeacher(body.classTeacherId, before.yearId, before.id);
      await prisma.$transaction(async (tx) => {
        const after = await tx.classSection.update({
          where: { id: before.id },
          data: { classTeacherId: body.classTeacherId, room: body.room },
          include: { classTeacher: { select: { name: true } } },
        });
        await audit(tx, auth, {
          action: "class.update",
          entity: "Class",
          entityId: before.id,
          summary: `Updated class ${before.name}`,
          before: { classTeacher: before.classTeacher?.name ?? null, room: before.room },
          after: { classTeacher: after.classTeacher?.name ?? null, room: after.room },
        });
      });
      return toSummary(await loadSummary(before.id));
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/class-subjects/:id",
    access: { permission: "classes.edit" },
    summary: "Assign (or clear) the teacher of one subject in one class",
    body: z.object({ teacherId: optionalId }),
    handler: async ({ auth, params, body }): Promise<ClassSubject> => {
      const cs = await prisma.classSubject.findUnique({
        where: { id: params.id },
        include: { subject: { select: { name: true } }, class: { select: { name: true, yearId: true } }, teacher: { select: { name: true } } },
      });
      if (!cs) throw new ApiError(404, "not_found", "Not found.");
      const teacher = body.teacherId ? await prisma.staff.findUnique({ where: { id: body.teacherId }, select: { name: true, status: true } }) : null;
      if (body.teacherId && (!teacher || teacher.status !== "active")) {
        throw new ApiError(422, "validation", "Choose an active staff member.", { teacherId: "Choose an active staff member" });
      }
      // A subject with no teacher list yet can go to anyone.
      const listed = await prisma.subjectTeacher.findMany({ where: { subjectId: cs.subjectId }, select: { staffId: true } });
      if (body.teacherId && listed.length && !listed.some((t) => t.staffId === body.teacherId)) {
        const message = `${teacher!.name} isn't on the ${cs.subject.name} teacher list. Add them in School settings first.`;
        throw new ApiError(422, "validation", message, { teacherId: message });
      }
      const updated = await prisma.$transaction(async (tx) => {
        await lockTimetables(tx);
        if (body.teacherId) {
          const clash = reassignmentClash(await loadYear(tx, cs.class.yearId), cs.id, body.teacherId, teacher!.name);
          if (clash) throw new ApiError(409, "timetable_clash", clash.message, { teacherId: clash.message });
        }
        const updated = await tx.classSubject.update({ where: { id: cs.id }, data: { teacherId: body.teacherId } });
        await audit(tx, auth, {
          action: "class.teacher",
          entity: "Class",
          entityId: cs.classId,
          summary: `Assigned ${teacher?.name ?? "no teacher"} to ${cs.subject.name} in ${cs.class.name}`,
          before: { teacher: cs.teacher?.name ?? null },
          after: { teacher: teacher?.name ?? null },
        });
        return updated;
      });
      return omitNulls({ id: updated.id, classId: updated.classId, subjectId: updated.subjectId, teacherId: updated.teacherId, optionGroup: updated.optionGroup });
    },
  }),
  defineRoute({
    method: "POST",
    path: "/classes/:id/subjects",
    access: { permission: "classes.edit" },
    summary: "Offer another subject in a class, from those of its grade level or stream",
    body: z.object({ subjectId: z.string().min(1, "Choose a subject").max(100) }),
    handler: async ({ auth, params, body }): Promise<ClassSubject> => {
      const c = await loadSummary(params.id);
      const subject = await prisma.subject.findFirst({
        where: { id: body.subjectId, ...catalogueWhere(c.grade.level, c.streamId) },
        select: { id: true, name: true, basket: true, choiceGroup: true, streams: { where: { streamId: c.streamId ?? "" }, select: { optional: true } } },
      });
      if (!subject) throw new ApiError(422, "validation", "This class's grade doesn't offer that subject.", { subjectId: "Not offered at this grade" });
      if (await prisma.classSubject.findUnique({ where: { classId_subjectId: { classId: c.id, subjectId: subject.id } }, select: { id: true } })) {
        throw new ApiError(409, "duplicate", `${c.name} already offers ${subject.name}.`, { subjectId: "Already offered" });
      }
      const created = await prisma.$transaction(async (tx) => {
        const created = await tx.classSubject.create({ data: { classId: c.id, subjectId: subject.id, optionGroup: optionGroupFor(c.grade.level, subject, subject.streams[0]) } });
        await audit(tx, auth, { action: "class.subject", entity: "Class", entityId: c.id, summary: `Added ${subject.name} to ${c.name}` });
        return created;
      });
      return omitNulls({ id: created.id, classId: created.classId, subjectId: created.subjectId, optionGroup: created.optionGroup });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/class-subjects/:id",
    access: { permission: "classes.edit" },
    summary: "Stop offering a subject in a class; refused once it has marks, students choosing it or published lessons",
    handler: async ({ auth, params }) => {
      const cs = await prisma.classSubject.findUnique({ where: { id: params.id }, include: { subject: { select: { name: true } }, class: { select: { name: true } } } });
      if (!cs) throw new ApiError(404, "not_found", "Not found.");
      const refuse = (reason: string) => new ApiError(409, "in_use", `${cs.subject.name} can't be removed from ${cs.class.name}: ${reason}`);
      const student = { classId: cs.classId, status: "active" as const };
      if (await prisma.mark.count({ where: { subjectId: cs.subjectId, student } })) throw refuse("it has marks.");
      if (await prisma.studentSubject.count({ where: { subjectId: cs.subjectId, student } })) throw refuse("students have chosen it.");
      if (await prisma.timetableBlock.count({ where: { classSubjectId: cs.id, version: "published" } })) throw refuse("it's on the published timetable.");
      await prisma.$transaction(async (tx) => {
        await tx.classSubject.delete({ where: { id: cs.id } });
        await audit(tx, auth, { action: "class.subject", entity: "Class", entityId: cs.classId, summary: `Removed ${cs.subject.name} from ${cs.class.name}` });
      });
    },
  }),
];
