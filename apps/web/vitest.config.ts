import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Contract files the real API already passes. Add each area as its phase lands (BACKEND_PLAN.md §5).
const API_CONTRACTS = ["tests/contract/auth.test.ts", "tests/contract/admin.test.ts"];

// `--mode api` runs those contract tests over HTTP against the real API (see tests/contract/helpers.ts).
export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: mode === "api" ? API_CONTRACTS : ["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    env: mode === "api" ? { CONTRACT_TARGET: "http" } : {},
    // Contract tests reset a full school; give them room on slower machines.
    testTimeout: mode === "api" ? 120_000 : 20_000,
    hookTimeout: mode === "api" ? 120_000 : 10_000,
    // Over HTTP every file shares one database, so run files one at a time.
    fileParallelism: mode !== "api",
  },
}));
