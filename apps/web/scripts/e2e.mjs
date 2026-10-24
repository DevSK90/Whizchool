// Builds and runs the Playwright suite against the in-browser demo API.
// The suite's flows (applications, marks, PayHere sandbox…) rely on the demo backend, so the mode is
// pinned here: variables set on the process win over .env.local, which may select the real API.
import { spawnSync } from "node:child_process";

const env = { ...process.env, NEXT_PUBLIC_API_MODE: "mock" };
const run = (args) => {
  const { status } = spawnSync("npx", args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (status !== 0) process.exit(status ?? 1);
};

run(["next", "build"]);
run(["playwright", "test", ...process.argv.slice(2)]);
