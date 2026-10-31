import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { checkLeftOn, checkStaffInput, titledName, type StaffInput } from "@whizchool/shared/staff";
import type { Paginated, Staff, StaffDetail } from "@whizchool/shared/types";
import { audit } from "../audit";
import { nextNumber } from "../counters";
import { fromIsoDate, isoDate, schoolToday, toIsoDate } from "../dates";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, omitNulls, page, parseSort, skipTake } from "../http/list";
import { defineRoute } from "../http/route";
import { ADMIN_ROLE_ID, countActiveAdmins } from "../roles";
import { checkInvite, createInvitedUser, deliverInvite, roleIds } from "./users";

type Tx = Prisma.TransactionClient;

const notFound = () => new ApiError(404, "not_found", "Staff member not found.");
const INVALID = "Please fix the highlighted fields.";

/** What any colleague can see. Everything else on the record is private to staff.view. */
export const staffSelect = {
  id: true,
  empNo: true,
  title: true,
  name: true,
  email: true,
  phone: true,
  designation: true,
  staffType: true,
  status: true,
  userId: true,
  joinedOn: true,
  leftOn: true,
} satisfies Prisma.StaffSelect;

type StaffRow = Prisma.StaffGetPayload<{ select: typeof staffSelect }>;

export const toStaff = (s: StaffRow): Staff => omitNulls({ ...s, joinedOn: s.joinedOn && toIsoDate(s.joinedOn), leftOn: s.leftOn && toIsoDate(s.leftOn) });

const openYear = { year: { status: { not: "closed" } } } satisfies Prisma.ClassSectionWhereInput;

/** Classes they lead and subjects they teach in this year and any year being prepared. */
async function teachingOf(db: Tx | typeof prisma, staffId: string): Promise<StaffDetail["teaching"]> {
  const [leading, subjects] = await Promise.all([
    db.classSection.findMany({ where: { classTeacherId: staffId, ...openYear }, select: { id: true, name: true } }),
    db.classSubject.findMany({ where: { teacherId: staffId, class: openYear }, select: { classId: true, class: { select: { name: true } }, subject: { select: { name: true } } } }),
  ]);
  const rows: StaffDetail["teaching"] = [
    ...leading.map((c) => ({ classId: c.id, className: c.name })),
    ...subjects.map((cs) => ({ classId: cs.classId, className: cs.class.name, subjectName: cs.subject.name })),
  ];
  return rows.sort((a, b) => a.className.localeCompare(b.className, "en", { numeric: true }) || (a.subjectName ?? "").localeCompare(b.subjectName ?? ""));
}

async function loadDetail(id: string): Promise<StaffDetail> {
  const row = await prisma.staff.findUnique({ where: { id }, include: { user: { select: { status: true } }, subjects: { select: { subject: { select: { name: true } } } } } });
  if (!row) throw notFound();
  const { user, subjects, dob, joinedOn, leftOn, ...rest } = row;
  return {
    ...omitNulls({ ...rest, dob: dob && toIsoDate(dob), joinedOn: joinedOn && toIsoDate(joinedOn), leftOn: leftOn && toIsoDate(leftOn), loginStatus: user?.status ?? null }),
    teaching: await teachingOf(prisma, id),
    subjects: subjects.map((s) => s.subject.name).sort(),
  };
}

const toColumns = (v: StaffInput) => ({
  title: v.title,
  name: titledName(v.title, v.name),
  staffType: v.staffType,
  designation: v.designation,
  phone: v.phone,
  email: v.email ?? null,
  gender: v.gender ?? null,
  dob: v.dob ? fromIsoDate(v.dob) : null,
  nic: v.nic ?? null,
  address: v.address ?? null,
  joinedOn: fromIsoDate(v.joinedOn),
  qualifications: v.qualifications ?? null,
  emergencyName: v.emergencyName ?? null,
  emergencyPhone: v.emergencyPhone ?? null,
  notes: v.notes ?? null,
});

async function nextEmpNo(tx: Tx) {
  return `EMP${String(await nextNumber(tx, "empNo", (await tx.staff.count()) + 1)).padStart(3, "0")}`;
}

export const staffRoutes = [
  defineRoute({
    method: "GET",
    path: "/staff/directory",
    access: { permission: "staff.view" },
    summary: "Every staff member, with search and filters",
    query: listQuery.extend({ type: z.enum(["academic", "non_academic"]).optional(), status: z.enum(["active", "inactive", "all"]).optional() }),
    handler: async ({ query }): Promise<Paginated<Staff>> => {
      const status = query.status ?? "active";
      const where: Prisma.StaffWhereInput = {
        ...(status !== "all" ? { status } : {}),
        ...(query.type ? { staffType: query.type } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { empNo: { contains: query.search, mode: "insensitive" } },
                { designation: { contains: query.search, mode: "insensitive" } },
                { phone: { contains: query.search } },
              ],
            }
          : {}),
      };
      const { field, dir } = parseSort(query.sort ?? "name", ["name", "empNo", "designation"] as const, "name");
      const [rows, total] = await Promise.all([
        prisma.staff.findMany({ where, select: staffSelect, orderBy: [{ [field]: dir }, { id: "asc" }], ...skipTake(query) }),
        prisma.staff.count({ where }),
      ]);
      return page(rows.map(toStaff), total, query);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/staff/:id",
    access: { permission: "staff.view" },
    summary: "A staff member's full record and what they teach",
    handler: ({ params }) => loadDetail(params.id),
  }),
  defineRoute({
    method: "POST",
    path: "/staff",
    access: { permission: "staff.create" },
    summary: "Add a staff member, optionally with a login",
    body: z.looseObject({ login: z.object({ roleIds }).optional() }),
    handler: async ({ auth, body }) => {
      const { value, errors } = checkStaffInput(body, schoolToday());
      if (body.login && !auth.session.permissions.includes("users.create")) throw new ApiError(403, "forbidden", "You don't have permission to create logins.");
      if (body.login && !value.email) errors.email = "Needed for a login";
      if (Object.keys(errors).length) throw new ApiError(422, "validation", INVALID, errors);
      const roles = body.login ? await checkInvite(value.email!, body.login.roleIds) : [];
      const { id, user, token } = await prisma.$transaction(async (tx) => {
        const name = titledName(value.title, value.name);
        const invited = body.login ? await createInvitedUser(tx, { name, email: value.email!, phone: value.phone, kind: "staff", roles }) : null;
        const staff = await tx.staff.create({ data: { ...toColumns(value), empNo: await nextEmpNo(tx), userId: invited?.user.id ?? null } });
        await audit(tx, auth, { action: "staff.create", entity: "Staff", entityId: staff.id, summary: `Added ${staff.name} (${staff.empNo}) as ${staff.designation}` });
        return { id: staff.id, user: invited?.user, token: invited?.token };
      });
      return { id, inviteLink: user && token ? await deliverInvite(user, token) : undefined };
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/staff/:id",
    access: { permission: "staff.edit" },
    summary: "Update a staff member's record",
    body: z.looseObject({}),
    handler: async ({ auth, params, body }) => {
      const staff = await prisma.staff.findUnique({ where: { id: params.id }, select: { id: true, name: true, email: true, userId: true } });
      if (!staff) throw notFound();
      const { value, errors } = checkStaffInput(body, schoolToday());
      if (staff.userId && value.email !== staff.email?.toLowerCase()) errors.email = "This is their login email, so it can't be changed here";
      if (Object.keys(errors).length) throw new ApiError(422, "validation", INVALID, errors);
      await prisma.$transaction(async (tx) => {
        const columns = toColumns(value);
        // Keeps the login's own email spelling, which only differs from the form's by case.
        await tx.staff.update({ where: { id: staff.id }, data: staff.userId ? { ...columns, email: staff.email } : columns });
        if (staff.userId) await tx.user.update({ where: { id: staff.userId }, data: { name: columns.name, phone: value.phone } });
        await audit(tx, auth, { action: "staff.update", entity: "Staff", entityId: staff.id, summary: `Updated the record of ${columns.name}` });
      });
      return loadDetail(staff.id);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/staff/:id/leave",
    access: { permission: "staff.edit" },
    summary: "Mark as left: keeps the record, stops the login, and takes them off subject teacher lists",
    body: z.object({ leftOn: isoDate("Enter the leaving date"), reason: z.string().trim().max(300).optional() }),
    handler: async ({ auth, params, body }) => {
      const staff = await prisma.staff.findUnique({ where: { id: params.id }, include: { user: { include: { roles: true } } } });
      if (!staff) throw notFound();
      if (staff.status === "inactive") throw new ApiError(409, "invalid_transition", `${staff.name} has already left.`);
      if (staff.userId === auth.session.id) throw new ApiError(409, "self_lockout", "You can't mark yourself as left.");
      const dateError = checkLeftOn(body.leftOn, schoolToday(), staff.joinedOn ? toIsoDate(staff.joinedOn) : undefined);
      if (dateError) throw new ApiError(422, "validation", INVALID, { leftOn: dateError });
      const user = staff.user;
      if (user?.status === "active" && user.roles.some((r) => r.roleId === ADMIN_ROLE_ID) && (await countActiveAdmins(prisma, user.id)) === 0) {
        throw new ApiError(409, "last_admin", "At least one active admin is required.");
      }
      await prisma.$transaction(async (tx) => {
        const teaching = await teachingOf(tx, staff.id);
        if (teaching.length) {
          const classes = [...new Set(teaching.map((t) => t.className))].join(", ");
          throw new ApiError(409, "still_teaching", `${staff.name} still has classes: ${classes}. Assign new teachers first.`);
        }
        await tx.staff.update({ where: { id: staff.id }, data: { status: "inactive", leftOn: fromIsoDate(body.leftOn), leaveReason: body.reason || null } });
        await tx.subjectTeacher.deleteMany({ where: { staffId: staff.id } });
        if (user) {
          await tx.user.update({ where: { id: user.id }, data: { status: "deactivated" } });
          await tx.session.deleteMany({ where: { userId: user.id } });
        }
        await audit(tx, auth, { action: "staff.leave", entity: "Staff", entityId: staff.id, summary: `Marked ${staff.name} as left on ${body.leftOn}` });
      });
      return loadDetail(staff.id);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/staff/:id/return",
    access: { permission: "staff.edit" },
    summary: "Mark a former staff member as back; their login stays off until reactivated in Users",
    handler: async ({ auth, params }) => {
      const staff = await prisma.staff.findUnique({ where: { id: params.id }, select: { id: true, name: true, status: true } });
      if (!staff) throw notFound();
      if (staff.status === "active") throw new ApiError(409, "invalid_transition", `${staff.name} hasn't left.`);
      await prisma.$transaction(async (tx) => {
        await tx.staff.update({ where: { id: staff.id }, data: { status: "active", leftOn: null, leaveReason: null } });
        await audit(tx, auth, { action: "staff.return", entity: "Staff", entityId: staff.id, summary: `Marked ${staff.name} as back at the school` });
      });
      return loadDetail(staff.id);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/staff/:id/invite",
    access: { permission: "users.create" },
    summary: "Give a staff member who has no login one, and email the invitation",
    body: z.object({ roleIds }),
    handler: async ({ auth, params, body }) => {
      const staff = await prisma.staff.findUnique({ where: { id: params.id }, select: { id: true, name: true, email: true, phone: true, status: true, userId: true } });
      if (!staff) throw notFound();
      if (staff.status === "inactive") throw new ApiError(409, "invalid_transition", `${staff.name} has left the school.`);
      if (staff.userId) throw new ApiError(409, "duplicate", `${staff.name} already has a login.`);
      if (!staff.email) throw new ApiError(422, "validation", "Add an email address to their record first.", { email: "Needed for a login" });
      const roles = await checkInvite(staff.email, body.roleIds);
      const { user, token } = await prisma.$transaction(async (tx) => {
        const invited = await createInvitedUser(tx, { name: staff.name, email: staff.email!, phone: staff.phone, kind: "staff", roles });
        await tx.staff.update({ where: { id: staff.id }, data: { userId: invited.user.id } });
        await audit(tx, auth, { action: "user.invite", entity: "User", entityId: invited.user.id, summary: `Invited ${staff.name} (${staff.email})` });
        return invited;
      });
      return { id: staff.id, inviteLink: await deliverInvite(user, token) };
    },
  }),
];
