import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { TEST_DATABASE_URL } from "./env";

const API_ROOT = join(import.meta.dirname, "..");

/** Everything that shapes the seeded database; a change rebuilds the template. */
function fingerprint() {
  const hash = createHash("sha256");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const files = [
    ...walk(join(API_ROOT, "prisma/migrations")),
    join(API_ROOT, "src/seed/demo-school.ts"),
    ...walk(join(API_ROOT, "../../packages/demo/src")),
  ].sort();
  for (const f of files) hash.update(f.slice(API_ROOT.length)).update(readFileSync(f));
  return hash.digest("hex").slice(0, 32);
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Gives every test run a fresh copy of the seeded demo school. Seeding takes ~30s, so it's done
 * once into a template database; each run clones the template (about a second).
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const testDb = url.pathname.slice(1);
  const templateDb = `${testDb}_template`;
  const templateUrl = Object.assign(new URL(url), { pathname: `/${templateDb}` }).toString();
  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString() });
  await admin.connect();
  try {
    const print = fingerprint();
    const { rows } = await admin.query(
      "SELECT shobj_description(oid, 'pg_database') AS print FROM pg_database WHERE datname = $1",
      [templateDb],
    );
    if (rows[0]?.print !== print) {
      await admin.query(`DROP DATABASE IF EXISTS ${quote(templateDb)} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${quote(templateDb)}`);
      const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: templateUrl };
      execSync("npx prisma migrate deploy", { cwd: API_ROOT, env, stdio: "pipe" });
      execSync("npx tsx prisma/seed.ts", { cwd: API_ROOT, env, stdio: "pipe" });
      await admin.query(`COMMENT ON DATABASE ${quote(templateDb)} IS '${print}'`);
    }
    await admin.query(`DROP DATABASE IF EXISTS ${quote(testDb)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${quote(testDb)} TEMPLATE ${quote(templateDb)}`);
  } finally {
    await admin.end();
  }
}
