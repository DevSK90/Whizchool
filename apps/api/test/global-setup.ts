import { execSync } from "node:child_process";

/** Brings the test database to the latest migration before any test file runs. */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://whizchool:whizchool@localhost:5433/whizchool_test" },
  });
}
