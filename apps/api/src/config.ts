import { z } from "zod";

if (process.env.NODE_ENV !== "test") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file: rely on the real environment (CI, production)
  }
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Comma-separated origins allowed to send state-changing requests (CSRF check). */
  APP_ORIGINS: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((o) => o.trim().replace(/\/+$/, ""))),
  /** Express "trust proxy": false, true, or the number of proxy hops (1 behind Caddy). */
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => (v === "true" ? true : v === "false" ? false : Number(v))),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Mounts /api/v1/test/* (database reset for the contract suite). Refused in production. */
  ENABLE_TEST_ROUTES: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee apps/api/.env.example.`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.ENABLE_TEST_ROUTES) {
    throw new Error("ENABLE_TEST_ROUTES must not be set in production: it allows wiping the database.");
  }
  return parsed.data;
}

export const config = load();
export const isProduction = config.NODE_ENV === "production";
