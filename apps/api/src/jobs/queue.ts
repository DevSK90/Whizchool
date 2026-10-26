import { PgBoss } from "pg-boss";
import { config } from "../config";
import { logger } from "../logger";

/**
 * Background work. In production the jobs live in Postgres (pg-boss) and survive restarts; with
 * JOBS_MODE=inline (tests) they run in-process straight away so results can be checked at once.
 */
export type JobName = "messages.deliver" | "email.send" | "maintenance.sweep" | "maintenance.cleanup";

type Handler = (data: Record<string, unknown>) => Promise<void>;

const handlers = new Map<JobName, Handler>();

/** Jobs that keep failing are retried with growing gaps: 30 s, 1 min, 2 min… up to 6 tries. */
const QUEUE_OPTIONS = { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 600 };

const SCHEDULES: { name: JobName; cron: string }[] = [
  // Picks up deliveries whose job was lost (a crash between saving and queueing) or stalled.
  { name: "maintenance.sweep", cron: "* * * * *" },
  // Old sessions, tokens, idempotency keys and never-attached uploads.
  { name: "maintenance.cleanup", cron: "30 2 * * *" },
];

let boss: PgBoss | null = null;

export function registerJob(name: JobName, handler: Handler) {
  handlers.set(name, handler);
}

async function run(name: JobName, data: Record<string, unknown>) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler for job ${name}`);
  await handler(data);
}

export async function startJobs() {
  if (config.JOBS_MODE === "inline" || boss) return;
  boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss" });
  boss.on("error", (err) => logger.error({ err }, "job queue error"));
  await boss.start();
  for (const name of handlers.keys()) {
    await boss.createQueue(name, QUEUE_OPTIONS);
    await boss.work<Record<string, unknown>>(name, async (jobs) => {
      for (const job of jobs) await run(name, job.data);
    });
  }
  for (const s of SCHEDULES) await boss.schedule(s.name, s.cron, null, { tz: "Asia/Colombo" });
  logger.info({ queues: [...handlers.keys()] }, "job queue started");
}

export async function stopJobs() {
  await boss?.stop({ graceful: true, timeout: 10_000 });
  boss = null;
}

/**
 * Queues a job. Call it after the transaction that created the work has committed; if the
 * process dies in between, the minute sweeper finds the work in the database and queues it.
 */
export async function enqueue(name: JobName, data: Record<string, unknown>) {
  if (config.JOBS_MODE === "inline") {
    try {
      await run(name, data);
    } catch (err) {
      logger.error({ err, name }, "inline job failed");
    }
    return;
  }
  if (!boss) throw new Error("Job queue not started");
  await boss.send(name, data);
}
