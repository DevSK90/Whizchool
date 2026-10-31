import type { Route } from "../router";
import type { Guardian, ImportPreview, ImportRow, Role } from "@whizchool/shared/types";
import { ALL_PERMISSIONS, type DataScope, type PermissionKey } from "@whizchool/shared/permissions";
import { sameGuardianName } from "@whizchool/shared/people";
import { staffTypeFor } from "@whizchool/shared/staff";
import { checkImportRow, IMPORT_LIMITS } from "@whizchool/shared/student-import";
import {
  audit,
  currentClasses,
  fail,
  matches,
  paginate,
  requirePerm,
  sortRows,
  todayISO,
  type Ctx,
} from "../helpers";
import { nextId } from "../db";
import { createStudent, findMatchingGuardian, inviteUser, othersWithPhone } from "./students";

const SCOPES: DataScope[] = ["all", "own_class", "own_subjects", "own_children"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function withUserCount(ctx: Ctx, r: Role): Role {
  return { ...r, userCount: ctx.db.users.rows.filter((u) => u.roleIds.includes(r.id) && u.status !== "deactivated").length };
}

function validateRole(ctx: Ctx, body: Partial<Role>, id?: string) {
  if (!body.name?.trim()) fail(422, "validation", "Role name is required.", { name: "Required" });
  if (ctx.db.roles.rows.some((r) => r.id !== id && r.name.toLowerCase() === body.name!.trim().toLowerCase())) {
    fail(409, "duplicate", "A role with this name already exists.", { name: "Already exists" });
  }
  if (!SCOPES.includes(body.scope as DataScope)) fail(422, "validation", "Choose a data scope.", { scope: "Required" });
  const perms = (body.permissions ?? []).filter((p) => ALL_PERMISSIONS.includes(p as PermissionKey));
  return perms as PermissionKey[];
}

function activeAdmins(ctx: Ctx) {
  return ctx.db.users.rows.filter((u) => u.status === "active" && u.roleIds.includes("role_admin"));
}

/** Same review as the real API: the shared row checks, then what needs data (class, numbers, people). */
function reviewImport(ctx: Ctx, rows: ImportRow[]): ImportPreview {
  if (!Array.isArray(rows) || !rows.length) fail(422, "validation", "The file has no data rows.");
  if (rows.length > IMPORT_LIMITS.rows) fail(422, "validation", `Import at most ${IMPORT_LIMITS.rows.toLocaleString("en")} rows at a time.`);
  const today = todayISO(ctx);
  const classes = new Set(currentClasses(ctx.db).map((c) => c.name));
  const checked = rows.map((r, i) => ({ index: i + 1, ...checkImportRow(r, today) }));
  const personKey = (first: string, last: string, dob: string) => `${first.toLowerCase()}|${last.toLowerCase()}|${dob}`;
  const onFile = new Map(ctx.db.students.rows.map((s) => [personKey(s.firstName, s.lastName, s.dob), s.admissionNo]));
  const seenAdmission = new Map<string, number>();
  const seenPerson = new Map<string, number>();
  for (const r of checked) {
    const d = r.data;
    if (d.className && !/^\d{1,2}$/.test(d.className) && !classes.has(d.className)) r.errors.push(`No class “${d.className}” this year`);
    if (d.admissionNo) {
      if (ctx.db.students.rows.some((s) => s.admissionNo === d.admissionNo)) r.errors.push(`Admission no. ${d.admissionNo} already exists`);
      else if (seenAdmission.has(d.admissionNo)) r.errors.push(`Admission no. ${d.admissionNo} is also on row ${seenAdmission.get(d.admissionNo)}`);
      seenAdmission.set(d.admissionNo, seenAdmission.get(d.admissionNo) ?? r.index);
    }
    if (d.firstName && d.lastName && /^\d{4}-\d{2}-\d{2}$/.test(d.dob ?? "")) {
      const key = personKey(d.firstName, d.lastName, d.dob!);
      if (onFile.has(key)) r.warnings.push(`May already be enrolled as ${onFile.get(key)} (same name and date of birth)`);
      else if (seenPerson.has(key)) r.warnings.push(`Same name and date of birth as row ${seenPerson.get(key)}`);
      seenPerson.set(key, seenPerson.get(key) ?? r.index);
    }
    if (!r.errors.length) {
      const guardian = { name: d.guardianName, email: d.guardianEmail, phone: d.guardianPhone };
      const g = findMatchingGuardian(ctx.db, guardian);
      if (g) {
        r.warnings.push(`Guardian matches ${g.name} (${g.phone}), who is already on file; the student will be linked to them`);
        if (d.guardianEmail && !sameGuardianName(g.name, d.guardianName)) {
          r.warnings.push(`The email belongs to ${g.name}, not ${d.guardianName}; check it's the right parent`);
        }
      } else {
        const others = othersWithPhone(ctx.db, guardian);
        if (others.length) r.warnings.push(`${others[0]!.name} also uses ${d.guardianPhone}; ${d.guardianName} will be added as a separate guardian`);
      }
    }
  }
  return {
    rows: checked,
    valid: checked.filter((r) => !r.errors.length).length,
    invalid: checked.filter((r) => r.errors.length).length,
  };
}

export const adminRoutes: Route[] = [
  // ---------- Users ----------
  {
    method: "GET",
    path: "/users",
    handler: (ctx) => {
      requirePerm(ctx, "users.view");
      const { kind, status, roleId, search, sort = "name" } = ctx.query;
      const rows = ctx.db.users.rows
        .filter((u) => (!kind || kind === "all" || u.kind === kind) && (!status || status === "all" || u.status === status) && (!roleId || u.roleIds.includes(roleId)))
        .filter((u) => matches(search, u.name, u.email, u.phone))
        .map(({ password: _password, ...u }) => ({ ...u, roleNames: u.roleIds.map((id) => ctx.db.roles.get(id)?.name ?? id) }));
      return paginate(sortRows(rows, sort, { name: (r) => r.name, email: (r) => r.email, lastLoginAt: (r) => r.lastLoginAt ?? "" }), ctx.query);
    },
  },
  {
    method: "POST",
    path: "/users/invite",
    handler: (ctx) => {
      requirePerm(ctx, "users.create");
      const db = ctx.db;
      const { name, email, phone, kind, roleIds, designation } = ctx.body ?? {};
      const f: Record<string, string> = {};
      if (!name?.trim()) f.name = "Required";
      if (!EMAIL.test(email ?? "")) f.email = "Enter a valid email";
      if (!Array.isArray(roleIds) || !roleIds.length) f.roleIds = "Choose at least one role";
      if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
      let staffId: string | undefined;
      if (kind === "staff") {
        const st = db.staff.insert({
          id: nextId(db, "st"), empNo: `EMP${String(db.staff.size + 1).padStart(3, "0")}`, title: "", name: name.trim(),
          email: email.trim(), phone: phone ?? "", designation: designation?.trim() || "Staff", staffType: staffTypeFor(designation ?? ""), status: "active", joinedOn: todayISO(ctx),
        });
        staffId = st.id;
      }
      const res = inviteUser(ctx, { name: name.trim(), email: email.trim(), phone, kind: kind === "parent" ? "parent" : "staff", roleIds, staffId });
      if (staffId) db.staff.get(staffId)!.userId = res.user.id;
      audit(ctx, "user.invite", "User", `Invited ${res.user.name} (${res.user.email})`, res.user.id);
      return { id: res.user.id, inviteLink: res.inviteLink };
    },
  },
  {
    method: "PUT",
    path: "/users/:id/roles",
    handler: (ctx) => {
      const s = requirePerm(ctx, "users.edit");
      const u = ctx.db.users.get(ctx.params.id) ?? fail(404, "not_found", "User not found.");
      const roleIds = (ctx.body?.roleIds ?? []) as string[];
      if (!roleIds.length) fail(422, "validation", "Choose at least one role.");
      if (u.id === s.id && u.roleIds.includes("role_admin") && !roleIds.includes("role_admin")) fail(409, "self_lockout", "You can't remove your own Admin role.");
      u.roleIds = roleIds.filter((id) => ctx.db.roles.get(id));
      audit(ctx, "user.roles", "User", `Changed roles for ${u.name}: ${u.roleIds.map((id) => ctx.db.roles.get(id)?.name).join(", ")}`, u.id);
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "/users/:id/deactivate",
    handler: (ctx) => {
      const s = requirePerm(ctx, "users.edit");
      const u = ctx.db.users.get(ctx.params.id) ?? fail(404, "not_found", "User not found.");
      if (u.id === s.id) fail(409, "self_lockout", "You can't deactivate your own account.");
      if (u.roleIds.includes("role_admin") && activeAdmins(ctx).length <= 1) fail(409, "last_admin", "At least one active admin is required.");
      u.status = "deactivated";
      audit(ctx, "user.deactivate", "User", `Deactivated ${u.name}; their sessions were signed out`, u.id);
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "/users/:id/reactivate",
    handler: (ctx) => {
      requirePerm(ctx, "users.edit");
      const u = ctx.db.users.get(ctx.params.id) ?? fail(404, "not_found", "User not found.");
      if (u.staffId && ctx.db.staff.get(u.staffId)?.status === "inactive") fail(409, "invalid_transition", `${u.name} has left the school. Mark them as back in Staff first.`);
      u.status = u.password ? "active" : "invited";
      audit(ctx, "user.reactivate", "User", `Reactivated ${u.name}`, u.id);
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "/users/:id/resend-invite",
    handler: (ctx) => {
      requirePerm(ctx, "users.create");
      const u = ctx.db.users.get(ctx.params.id) ?? fail(404, "not_found", "User not found.");
      if (u.status !== "invited") fail(409, "invalid_transition", "This user has already accepted their invitation.");
      const token = `inv-${u.id}`;
      ctx.db.tokens.set(token, { userId: u.id, kind: "invite" });
      audit(ctx, "user.invite", "User", `Re-sent invitation to ${u.email}`, u.id);
      return { inviteLink: `/invite/${token}` };
    },
  },

  // ---------- Roles ----------
  {
    method: "GET",
    path: "/roles",
    handler: (ctx) => {
      requirePerm(ctx, "roles.view");
      return ctx.db.roles.rows.map((r) => withUserCount(ctx, r));
    },
  },
  {
    method: "POST",
    path: "/roles",
    handler: (ctx) => {
      requirePerm(ctx, "roles.edit");
      const permissions = validateRole(ctx, ctx.body);
      const r = ctx.db.roles.insert({
        id: nextId(ctx.db, "role"), name: ctx.body.name.trim(), description: ctx.body.description?.trim() ?? "",
        system: false, scope: ctx.body.scope, permissions,
      });
      audit(ctx, "role.create", "Role", `Created role ${r.name}`, r.id);
      return withUserCount(ctx, r);
    },
  },
  {
    method: "PUT",
    path: "/roles/:id",
    handler: (ctx) => {
      requirePerm(ctx, "roles.edit");
      const r = ctx.db.roles.get(ctx.params.id) ?? fail(404, "not_found", "Role not found.");
      if (r.id === "role_admin") fail(409, "protected", "The Admin role always has full access and can't be edited.");
      const permissions = validateRole(ctx, { ...ctx.body, scope: r.system ? r.scope : ctx.body.scope }, r.id);
      Object.assign(r, {
        name: r.system ? r.name : ctx.body.name.trim(),
        description: ctx.body.description?.trim() ?? r.description,
        scope: r.system ? r.scope : ctx.body.scope,
        permissions,
      });
      audit(ctx, "role.update", "Role", `Updated permissions for ${r.name}`, r.id);
      return withUserCount(ctx, r);
    },
  },
  {
    method: "DELETE",
    path: "/roles/:id",
    handler: (ctx) => {
      requirePerm(ctx, "roles.edit");
      const r = ctx.db.roles.get(ctx.params.id) ?? fail(404, "not_found", "Role not found.");
      if (r.system) fail(409, "protected", "Built-in roles can't be deleted.");
      if (withUserCount(ctx, r).userCount) fail(409, "in_use", "Remove this role from all users before deleting it.");
      ctx.db.roles.remove(r.id);
      audit(ctx, "role.delete", "Role", `Deleted role ${r.name}`, r.id);
      return { ok: true };
    },
  },

  // ---------- Audit ----------
  {
    method: "GET",
    path: "/audit-log",
    handler: (ctx) => {
      requirePerm(ctx, "audit.view");
      const { search, entity } = ctx.query;
      const rows = ctx.db.audit.rows.filter((a) => (!entity || entity === "all" || a.entity === entity) && matches(search, a.actor, a.summary, a.action));
      return paginate(rows, ctx.query);
    },
  },

  // ---------- Import ----------
  {
    method: "POST",
    path: "/imports/students/preview",
    handler: (ctx): ImportPreview => {
      requirePerm(ctx, "import.create");
      return reviewImport(ctx, ctx.body?.rows as ImportRow[]);
    },
  },
  {
    method: "POST",
    path: "/imports/students/commit",
    handler: (ctx) => {
      requirePerm(ctx, "import.create");
      const checked = reviewImport(ctx, ctx.body?.rows as ImportRow[]);
      const ready = checked.rows.filter((r) => !r.errors.length);
      if (!ready.length) fail(422, "validation", "No rows are ready to import. Fix the errors and try again.");
      const classes = currentClasses(ctx.db);
      let invited = 0;
      for (const { data } of ready) {
        const { inviteLink } = createStudent(
          ctx,
          {
            admissionNo: data.admissionNo || undefined,
            firstName: data.firstName, lastName: data.lastName, gender: data.gender as "M" | "F", dob: data.dob,
            joinedDate: data.joinedDate || undefined, religion: data.religion || undefined,
            classId: classes.find((c) => c.name === data.className)!.id, address: data.address || "—",
            guardian: {
              name: data.guardianName, relationship: (data.guardianRelationship || "Guardian") as Guardian["relationship"],
              phone: data.guardianPhone, email: data.guardianEmail || undefined, address: data.address || undefined,
            },
            inviteParent: !!ctx.body?.inviteParents,
          },
          // Existing students were admitted long ago: no admission fee or first invoice.
          { firstInvoice: false },
        );
        if (inviteLink) invited++;
      }
      audit(ctx, "import.students", "Import", `Imported ${ready.length} students (${checked.invalid} skipped, ${invited} parents invited)`);
      return { created: ready.length, skipped: checked.invalid, invited, errors: checked.rows.filter((r) => r.errors.length).map((r) => ({ index: r.index, errors: r.errors })) };
    },
  },
];
