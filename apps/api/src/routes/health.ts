import { ApiError } from "@whizchool/shared/api";
import { prisma } from "../db";
import { defineRoute } from "../http/route";

export const healthRoutes = [
  defineRoute({
    method: "GET",
    path: "/health",
    access: "public",
    summary: "Liveness and database check, for Caddy and uptime monitoring",
    handler: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        throw new ApiError(503, "db_unavailable", "The database is not reachable.");
      }
      return { status: "ok", db: "ok" };
    },
  }),
];
