import { checkLeftOn, checkStaffInput, titledName, type StaffInput } from "@whizchool/shared/staff";
import type { Staff, StaffDetail, StaffRecord } from "@whizchool/shared/types";
import { nextId } from "../db";
import { audit, fail, matches, paginate, requirePerm, todayISO, type Ctx } from "../helpers";
import type { Route } from "../router";
import { requireStaff } from "./school";
import { inviteUser } from "./students";

const INVALID = "Please fix the highlighted fields.";

/** What any colleague can see. Everything else on the record is private to staff.view. */
const toStaff = (s: StaffRecord): Staff => ({
  id: s.id, empNo: s.empNo, title: s.title, name: s.name, email: s.email, phone: s.phone, designation: s.designation,
  staffType: s.staffType, status: s.status, userId: s.userId, joinedOn: s.joinedOn, leftOn: s.leftOn,
});

export function activeStaffForPickers(ctx: Ctx) {
  return ctx.db.staff.rows.filter((s) => s.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(toStaff);
}

/** Classes they lead and subjects they teach in this year and any year being prepared. */
function teachingOf(ctx: Ctx, staffId: string): StaffDetail["teaching"] {
  const db = ctx.db;
  const open = (classId: string) => {
    const c = db.classes.get(classId);
    return !!c && db.years.get(c.yearId)?.status !== "closed";
  };
  const rows: StaffDetail["teaching"] = [
    ...db.classes.rows.filter((c) => c.classTeacherId === staffId && open(c.id)).map((c) => ({ classId: c.id, className: c.name })),
    ...db.classSubjects.rows
      .filter((cs) => cs.teacherId === staffId && open(cs.classId))
      .map((cs) => ({ classId: cs.classId, className: db.classes.get(cs.classId)!.name, subjectName: db.subjects.get(cs.subjectId)!.name })),
  ];
  return rows.sort((a, b) => a.className.localeCompare(b.className, "en", { numeric: true }) || (a.subjectName ?? "").localeCompare(b.subjectName ?? ""));
}

function toDetail(ctx: Ctx, s: StaffRecord): StaffDetail {
  return {
    ...s,
    loginStatus: s.userId ? ctx.db.users.get(s.userId)?.status : undefined,
    teaching: teachingOf(ctx, s.id),
    subjects: ctx.db.subjects.rows.filter((x) => x.teacherIds.includes(s.id)).map((x) => x.name).sort(),
  };
}

const find = (ctx: Ctx) => ctx.db.staff.get(ctx.params.id) ?? fail(404, "not_found", "Staff member not found.");

function checked(ctx: Ctx) {
  return checkStaffInput(ctx.body ?? {}, todayISO(ctx));
}

/** The form's fields, with blanks cleared rather than kept from before. */
const toFields = (v: StaffInput) => ({
  title: v.title, name: titledName(v.title, v.name), staffType: v.staffType, designation: v.designation, phone: v.phone, email: v.email,
  gender: v.gender, dob: v.dob, nic: v.nic, address: v.address, joinedOn: v.joinedOn, qualifications: v.qualifications,
  emergencyName: v.emergencyName, emergencyPhone: v.emergencyPhone, notes: v.notes,
});

function checkRoles(ctx: Ctx, roleIds: unknown) {
  if (!Array.isArray(roleIds) || !roleIds.length) fail(422, "validation", INVALID, { roleIds: "Choose at least one role" });
  return roleIds as string[];
}

export const staffRoutes: Route[] = [
  {
    method: "GET",
    path: "/staff",
    handler: (ctx) => {
      requireStaff(ctx);
      return activeStaffForPickers(ctx);
    },
  },
  {
    method: "GET",
    path: "/staff/directory",
    handler: (ctx) => {
      requirePerm(ctx, "staff.view");
      const { search, type, status = "active", sort = "name" } = ctx.query;
      const rows = ctx.db.staff.rows.filter(
        (s) => (status === "all" || s.status === status) && (!type || s.staffType === type) && matches(search, s.name, s.empNo, s.designation, s.phone),
      );
      const desc = sort.startsWith("-");
      const field = (desc ? sort.slice(1) : sort) as "name" | "empNo" | "designation";
      const sorted = [...rows].sort((a, b) => (desc ? -1 : 1) * (a[field] ?? "").localeCompare(b[field] ?? ""));
      return paginate(sorted.map(toStaff), ctx.query);
    },
  },
  {
    method: "GET",
    path: "/staff/:id",
    handler: (ctx) => {
      requirePerm(ctx, "staff.view");
      return toDetail(ctx, find(ctx));
    },
  },
  {
    method: "POST",
    path: "/staff",
    handler: (ctx) => {
      const session = requirePerm(ctx, "staff.create");
      const db = ctx.db;
      const { value, errors } = checked(ctx);
      const login = ctx.body?.login;
      if (login && !session.permissions.includes("users.create")) fail(403, "forbidden", "You don't have permission to create logins.");
      if (login && !value.email) errors.email = "Needed for a login";
      if (Object.keys(errors).length) fail(422, "validation", INVALID, errors);
      const roleIds = login ? checkRoles(ctx, login.roleIds) : [];
      const fields = toFields(value);
      const invited = login ? inviteUser(ctx, { name: fields.name, email: value.email!, phone: value.phone, kind: "staff", roleIds }) : null;
      const staff = db.staff.insert({ ...fields, id: nextId(db, "st"), empNo: `EMP${String(db.staff.size + 1).padStart(3, "0")}`, status: "active", userId: invited?.user.id });
      if (invited) invited.user.staffId = staff.id;
      audit(ctx, "staff.create", "Staff", `Added ${staff.name} (${staff.empNo}) as ${staff.designation}`, staff.id);
      return { id: staff.id, inviteLink: invited?.inviteLink };
    },
  },
  {
    method: "PUT",
    path: "/staff/:id",
    handler: (ctx) => {
      requirePerm(ctx, "staff.edit");
      const staff = find(ctx);
      const { value, errors } = checked(ctx);
      if (staff.userId && value.email !== staff.email?.toLowerCase()) errors.email = "This is their login email, so it can't be changed here";
      if (Object.keys(errors).length) fail(422, "validation", INVALID, errors);
      const email = staff.userId ? staff.email : value.email;
      Object.assign(staff, toFields(value), { email });
      const user = staff.userId ? ctx.db.users.get(staff.userId) : undefined;
      if (user) Object.assign(user, { name: staff.name, phone: value.phone });
      audit(ctx, "staff.update", "Staff", `Updated the record of ${staff.name}`, staff.id);
      return toDetail(ctx, staff);
    },
  },
  {
    method: "POST",
    path: "/staff/:id/leave",
    handler: (ctx) => {
      const session = requirePerm(ctx, "staff.edit");
      const db = ctx.db;
      const staff = find(ctx);
      const { leftOn, reason } = ctx.body ?? {};
      if (staff.status === "inactive") fail(409, "invalid_transition", `${staff.name} has already left.`);
      if (staff.userId === session.id) fail(409, "self_lockout", "You can't mark yourself as left.");
      const dateError = checkLeftOn(leftOn, todayISO(ctx), staff.joinedOn);
      if (dateError) fail(422, "validation", INVALID, { leftOn: dateError });
      const user = staff.userId ? db.users.get(staff.userId) : undefined;
      const otherAdmins = db.users.rows.filter((u) => u.id !== user?.id && u.status === "active" && u.roleIds.includes("role_admin"));
      if (user?.status === "active" && user.roleIds.includes("role_admin") && !otherAdmins.length) fail(409, "last_admin", "At least one active admin is required.");
      const teaching = teachingOf(ctx, staff.id);
      if (teaching.length) fail(409, "still_teaching", `${staff.name} still has classes: ${[...new Set(teaching.map((t) => t.className))].join(", ")}. Assign new teachers first.`);
      Object.assign(staff, { status: "inactive", leftOn, leaveReason: reason?.trim() || undefined });
      for (const subject of db.subjects.rows) subject.teacherIds = subject.teacherIds.filter((id) => id !== staff.id);
      if (user) user.status = "deactivated";
      audit(ctx, "staff.leave", "Staff", `Marked ${staff.name} as left on ${leftOn}`, staff.id);
      return toDetail(ctx, staff);
    },
  },
  {
    method: "POST",
    path: "/staff/:id/return",
    handler: (ctx) => {
      requirePerm(ctx, "staff.edit");
      const staff = find(ctx);
      if (staff.status === "active") fail(409, "invalid_transition", `${staff.name} hasn't left.`);
      Object.assign(staff, { status: "active", leftOn: undefined, leaveReason: undefined });
      audit(ctx, "staff.return", "Staff", `Marked ${staff.name} as back at the school`, staff.id);
      return toDetail(ctx, staff);
    },
  },
  {
    method: "POST",
    path: "/staff/:id/invite",
    handler: (ctx) => {
      requirePerm(ctx, "users.create");
      const staff = find(ctx);
      if (staff.status === "inactive") fail(409, "invalid_transition", `${staff.name} has left the school.`);
      if (staff.userId) fail(409, "duplicate", `${staff.name} already has a login.`);
      if (!staff.email) fail(422, "validation", "Add an email address to their record first.", { email: "Needed for a login" });
      const roleIds = checkRoles(ctx, ctx.body?.roleIds);
      const { user, inviteLink } = inviteUser(ctx, { name: staff.name, email: staff.email!, phone: staff.phone, kind: "staff", roleIds, staffId: staff.id });
      staff.userId = user.id;
      audit(ctx, "user.invite", "User", `Invited ${staff.name} (${staff.email})`, user.id);
      return { id: staff.id, inviteLink };
    },
  },
];
