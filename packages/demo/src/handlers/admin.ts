import type { Route } from "../router";
import type { ImportPreview, ImportRow, Role } from "@whizchool/shared/types";
import { ALL_PERMISSIONS, type DataScope, type PermissionKey } from "@whizchool/shared/permissions";
import {
  audit,
  currentClasses,
  fail,
  matches,
  paginate,
  requirePerm,
  sortRows,
  type Ctx,
} from "../helpers";
import { nextId } from "../db";
import { createStudent, inviteUser } from "./students";

const SCOPES: DataScope[] = ["all", "own_class", "own_subjects", "own_children"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^0\d{2}\s?\d{3}\s?\d{4}$/;

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

function validateImportRow(ctx: Ctx, row: ImportRow, seen: Set<string>) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const classes = currentClasses(ctx.db);
  if (!row.firstName?.trim()) errors.push("First name is missing");
  if (!row.lastName?.trim()) errors.push("Last name is missing");
  if (!["M", "F"].includes((row.gender ?? "").trim().toUpperCase())) errors.push("Gender must be M or F");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dob ?? "")) errors.push("Date of birth must be YYYY-MM-DD");
  if (!classes.some((c) => c.name === row.className?.trim())) errors.push(`Unknown class “${row.className ?? ""}”`);
  if (!row.guardianName?.trim()) errors.push("Guardian name is missing");
  if (!PHONE.test(row.guardianPhone ?? "")) errors.push("Guardian phone is invalid");
  if (row.guardianEmail && !EMAIL.test(row.guardianEmail)) errors.push("Guardian email is invalid");
  if (!row.guardianEmail) warnings.push("No guardian email – parent can't be invited to the portal");
  if (row.admissionNo) {
    if (ctx.db.students.rows.some((s) => s.admissionNo === row.admissionNo)) errors.push(`Admission no. ${row.admissionNo} already exists`);
    if (seen.has(row.admissionNo)) errors.push("Duplicate admission no. in file");
    seen.add(row.admissionNo);
  }
  const dupe = ctx.db.students.rows.find((s) => s.firstName === row.firstName?.trim() && s.lastName === row.lastName?.trim() && s.dob === row.dob);
  if (dupe) warnings.push(`Possible duplicate of ${dupe.admissionNo}`);
  return { errors, warnings };
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
          email: email.trim(), phone: phone ?? "", designation: designation?.trim() || "Staff", status: "active",
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
      const rows = (ctx.body?.rows ?? []) as ImportRow[];
      if (!rows.length) fail(422, "validation", "The file has no data rows.");
      if (rows.length > 2000) fail(422, "validation", "Import at most 2,000 rows at a time.");
      const seen = new Set<string>();
      const result = rows.map((data, index) => ({ index: index + 1, data, ...validateImportRow(ctx, data, seen) }));
      return { rows: result, valid: result.filter((r) => !r.errors.length).length, invalid: result.filter((r) => r.errors.length).length };
    },
  },
  {
    method: "POST",
    path: "/imports/students/commit",
    handler: (ctx) => {
      requirePerm(ctx, "import.create");
      const rows = (ctx.body?.rows ?? []) as ImportRow[];
      const seen = new Set<string>();
      const classes = currentClasses(ctx.db);
      let created = 0;
      let invited = 0;
      let skipped = 0;
      for (const row of rows) {
        if (validateImportRow(ctx, row, seen).errors.length) {
          skipped++;
          continue;
        }
        const cls = classes.find((c) => c.name === row.className.trim())!;
        const { inviteLink } = createStudent(ctx, {
          firstName: row.firstName, lastName: row.lastName, gender: row.gender.trim().toUpperCase() as "M" | "F", dob: row.dob,
          classId: cls.id, address: row.address || "—",
          guardian: { name: row.guardianName, relationship: "Guardian", phone: row.guardianPhone, email: row.guardianEmail || undefined },
          inviteParent: !!ctx.body?.inviteParents,
        });
        created++;
        if (inviteLink) invited++;
      }
      audit(ctx, "import.students", "Import", `Imported ${created} students (${skipped} skipped, ${invited} parents invited)`);
      return { created, skipped, invited };
    },
  },
];
