import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { normalizeLocalPhone } from "@whizchool/shared/phone";
import type { Discount, Guardian, StudentAttendance, StudentDetail, StudentDocument } from "@whizchool/shared/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth/context";
import { canSeeStudent, studentWhere } from "../auth/scope";
import { config } from "../config";
import { fromIsoDate, isoDate, schoolToday, toIsoDate } from "../dates";
import { prisma } from "../db";
import { sendEmail } from "../email/mailer";
import { inviteEmail, inviteLinkPath } from "../email/templates";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, omitNulls, page, parseSort } from "../http/list";
import { defineRoute } from "../http/route";
import { currentYearId, schoolName } from "../school";
import { createStudent, nameWithInitials } from "../services/students";
import { toFileRef } from "../storage";
import { balances, fullName, studentListInclude, toStudentListItems } from "../students";

// ── Shared input shapes ──

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const phoneField = z
  .string()
  .trim()
  .min(1, "Required")
  .transform((v, ctx) => {
    const phone = normalizeLocalPhone(v);
    if (!phone) ctx.addIssue({ code: "custom", message: "Enter a Sri Lankan number, e.g. 077 123 4567" });
    return phone ?? v;
  });

export const emailField = z
  .union([z.literal(""), z.email("Enter a valid email")])
  .nullish()
  .transform((v) => v?.trim().toLowerCase() || null);

export const guardianBody = z.object({
  name: text(120).min(1, "Required"),
  relationship: z.enum(["Father", "Mother", "Guardian"], { error: "Required" }),
  phone: phoneField,
  email: emailField,
  nic: optionalText(20),
  occupation: optionalText(80),
  address: optionalText(300),
});

const medical = z
  .object({ bloodGroup: optionalText(10), allergies: optionalText(300), conditions: optionalText(300) })
  .partial()
  .optional();

const studentFields = {
  firstName: text(80).min(1, "Required"),
  lastName: text(80).min(1, "Required"),
  gender: z.enum(["M", "F"], { error: "Required" }),
  dob: isoDate("Enter the date of birth"),
  classId: z.string().min(1, "Choose a class").max(100),
  address: text(300).min(1, "Required"),
  religion: optionalText(40),
  medical,
  electiveSubjectIds: z.array(z.string().max(100)).max(20).optional(),
  discountIds: z.array(z.string().max(100)).max(10).optional(),
};

/**
 * Phones are stored as "077 123 4567". A typed number ("0771234", "771234") is spaced the same
 * way so it matches from the start; a short tail ("4567") matches within the last group.
 */
function phoneSearch(search: string) {
  const compact = search.replace(/[\s+-]/g, "");
  if (compact.length < 4 || !/^\d+$/.test(compact)) return null;
  const local = compact.startsWith("94") && compact.length > 9 ? `0${compact.slice(2)}` : compact.startsWith("7") ? `0${compact}` : compact;
  if (!local.startsWith("0")) return compact;
  return [local.slice(0, 3), local.slice(3, 6), local.slice(6)].filter(Boolean).join(" ");
}

// ── Detail ──

const toGuardian = (g: Prisma.GuardianGetPayload<object>): Guardian => omitNulls({ ...g, relationship: g.relationship });

/** The full profile behind /students/:id; balances only for callers who may see fees. */
export async function studentDetail(auth: AuthContext, id: string): Promise<StudentDetail> {
  const s = await prisma.student.findUnique({
    where: { id },
    include: {
      class: { include: { stream: true, subjects: { include: { subject: true }, orderBy: { subject: { name: "asc" } } } } },
      grade: true,
      guardians: { orderBy: { position: "asc" }, include: { guardian: true } },
      subjects: true,
      discounts: { include: { discount: true } },
      enrollments: { include: { year: true, class: true } },
      photo: true,
      documents: { include: { file: true }, orderBy: { uploadedAt: "desc" } },
    },
  });
  if (!s) throw new ApiError(404, "not_found", "Student not found.");
  if (!canSeeStudent(auth, s)) throw new ApiError(403, "forbidden", "You can only view your own students.");

  const yearId = await currentYearId();
  const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: yearId } });
  const att = await prisma.attendanceRecord.groupBy({
    by: ["status"],
    where: { studentId: s.id, date: { gte: year.startDate, lte: year.endDate } },
    _count: { _all: true },
  });
  const days = att.reduce((n, a) => n + a._count._all, 0);
  const attended = att.filter((a) => a.status === "present" || a.status === "late").reduce((n, a) => n + a._count._all, 0);
  const showFees = auth.session.kind === "parent" || auth.session.permissions.includes("fees.view");
  const electives = new Set(s.subjects.map((x) => x.subjectId));
  // O/L students take the core subjects plus their chosen basket electives; others take all.
  const subjects = s.class.subjects
    .filter((cs) => s.grade.level !== "ol" || cs.subject.basket === null || electives.has(cs.subjectId))
    .map((cs) => ({ id: cs.subjectId, name: cs.subject.name }));

  return {
    ...omitNulls({
      id: s.id,
      admissionNo: s.admissionNo,
      firstName: s.firstName,
      lastName: s.lastName,
      nameWithInitials: s.nameWithInitials,
      gender: s.gender,
      dob: toIsoDate(s.dob),
      classId: s.classId,
      gradeId: s.gradeId,
      status: s.status,
      joinedDate: toIsoDate(s.joinedDate),
      leftDate: s.leftDate ? toIsoDate(s.leftDate) : null,
      leftReason: s.leftReason,
      address: s.address,
      religion: s.religion,
      photoFileId: s.photoFileId,
      streamName: s.class.stream?.name ?? null,
      photoUrl: s.photo ? toFileRef(s.photo).url! : null,
    }),
    medical: omitNulls({ bloodGroup: s.bloodGroup, allergies: s.allergies, conditions: s.conditions }),
    guardianIds: s.guardians.map((g) => g.guardianId),
    electiveSubjectIds: [...electives],
    discountIds: s.discounts.map((d) => d.discountId),
    fullName: fullName(s),
    className: s.class.name,
    gradeName: s.grade.name,
    guardians: s.guardians.map((g) => toGuardian(g.guardian)),
    subjects,
    discounts: s.discounts.map(
      ({ discount: d }): Discount => omitNulls({ id: d.id, name: d.name, kind: d.kind, value: Number(d.value), feeTypeId: d.feeTypeId, description: d.description }),
    ),
    attendanceRate: days ? Math.round((attended / days) * 1000) / 10 : 100,
    balance: showFees ? ((await balances(prisma, [s.id])).get(s.id) ?? 0) : 0,
    history: s.enrollments
      .map((e) => ({ yearName: e.year.name, className: e.class.name }))
      .sort((a, b) => b.yearName.localeCompare(a.yearName)),
    documents: s.documents.map(
      (d): StudentDocument => ({ id: d.id, kind: d.kind, file: toFileRef(d.file), uploadedAt: d.uploadedAt.toISOString(), uploadedBy: d.uploadedBy }),
    ),
  };
}

/** Loads a student the caller may change, or throws 404/403. */
export async function editableStudent(auth: AuthContext, id: string) {
  const s = await prisma.student.findUnique({ where: { id } });
  if (!s) throw new ApiError(404, "not_found", "Student not found.");
  if (!canSeeStudent(auth, s, "students.edit")) throw new ApiError(403, "forbidden", "You can only change students in your classes.");
  return s;
}

async function listItem(auth: AuthContext, id: string) {
  const row = await prisma.student.findUniqueOrThrow({ where: { id }, include: studentListInclude });
  return (await toStudentListItems(prisma, [row], { withBalance: auth.session.permissions.includes("fees.view") }))[0]!;
}

// ── Routes ──

export const studentRoutes = [
  defineRoute({
    method: "GET",
    path: "/students",
    access: { permission: "students.view" },
    summary: "Students the caller may see, filtered, searched and paginated",
    query: listQuery.extend({
      classId: z.string().max(100).optional(),
      gradeId: z.string().max(100).optional(),
      status: z.enum(["active", "left", "graduated", "expelled", "all"]).default("active"),
    }),
    handler: async ({ auth, query }) => {
      const tokens = query.search?.split(/\s+/).filter(Boolean) ?? [];
      const phone = phoneSearch(query.search ?? "");
      const where: Prisma.StudentWhereInput = {
        AND: [
          studentWhere(auth),
          query.status === "all" ? {} : { status: query.status },
          query.classId ? { classId: query.classId } : {},
          query.gradeId ? { gradeId: query.gradeId } : {},
          // Every word must match a name or the admission no.; a run of digits may also match a guardian's phone.
          ...tokens.map(
            (t): Prisma.StudentWhereInput => ({
              OR: [
                { firstName: { contains: t, mode: "insensitive" } },
                { lastName: { contains: t, mode: "insensitive" } },
                { admissionNo: { contains: t } },
                ...(phone ? [{ guardians: { some: { guardian: { phone: { contains: phone } } } } }] : []),
              ],
            }),
          ),
        ],
      };
      const withBalance = auth.session.permissions.includes("fees.view");
      // Up to ~1,500 rows: sort in memory on light fields, then load full rows for one page.
      const all = await prisma.student.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } }, grade: { select: { number: true } } },
      });
      const { field, dir } = parseSort(query.sort, ["name", "admissionNo", "class", "balance"] as const, "class");
      const owed = field === "balance" && withBalance ? await balances(prisma, all.map((s) => s.id)) : null;
      const byName = (a: (typeof all)[number], b: (typeof all)[number]) => fullName(a).localeCompare(fullName(b));
      const compare: Record<typeof field, (a: (typeof all)[number], b: (typeof all)[number]) => number> = {
        name: byName,
        admissionNo: (a, b) => a.admissionNo.localeCompare(b.admissionNo, undefined, { numeric: true }),
        class: (a, b) => a.grade.number - b.grade.number || a.class.name.localeCompare(b.class.name) || byName(a, b),
        balance: (a, b) => (owed ? (owed.get(a.id) ?? 0) - (owed.get(b.id) ?? 0) : 0) || byName(a, b),
      };
      const sorted = all.sort((a, b) => (dir === "desc" ? -1 : 1) * compare[field](a, b));
      const pageIds = sorted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((s) => s.id);
      const rows = await prisma.student.findMany({ where: { id: { in: pageIds } }, include: studentListInclude });
      const order = new Map(pageIds.map((id, i) => [id, i]));
      rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return page(await toStudentListItems(prisma, rows, { withBalance }), all.length, query);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/students/:id",
    access: "session",
    summary: "A student's profile: guardians, subjects, history, documents (parents: own children)",
    handler: ({ auth, params }) => studentDetail(auth, params.id),
  }),
  defineRoute({
    method: "GET",
    path: "/students/:id/attendance",
    access: "session",
    summary: "A student's attendance this academic year, newest day first",
    handler: async ({ auth, params }): Promise<StudentAttendance> => {
      const s = await prisma.student.findUnique({ where: { id: params.id }, select: { id: true, classId: true } });
      if (!s) throw new ApiError(404, "not_found", "Student not found.");
      if (!canSeeStudent(auth, s, auth.session.kind === "parent" ? "students.view" : "attendance.view")) {
        throw new ApiError(403, "forbidden", "You can only view your own students.");
      }
      const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: await currentYearId() } });
      const records = await prisma.attendanceRecord.findMany({
        where: { studentId: s.id, date: { gte: year.startDate, lte: fromIsoDate(schoolToday()) } },
        select: { date: true, status: true },
        orderBy: { date: "desc" },
      });
      const count = (status: string) => records.filter((r) => r.status === status).length;
      const [present, absent, late, excused] = ["present", "absent", "late", "excused"].map(count);
      return {
        rate: records.length ? Math.round(((present! + late!) / records.length) * 1000) / 10 : 100,
        present: present!,
        absent: absent!,
        late: late!,
        excused: excused!,
        days: records.map((r) => ({ date: toIsoDate(r.date), status: r.status })),
      };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/students",
    access: { permission: "students.create" },
    summary: "Admit a student directly: guardian (new or matched), enrolment and first invoice",
    idempotent: true,
    body: z.object({ ...studentFields, guardian: guardianBody, inviteParent: z.boolean().optional() }),
    handler: async ({ auth, body }) => {
      const today = schoolToday();
      if (body.dob > today) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { dob: "Can't be in the future" });
      const created = await prisma.$transaction((tx) => createStudent(tx, auth, body, { firstInvoice: true, today }), { timeout: 20_000 });
      let inviteLink: string | undefined;
      if (created.invite) {
        await sendEmail(inviteEmail({ ...created.invite.user, kind: "parent" }, await schoolName(), created.invite.token));
        if (config.EXPOSE_DEV_LINKS) inviteLink = inviteLinkPath(created.invite.token);
      }
      return { ...(await listItem(auth, created.student.id)), ...(inviteLink ? { inviteLink } : {}) };
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/students/:id",
    access: { permission: "students.edit" },
    summary: "Update a student's details, class (this year), electives and discounts",
    body: z.object(studentFields),
    handler: async ({ auth, params, body }) => {
      const before = await editableStudent(auth, params.id);
      const cls = await prisma.classSection.findUnique({ where: { id: body.classId }, select: { id: true, yearId: true, gradeId: true, name: true } });
      const yearId = await currentYearId();
      if (!cls || cls.yearId !== yearId) throw new ApiError(422, "validation", "Choose a class from this year.", { classId: "Choose a class" });
      const offered = new Set((await prisma.classSubject.findMany({ where: { classId: cls.id }, select: { subjectId: true } })).map((s) => s.subjectId));
      const electives = body.electiveSubjectIds ? [...new Set(body.electiveSubjectIds)].filter((id) => offered.has(id)) : undefined;
      const discounts = body.discountIds ? [...new Set(body.discountIds)] : undefined;
      if (discounts?.length && (await prisma.discount.count({ where: { id: { in: discounts } } })) !== discounts.length) {
        throw new ApiError(422, "validation", "Choose discounts from the list.", { discountIds: "Unknown discount" });
      }
      const moved = cls.id !== before.classId;
      await prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: before.id },
          data: {
            firstName: body.firstName,
            lastName: body.lastName,
            nameWithInitials:
              before.firstName === body.firstName && before.lastName === body.lastName ? before.nameWithInitials : nameWithInitials(body.firstName, body.lastName),
            gender: body.gender,
            dob: fromIsoDate(body.dob),
            address: body.address,
            religion: body.religion,
            bloodGroup: body.medical?.bloodGroup ?? null,
            allergies: body.medical?.allergies ?? null,
            conditions: body.medical?.conditions ?? null,
            classId: cls.id,
            gradeId: cls.gradeId,
          },
        });
        if (moved) {
          await tx.enrollment.upsert({
            where: { studentId_yearId: { studentId: before.id, yearId } },
            create: { studentId: before.id, yearId, classId: cls.id },
            update: { classId: cls.id },
          });
        }
        if (electives) {
          await tx.studentSubject.deleteMany({ where: { studentId: before.id } });
          await tx.studentSubject.createMany({ data: electives.map((subjectId) => ({ studentId: before.id, subjectId })) });
        }
        if (discounts) {
          await tx.studentDiscount.deleteMany({ where: { studentId: before.id } });
          await tx.studentDiscount.createMany({ data: discounts.map((discountId) => ({ studentId: before.id, discountId })) });
        }
        await audit(tx, auth, {
          action: "student.update",
          entity: "Student",
          entityId: before.id,
          summary: `Updated ${body.firstName} ${body.lastName}${moved ? ` (moved to ${cls.name})` : ""}`,
        });
      });
      return listItem(auth, before.id);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/students/:id/status",
    access: { permission: "students.edit" },
    summary: "Mark a student as left, graduated or expelled (with date and reason), or active again",
    body: z.object({
      status: z.enum(["active", "left", "graduated", "expelled"], { error: "Choose a status" }),
      date: isoDate().optional(),
      reason: optionalText(300),
    }),
    handler: async ({ auth, params, body }) => {
      const s = await editableStudent(auth, params.id);
      if (body.status !== "active" && !body.date) throw new ApiError(422, "validation", "Leaving date is required.", { date: "Required" });
      if (body.date && body.date > schoolToday()) throw new ApiError(422, "validation", "Leaving date can't be in the future.", { date: "Can't be in the future" });
      if (body.status === s.status) throw new ApiError(409, "invalid_transition", `The student is already ${s.status}.`);
      await prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: s.id },
          data:
            body.status === "active"
              ? { status: "active", leftDate: null, leftReason: null }
              : { status: body.status, leftDate: fromIsoDate(body.date!), leftReason: body.reason },
        });
        await audit(tx, auth, {
          action: "student.status",
          entity: "Student",
          entityId: s.id,
          summary: `Marked ${s.firstName} ${s.lastName} as ${body.status}${body.reason ? ` (${body.reason})` : ""}`,
          before: { status: s.status },
          after: { status: body.status },
        });
      });
      return listItem(auth, s.id);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/guardians/:id",
    access: { permission: "students.edit" },
    summary: "Update a guardian's contact details (their sign-in email follows a changed email)",
    body: guardianBody,
    handler: async ({ auth, params, body }) => {
      const g = await prisma.guardian.findUnique({ where: { id: params.id }, include: { students: { include: { student: true } } } });
      if (!g) throw new ApiError(404, "not_found", "Guardian not found.");
      if (!g.students.some((link) => canSeeStudent(auth, link.student, "students.edit"))) {
        throw new ApiError(403, "forbidden", "You can only change guardians of students in your classes.");
      }
      if (g.userId && body.email && body.email !== g.email?.toLowerCase()) {
        const clash = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
        if (clash && clash.id !== g.userId) throw new ApiError(409, "duplicate", "Another account already uses this email.", { email: "Already used by another account" });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.guardian.update({ where: { id: g.id }, data: body });
        if (g.userId && body.email) await tx.user.update({ where: { id: g.userId }, data: { email: body.email, name: body.name, phone: body.phone } });
        await audit(tx, auth, {
          action: "guardian.update",
          entity: "Guardian",
          entityId: g.id,
          summary: `Updated guardian ${updated.name}`,
          before: { name: g.name, phone: g.phone, email: g.email },
          after: { name: updated.name, phone: updated.phone, email: updated.email },
        });
        return updated;
      });
      return toGuardian(updated);
    },
  }),
];
