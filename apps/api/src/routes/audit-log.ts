import { z } from "zod";
import type { AuditEntry } from "@whizchool/shared/types";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, page, skipTake } from "../http/list";
import { defineRoute } from "../http/route";

export const auditLogRoutes = [
  defineRoute({
    method: "GET",
    path: "/audit-log",
    access: { permission: "audit.view" },
    summary: "Who changed what, newest first",
    query: listQuery.extend({ entity: z.string().max(60).optional() }),
    handler: async ({ query }) => {
      const where: Prisma.AuditLogWhereInput = {
        ...(query.entity && query.entity !== "all" ? { entity: query.entity } : {}),
        ...(query.search
          ? {
              OR: [
                { actor: { contains: query.search, mode: "insensitive" } },
                { summary: { contains: query.search, mode: "insensitive" } },
                { action: { contains: query.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], ...skipTake(query) }),
        prisma.auditLog.count({ where }),
      ]);
      return page(
        rows.map(
          (a): AuditEntry => ({
            id: a.id,
            at: a.at.toISOString(),
            actor: a.actor,
            action: a.action,
            entity: a.entity,
            ...(a.entityId ? { entityId: a.entityId } : {}),
            summary: a.summary,
          }),
        ),
        total,
        query,
      );
    },
  }),
];
