import { defineConfig, devices } from "@playwright/test";

// E2E runs against a production build on :3100 by default (`npm run test:e2e` builds first).
// Point E2E_BASE_URL at a running server (e.g. `next dev` on :3000) to skip starting one.
const PORT = 3100;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  // Each test gets a fresh browser context, so a fresh copy of the mock school data.
  fullyParallel: true,
  // Each worker runs a full Chrome plus the in-browser mock school; more than two starve each other.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 90_000,
  use: {
    baseURL,
    // Uses the installed Google Chrome, so no browser download is needed.
    channel: "chrome",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1366, height: 860 } }, testIgnore: /\.mobile\.spec\.ts$/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" }, testMatch: /\.mobile\.spec\.ts$/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `npx next start --port ${PORT}`, url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
