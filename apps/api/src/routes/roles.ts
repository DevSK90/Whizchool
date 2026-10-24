import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { ALL_PERMISSIONS, type PermissionKey } from "@whizchool/shared/permissions";
import type { Role } from "@whizchool/shared/types";
import { audit } from "../audit";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { defineRoute } from "../http/route";
import { ADMIN_ROLE_ID, SYSTEM_ROLE_ORDER } from "../roles";

const withCount = {
  _count: { select: { users: { where: { user: { status: { not: "deactivated" } } } } } },
} satisfies Prisma.RoleInclude;

type RoleRow = Prisma.RoleGetPayload<{ include: typeof withCount }>;

const toRole = (r: RoleRow): Role => ({
  id: r.id,
  name: r.name,
  description: r.description,
  system: r.system,
  scope: r.scope,
  permissions: r.permissions as PermissionKey[],
  userCount: r._count.users,
});

const known = new Set<string>(ALL_PERMISSIONS);

const roleBody = z.object({
  name: z.string().trim().min(1, "Required").max(60),
  description: z.string().trim().max(300).optional(),
  scope: z.enum(["all", "own_class", "own_subjects", "own_children"], { error: "Choose a data scope" }),
  // Unknown keys are dropped rather than rejected, so an older client can't break the matrix.
  permissions: z
    .array(z.string())
    .max(200)
    .default([])
    .transform((p) => [...new Set(p.filter((k) => known.has(k)))]),
});

async function assertUniqueName(name: string, exceptId?: string) {
  const clash = await prisma.role.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "duplicate", "A role with this name already exists.", { name: "Already exists" });
}

const findRole = async (id: string) =>
  (await prisma.role.findUnique({ where: { id }, include: withCount })) ?? Promise.reject(new ApiError(404, "not_found", "Role not found."));

export const roleRoutes = [
  defineRoute({
    method: "GET",
    path: "/roles",
    access: { permission: "roles.view" },
    summary: "Roles with their permissions, data scope and active user count",
    handler: async () => {
      const roles = await prisma.role.findMany({ include: withCount, orderBy: { name: "asc" } });
      // Built-in roles first in product order (Admin first), then custom roles alphabetically.
      const rank = (r: RoleRow) => {
        const i = SYSTEM_ROLE_ORDER.indexOf(r.id);
        return i >= 0 ? i : r.system ? SYSTEM_ROLE_ORDER.length : SYSTEM_ROLE_ORDER.length + 1;
      };
      // Array.sort is stable, so roles of equal rank keep the alphabetical order from the query.
      return roles.sort((a, b) => rank(a) - rank(b)).map(toRole);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/roles",
    access: { permission: "roles.edit" },
    summary: "Create a custom role",
    body: roleBody,
    handler: async ({ auth, body }) => {
      await assertUniqueName(body.name);
      const role = await prisma.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: { name: body.name, description: body.description ?? "", scope: body.scope, permissions: body.permissions, system: false },
          include: withCount,
        });
        await audit(tx, auth, { action: "role.create", entity: "Role", entityId: role.id, summary: `Created role ${role.name}`, after: body.permissions });
        return role;
      });
      return toRole(role);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/roles/:id",
    access: { permission: "roles.edit" },
    summary: "Update a role's permissions (built-in roles keep their name and scope)",
    body: roleBody,
    handler: async ({ auth, params, body }) => {
      const role = await findRole(params.id);
      if (role.id === ADMIN_ROLE_ID) throw new ApiError(409, "protected", "The Admin role always has full access and can't be edited.");
      if (!role.system) await assertUniqueName(body.name, role.id);
      const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.role.update({
          where: { id: role.id },
          data: {
            name: role.system ? role.name : body.name,
            scope: role.system ? role.scope : body.scope,
            description: body.description ?? role.description,
            permissions: body.permissions,
          },
          include: withCount,
        });
        await audit(tx, auth, {
          action: "role.update",
          entity: "Role",
          entityId: role.id,
          summary: `Updated permissions for ${updated.name}`,
          before: role.permissions,
          after: updated.permissions,
        });
        return updated;
      });
      return toRole(updated);
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/roles/:id",
    access: { permission: "roles.edit" },
    summary: "Delete a custom role that nobody holds",
    handler: async ({ auth, params }) => {
      const role = await findRole(params.id);
      if (role.system) throw new ApiError(409, "protected", "Built-in roles can't be deleted.");
      if (role._count.users) throw new ApiError(409, "in_use", "Remove this role from all users before deleting it.");
      await prisma.$transaction(async (tx) => {
        // Deactivated users may still hold it; they lose it with the role.
        await tx.userRole.deleteMany({ where: { roleId: role.id } });
        await tx.role.delete({ where: { id: role.id } });
        await audit(tx, auth, { action: "role.delete", entity: "Role", entityId: role.id, summary: `Deleted role ${role.name}`, before: role.permissions });
      });
      return { ok: true };
    },
  }),
];
