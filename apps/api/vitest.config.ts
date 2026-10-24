import { defineConfig } from "vitest/config";
import { ORIGIN, TEST_DATABASE_URL } from "./test/env";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      APP_URL: ORIGIN,
      EMAIL_TRANSPORT: "log",
      LOG_LEVEL: "silent",
    },
    globalSetup: ["test/global-setup.ts"],
    // Test files share one database; run them one at a time so they can't trip over each other.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
