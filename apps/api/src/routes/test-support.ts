import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { logger } from "../logger";
import { seedDemoSchool } from "../seed/demo-school";

/** Only mounted when ENABLE_TEST_ROUTES=true (never in production; see config.ts). */
export const testSupportRoutes = [
  defineRoute({
    method: "POST",
    path: "/test/reset",
    access: "public",
    summary: "Wipe the database and reload the demo school (contract tests)",
    handler: async () => {
      logger.info(await seedDemoSchool(prisma));
      return undefined;
    },
  }),
];
