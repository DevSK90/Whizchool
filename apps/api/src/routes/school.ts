import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { validateTerms } from "@whizchool/shared/calendar";
import { validateBands } from "@whizchool/shared/grading";
import type { AcademicYear, GradeBand, School, Staff, Stream, Subject, Term } from "@whizchool/shared/types";
import { audit } from "../audit";
import { fromIsoDate, isoDate, toIsoDate } from "../dates";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { omitNulls } from "../http/list";
import { defineRoute } from "../http/route";
import { currentYearId } from "../school";

// ── Mapping ──

type SchoolRow = Prisma.SchoolGetPayload<object>;

export function toSchool(s: SchoolRow): School {
  return omitNulls({
    name: s.name,
    shortName: s.shortName,
    motto: s.motto,
    address: s.address,
    phone: s.phone,
    email: s.email,
    website: s.website,
    principalName: s.principalName,
    currency: "LKR" as const,
    timezone: s.timezone,
    currentYearId: s.currentYearId ?? "",
    smsSenderId: s.smsSenderId,
    timetableStart: s.timetableStart,
    timetableEnd: s.timetableEnd,
  });
}

const toTerm = (t: Prisma.TermGetPayload<object>): Term => ({
  id: t.id,
  yearId: t.yearId,
  number: t.number as Term["number"],
  name: t.name,
  startDate: toIsoDate(t.startDate),
  endDate: toIsoDate(t.endDate),
});

const subjectInclude = { streams: { select: { streamId: true } } } satisfies Prisma.SubjectInclude;

function toSubject(s: Prisma.SubjectGetPayload<{ include: typeof subjectInclude }>): Subject {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    levels: s.levels,
    ...(s.basket ? { basket: s.basket as Subject["basket"] } : {}),
    ...(s.streams.length ? { streamIds: s.streams.map((x) => x.streamId) } : {}),
  };
}

const toBand = (b: Prisma.GradeBandGetPayload<object>): GradeBand => ({ grade: b.grade, min: b.min, max: b.max, label: b.label, pass: b.pass });

// ── Validation ──

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

const schoolBody = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  shortName: z.string().trim().min(1, "Required").max(20),
  motto: optionalText(200),
  address: optionalText(300),
  phone: optionalText(40),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().default(""),
  website: optionalText(200),
  principalName: optionalText(120),
  // The sender name shown on SMS; Notify.lk allows 3–11 letters or digits.
  smsSenderId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{3,11}$/, "3–11 letters or digits, no spaces."),
  timetableStart: z.number().int().min(0).max(1440).multipleOf(5).optional(),
  timetableEnd: z.number().int().min(0).max(1440).multipleOf(5, "Use 5-minute steps").optional(),
});

const termDates = z.object({ startDate: isoDate(), endDate: isoDate() });

async function saveTerms(auth: Parameters<typeof audit>[1], changes: { id: string; startDate: string; endDate: string }[]) {
  const ids = [...new Set(changes.map((c) => c.id))];
  const found = await prisma.term.findMany({ where: { id: { in: ids } }, select: { yearId: true } });
  if (found.length !== ids.length) throw new ApiError(404, "not_found", "Term not found.");
  const yearIds = [...new Set(found.map((t) => t.yearId))];
  if (yearIds.length !== 1) throw new ApiError(422, "validation", "Save one academic year's terms at a time.");
  const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: yearIds[0] }, include: { terms: true } });
  const byId = new Map(changes.map((c) => [c.id, c]));
  const merged = year.terms.map((t) => ({ ...toTerm(t), ...byId.get(t.id) }));
  const problem = validateTerms({ name: year.name, startDate: toIsoDate(year.startDate), endDate: toIsoDate(year.endDate) }, merged);
  if (problem) {
    const term = merged.find((t) => t.id === problem.termId)!;
    throw new ApiError(422, "validation", `${term.name}: ${problem.message}`, { [`${term.id}.${problem.field}`]: problem.message });
  }
  return prisma.$transaction(async (tx) => {
    for (const c of changes) {
      await tx.term.update({ where: { id: c.id }, data: { startDate: fromIsoDate(c.startDate), endDate: fromIsoDate(c.endDate) } });
    }
    const names = merged.filter((t) => byId.has(t.id)).map((t) => t.name);
    await audit(tx, auth, { action: "term.update", entity: "Term", summary: `Updated ${names.join(", ")} dates for ${year.name}` });
    const terms = await tx.term.findMany({ where: { yearId: year.id }, orderBy: { number: "asc" } });
    return terms.map(toTerm);
  });
}

const LEVELS = ["primary", "junior", "ol", "al"] as const;

const subjectBody = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  levels: z.array(z.enum(LEVELS)).min(1, "Choose at least one level").transform((l) => [...new Set(l)]),
  // O/L elective basket 1–3; empty means a core subject.
  basket: z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(1, "Choose basket 1, 2 or 3").max(3, "Choose basket 1, 2 or 3")])
    .optional()
    .transform((b) => (typeof b === "number" ? b : null)),
});

const bandsBody = z.object({
  bands: z
    .array(
      z.object({
        grade: z.string().trim().min(1, "Required").max(3).transform((g) => g.toUpperCase()),
        min: z.number().int().min(0).max(100),
        max: z.number().int().min(0).max(100),
        label: z.string().trim().max(40).default(""),
        pass: z.boolean(),
      }),
    )
    .min(2, "Use at least two bands.")
    .max(12),
});

// ── Routes ──

export const schoolRoutes = [
  defineRoute({
    method: "GET",
    path: "/settings/school",
    access: "session",
    summary: "School profile (name, contacts, current year); used across the app",
    handler: async () => toSchool(await prisma.school.findUniqueOrThrow({ where: { id: "school" } })),
  }),
  defineRoute({
    method: "PUT",
    path: "/settings/school",
    access: { permission: "settings.edit" },
    summary: "Update the school profile (currency, timezone and current year are not editable here)",
    body: schoolBody,
    handler: async ({ auth, body }) => {
      const before = await prisma.school.findUniqueOrThrow({ where: { id: "school" } });
      const dayStart = body.timetableStart ?? before.timetableStart;
      const dayEnd = body.timetableEnd ?? before.timetableEnd;
      if (dayEnd <= dayStart) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { timetableEnd: "The school day must end after it starts" });
      const outside = await prisma.timetableBlock.count({
        where: { class: { yearId: before.currentYearId ?? undefined }, OR: [{ start: { lt: dayStart } }, { end: { gt: dayEnd } }] },
      });
      if (outside) throw new ApiError(409, "timetable_hours", "Some timetables have blocks outside those hours. Move them first.", { timetableEnd: "Timetables use times outside these hours" });
      const data = { ...body, website: body.website || null, smsSenderId: body.smsSenderId.toUpperCase() };
      const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.school.update({ where: { id: "school" }, data });
        const changed = Object.keys(data).filter((k) => (before as Record<string, unknown>)[k] !== (updated as Record<string, unknown>)[k]);
        await audit(tx, auth, {
          action: "settings.update",
          entity: "School",
          summary: changed.length ? `Updated school profile (${changed.join(", ")})` : "Saved school profile (no changes)",
          before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k] as string])),
          after: Object.fromEntries(changed.map((k) => [k, (updated as Record<string, unknown>)[k] as string])),
        });
        return updated;
      });
      return toSchool(updated);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/academic-years",
    access: "session",
    summary: "Academic years, newest first",
    handler: async (): Promise<AcademicYear[]> =>
      (await prisma.academicYear.findMany({ orderBy: { startDate: "desc" } })).map((y) => ({
        id: y.id,
        name: y.name,
        startDate: toIsoDate(y.startDate),
        endDate: toIsoDate(y.endDate),
        status: y.status,
      })),
  }),
  defineRoute({
    method: "GET",
    path: "/terms",
    access: "session",
    summary: "Terms of an academic year (default: the current year)",
    query: z.object({ yearId: z.string().max(100).optional() }),
    handler: async ({ query }) => {
      const yearId = query.yearId || (await currentYearId());
      return (await prisma.term.findMany({ where: { yearId }, orderBy: { number: "asc" } })).map(toTerm);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/terms",
    access: { permission: "settings.edit" },
    summary: "Set the dates of several terms of one year at once (validated together)",
    body: z.object({ terms: z.array(termDates.extend({ id: z.string().max(100) })).min(1).max(6) }),
    handler: ({ auth, body }) => saveTerms(auth, body.terms),
  }),
  defineRoute({
    method: "PUT",
    path: "/terms/:id",
    access: { permission: "settings.edit" },
    summary: "Set one term's dates",
    body: termDates,
    handler: async ({ auth, params, body }) => {
      const terms = await saveTerms(auth, [{ id: params.id, ...body }]);
      return terms.find((t) => t.id === params.id);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/streams",
    access: "session",
    summary: "A/L streams",
    handler: async (): Promise<Stream[]> => prisma.stream.findMany({ orderBy: { name: "asc" } }),
  }),
  defineRoute({
    method: "GET",
    path: "/subjects",
    access: "session",
    summary: "Subject catalogue",
    handler: async () =>
      (await prisma.subject.findMany({ include: subjectInclude, orderBy: [{ basket: { sort: "asc", nulls: "first" } }, { name: "asc" }] })).map(toSubject),
  }),
  defineRoute({
    method: "POST",
    path: "/subjects",
    access: { permission: "settings.edit" },
    summary: "Add a subject",
    body: subjectBody.extend({
      code: z
        .string()
        .trim()
        .transform((c) => c.toUpperCase())
        .pipe(z.string().regex(/^[A-Z]{2,6}$/, "2–6 letters.")),
    }),
    handler: async ({ auth, body }) => {
      if (await prisma.subject.findUnique({ where: { code: body.code }, select: { id: true } })) {
        throw new ApiError(409, "duplicate", "Code already in use.", { code: "Already in use" });
      }
      const subject = await prisma.$transaction(async (tx) => {
        const s = await tx.subject.create({ data: { name: body.name, code: body.code, levels: body.levels, basket: body.basket }, include: subjectInclude });
        await audit(tx, auth, { action: "subject.create", entity: "Subject", entityId: s.id, summary: `Added subject ${s.name} (${s.code})` });
        return s;
      });
      return toSubject(subject);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/subjects/:id",
    access: { permission: "settings.edit" },
    summary: "Rename a subject or change its levels and basket (the code is permanent)",
    body: subjectBody,
    handler: async ({ auth, params, body }) => {
      const before = await prisma.subject.findUnique({ where: { id: params.id } });
      if (!before) throw new ApiError(404, "not_found", "Subject not found.");
      const subject = await prisma.$transaction(async (tx) => {
        const s = await tx.subject.update({ where: { id: before.id }, data: { name: body.name, levels: body.levels, basket: body.basket }, include: subjectInclude });
        await audit(tx, auth, {
          action: "subject.update",
          entity: "Subject",
          entityId: s.id,
          summary: `Updated subject ${s.name}`,
          before: { name: before.name, levels: before.levels, basket: before.basket },
          after: { name: s.name, levels: s.levels, basket: s.basket },
        });
        return s;
      });
      return toSubject(subject);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/grade-bands",
    access: "session",
    summary: "The grading scale, highest band first",
    handler: async () => (await prisma.gradeBand.findMany({ orderBy: { min: "desc" } })).map(toBand),
  }),
  defineRoute({
    method: "PUT",
    path: "/grade-bands",
    access: { permission: "settings.edit" },
    summary: "Replace the grading scale (bands must cover 0–100 without gaps)",
    body: bandsBody,
    handler: async ({ auth, body }) => {
      const letters = body.bands.map((b) => b.grade);
      const dup = letters.find((g, i) => letters.indexOf(g) !== i);
      if (dup) throw new ApiError(422, "validation", `Grade ${dup} is used twice.`);
      for (const b of body.bands) if (b.min > b.max) throw new ApiError(422, "validation", `Band ${b.grade} has min greater than max.`);
      const problem = validateBands(body.bands);
      if (problem) throw new ApiError(422, "validation", problem);
      const before = await prisma.gradeBand.findMany({ orderBy: { min: "desc" } });
      const bands = [...body.bands].sort((a, b) => b.min - a.min);
      await prisma.$transaction(async (tx) => {
        await tx.gradeBand.deleteMany();
        await tx.gradeBand.createMany({ data: bands });
        await audit(tx, auth, {
          action: "settings.gradeBands",
          entity: "Grade bands",
          summary: `Updated grading scale: ${bands.map((b) => `${b.grade} ${b.min}–${b.max}`).join(", ")}`,
          before: before.map(toBand) as unknown as Prisma.InputJsonValue,
          after: bands as unknown as Prisma.InputJsonValue,
        });
      });
      return bands;
    },
  }),
  defineRoute({
    method: "GET",
    path: "/staff",
    access: "session",
    summary: "Active staff, for class teacher and subject teacher pickers",
    handler: async ({ session }): Promise<Staff[]> => {
      if (session.kind !== "staff") throw new ApiError(403, "forbidden", "Staff only.");
      const staff = await prisma.staff.findMany({ where: { status: "active" }, orderBy: { name: "asc" } });
      return staff.map((s) => omitNulls(s));
    },
  }),
];

