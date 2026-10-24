import { config } from "../config";
import type { RouteDef } from "../http/route";
import { auditLogRoutes } from "./audit-log";
import { authRoutes } from "./auth";
import { classRoutes } from "./classes";
import { healthRoutes } from "./health";
import { publicRoutes } from "./public";
import { roleRoutes } from "./roles";
import { schoolRoutes } from "./school";
import { testSupportRoutes } from "./test-support";
import { userRoutes } from "./users";

/** Every /api/v1 route. Access-matrix tests iterate over this list. */
export const routes: RouteDef<any, any>[] = [
  ...healthRoutes,
  ...publicRoutes,
  ...authRoutes,
  ...userRoutes,
  ...roleRoutes,
  ...auditLogRoutes,
  ...schoolRoutes,
  ...classRoutes,
  ...(config.ENABLE_TEST_ROUTES ? testSupportRoutes : []),
];
