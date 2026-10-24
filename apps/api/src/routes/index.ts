import { config } from "../config";
import type { RouteDef } from "../http/route";
import { healthRoutes } from "./health";
import { testSupportRoutes } from "./test-support";

/** Every /api/v1 route. Access-matrix tests iterate over this list. */
export const routes: RouteDef<any, any>[] = [...healthRoutes, ...(config.ENABLE_TEST_ROUTES ? testSupportRoutes : [])];
