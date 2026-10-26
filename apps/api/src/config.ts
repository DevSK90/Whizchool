import { z } from "zod";

if (process.env.NODE_ENV !== "test") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file: rely on the real environment (CI, production)
  }
}

const bool = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Public URL of the web app; links in emails point here. */
  APP_URL: z
    .url()
    .default("http://localhost:3000")
    .transform((u) => u.replace(/\/+$/, "")),
  /** Comma-separated origins allowed to send state-changing requests (CSRF check). Defaults to APP_URL's origin. */
  APP_ORIGINS: z
    .string()
    .optional()
    .transform((s) => s?.split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean)),
  /** Express "trust proxy": false, true, or the number of proxy hops (1 behind Caddy). */
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => (v === "true" ? true : v === "false" ? false : Number(v))),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Session cookie gets the Secure flag (HTTPS only). Defaults to true in production. */
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),

  /** "smtp" (Mailpit in development), "resend" (production) or "log" (tests: kept in memory). */
  EMAIL_TRANSPORT: z.enum(["smtp", "resend", "log"]).optional(),
  EMAIL_FROM: z.string().default("Whizchool <no-reply@whizchool.lk>"),
  SMTP_URL: z.string().default("smtp://localhost:2525"),
  RESEND_API_KEY: z.string().optional(),

  /**
   * Also return invite/reset links in API responses so they can be opened without an inbox
   * (the demo UI shows them). Development and tests only; refused in production.
   */
  EXPOSE_DEV_LINKS: z.enum(["true", "false"]).optional(),
  /**
   * "notifylk" sends real SMS (production). "mailpit" delivers each SMS to Mailpit as an email so
   * it can be read in development. "log" keeps them in memory (tests).
   */
  SMS_TRANSPORT: z.enum(["notifylk", "mailpit", "log"]).optional(),
  NOTIFYLK_USER_ID: z.string().optional(),
  NOTIFYLK_API_KEY: z.string().optional(),
  /** "pgboss" runs jobs from a Postgres-backed queue; "inline" runs them in-process right away (tests). */
  JOBS_MODE: z.enum(["pgboss", "inline"]).optional(),
  /** Where uploaded files are kept (local disk; S3-compatible storage arrives with deployment). */
  STORAGE_DIR: z.string().default("storage"),
  /** Signs short-lived file links. Required (32+ characters) in production. */
  FILE_URL_SECRET: z.string().min(32, "Use at least 32 characters").optional(),
  /** Per-IP limits on sign-in, password reset and other abuse-prone endpoints. */
  RATE_LIMITS: bool("true"),
  /** Mounts /api/v1/test/* (database reset for the contract suite). Refused in production. */
  ENABLE_TEST_ROUTES: bool("false"),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee apps/api/.env.example.`);
  }
  const env = parsed.data;
  const production = env.NODE_ENV === "production";
  const config = {
    ...env,
    APP_ORIGINS: env.APP_ORIGINS?.length ? env.APP_ORIGINS : [new URL(env.APP_URL).origin],
    COOKIE_SECURE: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : production,
    EMAIL_TRANSPORT: env.EMAIL_TRANSPORT ?? (production ? "resend" : env.NODE_ENV === "test" ? "log" : "smtp"),
    EXPOSE_DEV_LINKS: env.EXPOSE_DEV_LINKS ? env.EXPOSE_DEV_LINKS === "true" : !production,
    SMS_TRANSPORT: env.SMS_TRANSPORT ?? (production ? "notifylk" : env.NODE_ENV === "test" ? "log" : "mailpit"),
    JOBS_MODE: env.JOBS_MODE ?? (env.NODE_ENV === "test" ? "inline" : "pgboss"),
    // A fixed development secret keeps file links valid across restarts; production must set its own.
    FILE_URL_SECRET: env.FILE_URL_SECRET ?? (production ? "" : "whizchool-development-file-url-secret!"),
  };
  if (production) {
    const unsafe = [
      config.ENABLE_TEST_ROUTES && "ENABLE_TEST_ROUTES (allows wiping the database)",
      config.EXPOSE_DEV_LINKS && "EXPOSE_DEV_LINKS (leaks invite and reset links)",
      !config.COOKIE_SECURE && "COOKIE_SECURE=false (session cookie over plain HTTP)",
      !config.FILE_URL_SECRET && "FILE_URL_SECRET missing (file links can't be signed)",
    ].filter(Boolean);
    if (unsafe.length) throw new Error(`Unsafe production configuration: ${unsafe.join("; ")}.`);
  }
  if (config.SMS_TRANSPORT === "notifylk" && (!config.NOTIFYLK_USER_ID || !config.NOTIFYLK_API_KEY)) {
    throw new Error("SMS_TRANSPORT=notifylk needs NOTIFYLK_USER_ID and NOTIFYLK_API_KEY.");
  }
  if (config.EMAIL_TRANSPORT === "resend" && !config.RESEND_API_KEY) {
    throw new Error("EMAIL_TRANSPORT=resend needs RESEND_API_KEY.");
  }
  return config;
}

export const config = load();
export type Config = typeof config;
export const isProduction = config.NODE_ENV === "production";
