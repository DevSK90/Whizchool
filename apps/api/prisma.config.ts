import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env by itself.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: rely on the real environment (CI, production)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
