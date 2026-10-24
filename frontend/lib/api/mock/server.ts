// In-browser mock of the Express API. Data is regenerated from a deterministic seed on load, and
// successful writes are kept in a small localStorage journal that is replayed, so changes survive reloads.
import { ApiError, type HttpMethod, type RequestOptions } from "../client";
import type { DB } from "./db";
import { buildSession, type Ctx } from "./helpers";
import { compile, match } from "./router";
import { createSeed } from "./seed";
import { authRoutes } from "./handlers/auth";
import { schoolRoutes } from "./handlers/school";
import { studentRoutes } from "./handlers/students";
import { admissionRoutes } from "./handlers/admissions";
import { attendanceRoutes } from "./handlers/attendance";
import { examRoutes } from "./handlers/exams";
import { feeRoutes } from "./handlers/fees";
import { commsRoutes } from "./handlers/comms";
import { adminRoutes } from "./handlers/admin";
import { dashboardRoutes } from "./handlers/dashboard";

const routes = compile([
  ...authRoutes,
  ...schoolRoutes,
  ...studentRoutes,
  ...admissionRoutes,
  ...attendanceRoutes,
  ...examRoutes,
  ...feeRoutes,
  ...commsRoutes,
  ...adminRoutes,
  ...dashboardRoutes,
]);

const JOURNAL_KEY = "wz_mock_journal_v1";
const SESSION_KEY = "wz_mock_session";
export const SESSION_COOKIE = "wz_sid";
const NOT_JOURNALED = new Set(["/auth/login", "/auth/logout"]);

interface JournalEntry {
  method: HttpMethod;
  path: string;
  body: unknown;
  now: string;
  userId: string | null;
}

let db: DB | null = null;

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJournal(): JournalEntry[] {
  try {
    return JSON.parse(storage()?.getItem(JOURNAL_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeJournal(entries: JournalEntry[]) {
  try {
    storage()?.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    // storage full or blocked — changes stay in memory for this session
  }
}

function sessionUserId() {
  try {
    return storage()?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

function setSession(userId: string | null) {
  try {
    if (userId) storage()?.setItem(SESSION_KEY, userId);
    else storage()?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  // Presence cookie for the Next.js proxy's redirect check (the real API sets an httpOnly session cookie).
  document.cookie = userId
    ? `${SESSION_COOKIE}=mock-${userId}; path=/; max-age=${60 * 60 * 12}; samesite=lax`
    : `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

function execute(database: DB, method: HttpMethod, path: string, query: Record<string, string>, body: unknown, now: Date, userId: string | null) {
  const found = match(routes, method, path);
  if (!found) throw new ApiError(404, "not_found", `No mock route for ${method} ${path}`);
  const user = userId ? database.users.get(userId) ?? null : null;
  const activeUser = user && user.status === "active" ? user : null;
  const ctx: Ctx = {
    db: database,
    params: found.params,
    query,
    body,
    now,
    user: activeUser,
    session: activeUser ? buildSession(database, activeUser) : null,
  };
  return found.route.handler(ctx);
}

function getDb() {
  if (db) return db;
  db = createSeed();
  for (const e of readJournal()) {
    try {
      execute(db, e.method, e.path, {}, e.body, new Date(e.now), e.userId);
    } catch {
      // an entry that no longer applies is skipped
    }
  }
  return db;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockRequest<T>(method: HttpMethod, path: string, opts: RequestOptions): Promise<T> {
  await delay(method === "GET" ? 120 + Math.random() * 250 : 250 + Math.random() * 350);
  const database = getDb();
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") query[k] = String(v);
  const now = new Date();
  const userId = sessionUserId();
  const result = execute(database, method, path, query, opts.body, now, userId);

  if (path === "/auth/login" || path.endsWith("/accept")) setSession((result as { id: string }).id);
  if (path === "/auth/logout") setSession(null);
  if (method !== "GET" && !NOT_JOURNALED.has(path)) {
    writeJournal([...readJournal(), { method, path, body: opts.body ?? null, now: now.toISOString(), userId }]);
  }
  // Return a copy so UI code can never mutate the store directly.
  return (result === undefined ? undefined : structuredClone(result)) as T;
}

/** Clears demo changes and the session, then reloads the page with fresh seed data. */
export function resetMockData() {
  try {
    storage()?.removeItem(JOURNAL_KEY);
  } catch {
    // ignore
  }
  setSession(null);
  db = null;
}

export function mockSessionCookieCleared() {
  setSession(null);
}
