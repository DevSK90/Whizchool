import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { staffTypeFor } from "@whizchool/shared/staff";
import type { User } from "@whizchool/shared/types";
import { audit } from "../audit";
import { issueToken } from "../auth/tokens";
import { config } from "../config";
import { nextNumber } from "../counters";
import { fromIsoDate, schoolToday } from "../dates";
import { prisma } from "../db";
import { sendEmail } from "../email/mailer";
import { inviteEmail, inviteLinkPath } from "../email/templates";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, omitNulls, page, parseSort, skipTake } from "../http/list";
import { defineRoute } from "../http/route";
import { ADMIN_ROLE_ID, countActiveAdmins } from "../roles";
import { schoolName } from "../school";

const userInclude = {
  roles: { include: { role: { select: { id: true, name: true } } } },
  staff: { select: { id: true, status: true } },
  guardian: { select: { id: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toUser(u: UserRow): User & { roleNames: string[] } {
  return {
    ...omitNulls({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      kind: u.kind,
      status: u.status,
      staffId: u.staff?.id ?? null,
      guardianId: u.guardian?.id ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      invitedAt: u.invitedAt?.toISOString() ?? null,
    }),
    roleIds: u.roles.map((r) => r.roleId),
    roleNames: u.roles.map((r) => r.role.name),
  };
}

const notFound = () => new ApiError(404, "not_found", "User not found.");

async function findUser(id: string) {
  return (await prisma.user.findUnique({ where: { id }, include: userInclude })) ?? Promise.reject(notFound());
}

/** Sends the invitation email (never throws); in development also returns the link for the UI to show. */
export async function deliverInvite(user: { name: string; email: string; kind: "staff" | "parent" }, token: string) {
  await sendEmail(inviteEmail(user, await schoolName(), token));
  return config.EXPOSE_DEV_LINKS ? inviteLinkPath(token) : undefined;
}

export const roleIds = z.array(z.string().max(100)).min(1, "Choose at least one role").max(20);

/** The roles to give a new login; refuses an email already in use. */
export async function checkInvite(email: string, ids: string[]) {
  if (await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } })) {
    throw new ApiError(409, "duplicate", "A user with this email already exists.", { email: "Already registered" });
  }
  const roles = await prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (!roles.length) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { roleIds: "Choose at least one role" });
  return roles;
}

export async function createInvitedUser(tx: Prisma.TransactionClient, data: { name: string; email: string; phone?: string; kind: "staff" | "parent"; roles: { id: string }[] }) {
  const user = await tx.user.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      phone: data.phone || null,
      kind: data.kind,
      status: "invited",
      invitedAt: new Date(),
      roles: { create: data.roles.map((r) => ({ roleId: r.id })) },
    },
  });
  return { user, token: await issueToken(tx, user.id, "invite") };
}

export const userRoutes = [
  defineRoute({
    method: "GET",
    path: "/users",
    access: { permission: "users.view" },
    summary: "List staff and parent accounts",
    query: listQuery.extend({
      kind: z.enum(["staff", "parent", "all"]).optional(),
      status: z.enum(["invited", "active", "deactivated", "all"]).optional(),
      roleId: z.string().max(100).optional(),
    }),
    handler: async ({ query }) => {
      const where: Prisma.UserWhereInput = {
        ...(query.kind && query.kind !== "all" ? { kind: query.kind } : {}),
        ...(query.status && query.status !== "all" ? { status: query.status } : {}),
        ...(query.roleId ? { roles: { some: { roleId: query.roleId } } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { email: { contains: query.search, mode: "insensitive" } },
                { phone: { contains: query.search } },
              ],
            }
          : {}),
      };
      const { field, dir } = parseSort(query.sort ?? "name", ["name", "email", "lastLoginAt"] as const, "name");
      const orderBy: Prisma.UserOrderByWithRelationInput[] = [
        field === "lastLoginAt" ? { lastLoginAt: { sort: dir, nulls: dir === "asc" ? "first" : "last" } } : { [field]: dir },
        { id: "asc" },
      ];
      const [rows, total] = await Promise.all([
        prisma.user.findMany({ where, orderBy, include: userInclude, ...skipTake(query) }),
        prisma.user.count({ where }),
      ]);
      return page(rows.map(toUser), total, query);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/users/invite",
    access: { permission: "users.create" },
    summary: "Create an account and email an invitation to set a password",
    body: z.object({
      name: z.string().trim().min(1, "Required").max(120),
      email: z.email("Enter a valid email").trim().toLowerCase().max(254),
      phone: z.string().trim().max(30).optional(),
      kind: z.enum(["staff", "parent"]).default("staff"),
      designation: z.string().trim().max(80).optional(),
      roleIds,
    }),
    handler: async ({ auth, body }) => {
      const roles = await checkInvite(body.email, body.roleIds);

      const { user, token } = await prisma.$transaction(async (tx) => {
        const { user, token } = await createInvitedUser(tx, { name: body.name, email: body.email, phone: body.phone, kind: body.kind, roles });
        if (body.kind === "staff") {
          const designation = body.designation || "Staff";
          const empNo = await nextNumber(tx, "empNo", (await tx.staff.count()) + 1);
          await tx.staff.create({
            data: {
              empNo: `EMP${String(empNo).padStart(3, "0")}`,
              title: "",
              name: body.name,
              email: body.email,
              phone: body.phone ?? "",
              designation,
              staffType: staffTypeFor(designation),
              joinedOn: fromIsoDate(schoolToday()),
              userId: user.id,
            },
          });
        }
        await audit(tx, auth, { action: "user.invite", entity: "User", entityId: user.id, summary: `Invited ${user.name} (${user.email})` });
        return { user, token };
      });
      return { id: user.id, inviteLink: await deliverInvite(user, token) };
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/users/:id/roles",
    access: { permission: "users.edit" },
    summary: "Replace a user's roles (takes effect on their next request)",
    body: z.object({ roleIds }),
    handler: async ({ auth, params, body }) => {
      const user = await findUser(params.id);
      const roles = await prisma.role.findMany({ where: { id: { in: body.roleIds } }, select: { id: true, name: true } });
      if (!roles.length) throw new ApiError(422, "validation", "Choose at least one role.");
      const losesAdmin = user.roles.some((r) => r.roleId === ADMIN_ROLE_ID) && !roles.some((r) => r.id === ADMIN_ROLE_ID);
      if (losesAdmin && user.id === auth.session.id) throw new ApiError(409, "self_lockout", "You can't remove your own Admin role.");
      if (losesAdmin && user.status === "active" && (await countActiveAdmins(prisma, user.id)) === 0) {
        throw new ApiError(409, "last_admin", "At least one active admin is required.");
      }
      await prisma.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: user.id } });
        await tx.userRole.createMany({ data: roles.map((r) => ({ userId: user.id, roleId: r.id })) });
        await audit(tx, auth, {
          action: "user.roles",
          entity: "User",
          entityId: user.id,
          summary: `Changed roles for ${user.name}: ${roles.map((r) => r.name).join(", ")}`,
          before: user.roles.map((r) => r.role.name),
          after: roles.map((r) => r.name),
        });
      });
      return { ok: true };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/users/:id/deactivate",
    access: { permission: "users.edit" },
    summary: "Block sign-in and end the user's sessions immediately",
    handler: async ({ auth, params }) => {
      const user = await findUser(params.id);
      if (user.id === auth.session.id) throw new ApiError(409, "self_lockout", "You can't deactivate your own account.");
      if (user.roles.some((r) => r.roleId === ADMIN_ROLE_ID) && user.status === "active" && (await countActiveAdmins(prisma, user.id)) === 0) {
        throw new ApiError(409, "last_admin", "At least one active admin is required.");
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { status: "deactivated" } });
        await tx.session.deleteMany({ where: { userId: user.id } });
        await audit(tx, auth, { action: "user.deactivate", entity: "User", entityId: user.id, summary: `Deactivated ${user.name}; their sessions were signed out` });
      });
      return { ok: true };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/users/:id/reactivate",
    access: { permission: "users.edit" },
    summary: "Allow sign-in again (or back to invited if no password was ever set)",
    handler: async ({ auth, params }) => {
      const user = await findUser(params.id);
      if (user.staff?.status === "inactive") throw new ApiError(409, "invalid_transition", `${user.name} has left the school. Mark them as back in Staff first.`);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { status: user.passwordHash ? "active" : "invited" } });
        await audit(tx, auth, { action: "user.reactivate", entity: "User", entityId: user.id, summary: `Reactivated ${user.name}` });
      });
      return { ok: true };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/users/:id/resend-invite",
    access: { permission: "users.create" },
    summary: "Email a fresh invitation link (the previous one stops working)",
    handler: async ({ auth, params }) => {
      const user = await findUser(params.id);
      if (user.status !== "invited") throw new ApiError(409, "invalid_transition", "This user has already accepted their invitation.");
      const token = await prisma.$transaction(async (tx) => {
        const token = await issueToken(tx, user.id, "invite");
        await tx.user.update({ where: { id: user.id }, data: { invitedAt: new Date() } });
        await audit(tx, auth, { action: "user.invite", entity: "User", entityId: user.id, summary: `Re-sent invitation to ${user.email}` });
        return token;
      });
      return { inviteLink: await deliverInvite(user, token) };
    },
  }),
];
