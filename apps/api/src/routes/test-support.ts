import { z } from "zod";
import { isoDate, schoolToday, setSchoolToday } from "../dates";
import { prisma } from "../db";
import { sentEmails } from "../email/mailer";
import { sentSms } from "../sms/sender";
import { resetRateLimits } from "../http/rate-limit";
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
      resetRateLimits();
      sentEmails.length = 0;
      sentSms.length = 0;
      setSchoolToday(null);
      return undefined;
    },
  }),
  defineRoute({
    method: "POST",
    path: "/test/clock",
    access: "public",
    summary: "Pin the school's \"today\" (null to use the real date)",
    body: z.object({ today: isoDate().nullable() }),
    handler: ({ body }) => {
      setSchoolToday(body.today);
      return { today: schoolToday() };
    },
  }),
];
