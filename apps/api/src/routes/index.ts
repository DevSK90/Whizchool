import { config } from "../config";
import type { RouteDef } from "../http/route";
import { admissionRoutes } from "./admissions";
import { attendanceRoutes } from "./attendance";
import { auditLogRoutes } from "./audit-log";
import { authRoutes } from "./auth";
import { classRoutes } from "./classes";
import { dashboardRoutes } from "./dashboard";
import { examRoutes } from "./exams";
import { feeRoutes } from "./fees";
import { fileRoutes } from "./files";
import { healthRoutes } from "./health";
import { importRoutes } from "./imports";
import { messageRoutes } from "./messages";
import { payhereRoutes } from "./payhere";
import { promotionRoutes } from "./promotions";
import { publicRoutes } from "./public";
import { reportCardRoutes } from "./report-cards";
import { resultRoutes } from "./results";
import { roleRoutes } from "./roles";
import { schoolRoutes } from "./school";
import { studentRoutes } from "./students";
import { testSupportRoutes } from "./test-support";
import { timetableRoutes } from "./timetables";
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
  ...timetableRoutes,
  ...studentRoutes,
  ...fileRoutes,
  ...admissionRoutes,
  ...importRoutes,
  ...attendanceRoutes,
  ...messageRoutes,
  ...examRoutes,
  ...reportCardRoutes,
  ...resultRoutes,
  ...promotionRoutes,
  ...feeRoutes,
  ...payhereRoutes,
  ...dashboardRoutes,
  ...(config.ENABLE_TEST_ROUTES ? testSupportRoutes : []),
];
