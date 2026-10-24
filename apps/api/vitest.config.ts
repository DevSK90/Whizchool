import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      // A separate database so tests never touch dev data (created by docker/postgres-init.sql).
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://whizchool:whizchool@localhost:5433/whizchool_test",
      APP_ORIGINS: "http://localhost:3000",
      LOG_LEVEL: "silent",
    },
    globalSetup: ["test/global-setup.ts"],
  },
});
