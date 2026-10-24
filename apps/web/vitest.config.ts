import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `--mode api` runs the contract tests over HTTP against the real API (see tests/contract/helpers.ts).
export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: mode === "api" ? ["tests/contract/**/*.test.ts"] : ["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts"],
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
