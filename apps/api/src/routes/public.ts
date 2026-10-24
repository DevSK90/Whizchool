import { ApiError } from "@whizchool/shared/api";
import type { Grade } from "@whizchool/shared/types";
import { prisma } from "../db";
import { defineRoute } from "../http/route";

/** Data the public pages (landing, apply, sign-in) need before anyone signs in. */
export const publicRoutes = [
  defineRoute({
    method: "GET",
    path: "/public/school",
    access: "public",
    summary: "School name and contact details for public pages",
    handler: async () => {
      const s = await prisma.school.findUnique({ where: { id: "school" } });
      if (!s) throw new ApiError(503, "not_configured", "The school hasn't been set up yet.");
      return { name: s.name, shortName: s.shortName, motto: s.motto, address: s.address, phone: s.phone, email: s.email, ...(s.website ? { website: s.website } : {}) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/grades",
    access: "public",
    summary: "Grades 1–13 (the apply form's grade list)",
    handler: async (): Promise<Grade[]> => prisma.grade.findMany({ orderBy: { number: "asc" } }),
  }),
];
