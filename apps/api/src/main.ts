import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { startJobs, stopJobs } from "./jobs";
import { logger } from "./logger";

const server = createApp().listen(config.PORT, () => {
  logger.info(`Whizchool API listening on http://localhost:${config.PORT}/api/v1 (${config.NODE_ENV})`);
  startJobs().catch((err) => {
    logger.fatal({ err }, "job queue failed to start");
    process.exit(1);
  });
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await stopJobs();
    await prisma.$disconnect();
    process.exit(0);
  });
  // Don't hang forever on keep-alive connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
