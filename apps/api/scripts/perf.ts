// `npm run perf -w @whizchool/api`: response times of the busiest API calls at a large school's size.
// Loads a ~1,600-student demo school into its own database (whizchool_perf, reseeded only when the
// schema or seed changes, or with --reseed), runs the API in a child process and times each call: one
// at a time, then with PERF_USERS (default 10) people clicking without pause, which is far busier than
// a school day. Budget: p95 under 300 ms one at a time (PLAN.md assumption 8); --strict exits non-zero
// when a call is over it.
import { execSync, fork } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import pg from "pg";
import { fingerprint } from "../test/global-setup";

const DATABASE_URL = process.env.PERF_DATABASE_URL ?? "postgresql://whizchool:whizchool@localhost:5433/whizchool_perf";
const ORIGIN = "http://localhost:3000";
const BUDGET_MS = 300;
const RUNS = Number(process.env.PERF_RUNS ?? 30);
const CONCURRENCY = Number(process.env.PERF_USERS ?? 10);
const TODAY = "2026-10-23";
const args = new Set(process.argv.slice(2));

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL,
  APP_URL: ORIGIN,
  EMAIL_TRANSPORT: "log",
  SMS_TRANSPORT: "log",
  JOBS_MODE: "inline",
  LOG_LEVEL: "warn",
  STORAGE_DIR: "storage-perf",
});

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Creates and seeds the perf database unless it already holds the current large seed. */
async function prepare() {
  const url = new URL(DATABASE_URL);
  const name = url.pathname.slice(1);
  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString() });
  await admin.connect();
  try {
    const print = `${fingerprint()}:large`;
    const { rows } = await admin.query("SELECT shobj_description(oid, 'pg_database') AS print FROM pg_database WHERE datname = $1", [name]);
    if (rows[0]?.print === print && !args.has("--reseed")) return;
    console.log("Seeding a 1,600-student school into", name, "(a few minutes)…");
    await admin.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${quote(name)}`);
    const cwd = join(import.meta.dirname, "..");
    const env = { ...process.env, SEED_SIZE: "large" };
    execSync("npx prisma migrate deploy", { cwd, env, stdio: "pipe" });
    execSync("npx tsx prisma/seed.ts", { cwd, env, stdio: "inherit" });
    await admin.query(`ANALYZE`).catch(() => undefined);
    await admin.query(`COMMENT ON DATABASE ${quote(name)} IS '${print}'`);
  } finally {
    await admin.end();
  }
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- loosely-typed responses

/**
 * A signed-in user: keeps the session cookie and sends the web app's Origin. Uses a keep-alive
 * connection like a browser does (Node's fetch adds ~10 ms a request on Windows, which isn't the API's time).
 */
function client(base: URL, cookie = "") {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const call = (path: string, method = "GET", payload?: unknown): Promise<Json> =>
    new Promise<Json>((resolve, reject) => {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const req = http.request(
        new URL(base.pathname + path, base),
        { method, agent, headers: { Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) } },
        (res) => {
          const set = res.headers["set-cookie"]?.[0];
          if (set) cookie = set.split(";")[0]!;
          let text = "";
          res.setEncoding("utf8").on("data", (c: string) => (text += c));
          res.on("end", () => {
            const data = text ? JSON.parse(text) : null;
            if (res.statusCode! >= 400) reject(new Error(`${method} ${path}: ${res.statusCode} ${text}`));
            else resolve(data);
          });
        },
      );
      req.on("error", (e: NodeJS.ErrnoException) => {
        // The server closes idle keep-alive connections after 5 s; a user who sat out a few calls can hit that.
        if (e.code === "ECONNRESET" && method === "GET") call(path, method, payload).then(resolve, reject);
        else reject(e);
      });
      req.end(body);
    });
  return {
    get: (path: string) => call(path),
    signIn: (email: string) => call("/auth/login", "POST", { email, password: "demo1234" }),
    /** Another browser tab with the same session, on its own connection. */
    tab: () => client(base, cookie),
    close: () => agent.destroy(),
  };
}
type Client = ReturnType<typeof client>;

async function signIn(base: URL, email: string) {
  const c = client(base);
  await c.signIn(email);
  return c;
}

const shortPath = (path: string) => path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|(?<=[/=])[a-z]+_\w+/g, ":id");
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

/** The API under test, in a child process so the timing client doesn't share its CPU. */
async function serve() {
  // Imported only now, so they pick up the environment above.
  const { createApp } = await import("../src/app");
  const { setSchoolToday } = await import("../src/dates");
  setSchoolToday(TODAY);
  const server = createApp().listen(0, "127.0.0.1", () => process.send!({ port: (server.address() as AddressInfo).port }));
  process.on("disconnect", () => process.exit(0));
}

async function startApi() {
  const child = fork(import.meta.filename, [], { env: { ...process.env, PERF_ROLE: "api" }, execArgv: ["--import", "tsx"] });
  const port = await new Promise<number>((resolve, reject) => {
    child.once("message", (m: { port: number }) => resolve(m.port));
    child.once("exit", (code) => reject(new Error(`The API exited (${code}) before it was ready.`)));
  });
  return { base: new URL(`http://127.0.0.1:${port}/api/v1`), stop: () => child.disconnect() };
}

async function main() {
  await prepare();
  const api = await startApi();
  const base = api.base;

  const [admin, teacher, accountant, parent] = await Promise.all(
    ["admin", "teacher", "accountant", "parent"].map((who) => signIn(base, `${who}@whizchool.lk`)),
  );
  const students: number = (await admin.get("/students?pageSize=5")).total;
  console.log(`${students} students on the roll. ${RUNS} runs per call after 3 warm-ups; budget p95 < ${BUDGET_MS} ms.\n`);

  // IDs the calls need: a big class, the teacher's class, the latest term test, a student and an invoice.
  const me = await teacher.get("/auth/me");
  const classes: Json[] = await admin.get("/classes");
  const big = classes.find((c) => c.name === "10-A") ?? classes[0];
  const exams: Json[] = await admin.get("/exams");
  const exam = exams.filter((e) => e.status !== "scheduled").at(-1) ?? exams[0];
  const detail = await admin.get(`/classes/${big.id}`);
  const subjectId = detail.subjects?.[0]?.subjectId;
  const student = (await admin.get(`/students?classId=${big.id}&pageSize=5`)).items[0];
  const invoice = (await accountant.get("/invoices?pageSize=5")).items[0];
  const payment = (await accountant.get("/payments?pageSize=5")).items[0];
  const myClass = me.classIds[0];

  const calls: [string, Client, string][] = [
    ["admin", admin, "/dashboard"],
    ["teacher", teacher, "/dashboard"],
    ["admin", admin, "/students?pageSize=25"],
    ["admin", admin, "/students?pageSize=25&search=perera"],
    ["admin", admin, "/students?pageSize=25&sort=-admissionNo&page=20"],
    ["admin", admin, `/students/${student.id}`],
    ["admin", admin, `/students/${student.id}/attendance`],
    ["admin", admin, `/students/${student.id}/results`],
    ["admin", admin, "/classes"],
    ["admin", admin, `/classes/${big.id}`],
    ["admin", admin, "/timetables/overview"],
    ["admin", admin, `/classes/${big.id}/timetable`],
    ["teacher", teacher, "/timetables/me"],
    ["parent", parent, `/students/${(await parent.get("/portal/children"))[0].id}/timetable`],
    ["admin", admin, "/attendance/summary"],
    ["teacher", teacher, `/attendance?classId=${myClass}`],
    ["admin", admin, "/exams"],
    ["admin", admin, `/exams/${exam.id}/progress`],
    ["admin", admin, `/exams/${exam.id}/marks?classId=${big.id}&subjectId=${subjectId}`],
    ["admin", admin, `/report-cards/overview?examId=${exam.id}`],
    ["admin", admin, `/report-cards?examId=${exam.id}&classId=${big.id}`],
    ["admin", admin, `/report-cards/batch?examId=${exam.id}&classId=${big.id}`],
    ["admin", admin, "/applications?pageSize=20"],
    ["accountant", accountant, "/fees/summary"],
    ["accountant", accountant, "/invoices?pageSize=25"],
    ["accountant", accountant, "/invoices?pageSize=25&status=overdue"],
    ["accountant", accountant, "/invoices?pageSize=25&sort=-balance"],
    ["accountant", accountant, `/invoices/${invoice.id}`],
    ["accountant", accountant, "/payments?pageSize=25"],
    ["accountant", accountant, `/payments/${payment.id}`],
    ["accountant", accountant, "/fees/defaulters"],
    ["admin", admin, "/messages?pageSize=20"],
    ["admin", admin, "/audit-log?pageSize=30"],
    ["admin", admin, "/users?pageSize=25"],
    ["admin", admin, "/promotions/preview"],
    ["parent", parent, "/portal/children"],
  ];

  const rows: { who: string; path: string; p50: number; p95: number; max: number }[] = [];
  for (const [who, user, path] of calls) {
    for (let i = 0; i < 3; i++) await user.get(path);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      await user.get(path);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    rows.push({ who, path: shortPath(path), p50: percentile(times, 50), p95: percentile(times, 95), max: times.at(-1)! });
  }

  const width = Math.max(...rows.map((r) => r.path.length)) + 2;
  console.log(`${"call".padEnd(width + 11)}${"p50".padStart(8)}${"p95".padStart(8)}${"max".padStart(8)}`);
  for (const r of rows) {
    const flag = r.p95 > BUDGET_MS ? "  ✗ over budget" : "";
    console.log(`${r.who.padEnd(11)}${r.path.padEnd(width)}${r.p50.toFixed(0).padStart(8)}${r.p95.toFixed(0).padStart(8)}${r.max.toFixed(0).padStart(8)}${flag}`);
  }
  const over = rows.filter((r) => r.p95 > BUDGET_MS);
  console.log(over.length ? `\n${over.length} call(s) over the ${BUDGET_MS} ms budget.` : `\nEvery call is within the ${BUDGET_MS} ms budget.`);

  // A rush: several staff and parents clicking without pause, each going through every call above in its own order.
  const tabs = Array.from({ length: CONCURRENCY }, (_, i) => ({ i, calls: calls.map(([who, user, path]) => [who, user.tab(), path] as const) }));
  const all: { path: string; ms: number }[] = [];
  const started = performance.now();
  await Promise.all(
    tabs.map(async ({ i, calls: mine }) => {
      for (let k = 0; k < mine.length; k++) {
        const [, user, path] = mine[(k + i * 7) % mine.length]!;
        const t = performance.now();
        await user.get(path);
        all.push({ path, ms: performance.now() - t });
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  const times = all.map((x) => x.ms).sort((a, b) => a - b);
  const slowest = [...all]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)
    .map((x) => `${shortPath(x.path)} ${x.ms.toFixed(0)} ms`);
  console.log(
    `\n${CONCURRENCY} users clicking without pause: ${all.length} requests in ${elapsed.toFixed(1)} s (${(all.length / elapsed).toFixed(0)}/s), ` +
      `p50 ${percentile(times, 50).toFixed(0)} ms, p95 ${percentile(times, 95).toFixed(0)} ms. Slowest: ${slowest.join(", ")}.`,
  );
  for (const t of tabs) for (const [, user] of t.calls) user.close();

  for (const user of [admin, teacher, accountant, parent]) user.close();
  api.stop();
  if (over.length && args.has("--strict")) process.exitCode = 1;
}

(process.env.PERF_ROLE === "api" ? serve() : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
