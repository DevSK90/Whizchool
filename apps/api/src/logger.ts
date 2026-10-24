import { pino } from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.LOG_LEVEL,
  // Never log credentials or session cookies.
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.passwordHash"],
    censor: "[redacted]",
  },
  ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { singleLine: true } } } : {}),
});
