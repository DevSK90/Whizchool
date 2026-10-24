import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config";
import { errorHandler, notFound } from "./http/errors";
import { sessionMiddleware } from "./auth/session";
import { originCheck } from "./http/origin";
import { mountRoutes } from "./http/route";
import { logger } from "./logger";
import { routes } from "./routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/api/v1/health" },
    }),
  );

  const api = express.Router();
  api.use(express.json({ limit: "1mb" }));
  api.use(originCheck(config.APP_ORIGINS));
  api.use(sessionMiddleware);
  mountRoutes(api, routes);
  api.use(notFound);

  app.use("/api/v1", api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
