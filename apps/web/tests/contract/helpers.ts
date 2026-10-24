// The acceptance suite for the /api/v1 contract. By default it drives the in-browser demo API;
// `npm run test:contract:api` runs the same tests over HTTP against the real API, which must pass them.
import { expect } from "vitest";
import { ApiError, SESSION_COOKIE, type HttpMethod, type QueryParams } from "@whizchool/shared/api";
import { mockRequest, resetMockData } from "@whizchool/demo";

export const PASSWORD = "demo1234";

const TARGET = process.env.CONTRACT_TARGET === "http" ? "http" : "demo";
const API_URL = (process.env.CONTRACT_API_URL ?? "http://localhost:4000/api/v1").replace(/\/+$/, "");
// Sent as Origin so the API's CSRF check treats us like the web app.
const APP_ORIGIN = process.env.CONTRACT_APP_ORIGIN ?? "http://localhost:3000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- contract tests poke at loosely-typed JSON
export type Json = any;

/** The HTTP transport's cookie jar: just the session cookie. */
let sessionCookie = "";

async function httpCall(method: HttpMethod, path: string, body?: unknown, query?: QueryParams, idempotencyKey?: string): Promise<Json> {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Origin: APP_ORIGIN,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(sessionCookie ? { Cookie: `${SESSION_COOKIE}=${sessionCookie}` } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const [name, value = ""] = pair.split("=");
    if (name.trim() === SESSION_COOKIE) sessionCookie = /max-age=0/i.test(header) ? "" : value;
  }
  if (res.status === 204) return undefined;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "unknown", data?.error?.message ?? res.statusText, data?.error?.fields);
  return data;
}

export function call(method: HttpMethod, path: string, body?: unknown, query?: QueryParams, idempotencyKey?: string): Promise<Json> {
  if (TARGET === "http") return httpCall(method, path, body, query, idempotencyKey);
  return mockRequest<Json>(method, path, { body, query, idempotencyKey });
}

export const get = (path: string, query?: QueryParams) => call("GET", path, undefined, query);

/** Restores the demo school. Over HTTP this uses the API's test-only reset route (enabled in test mode). */
export async function resetData() {
  if (TARGET === "http") {
    sessionCookie = "";
    await httpCall("POST", "/test/reset");
  } else {
    resetMockData();
  }
}

/** Asserts the request fails with the given HTTP status and returns the error. */
export async function expectStatus(status: number, promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: Json) => e,
  );
  expect(error, "expected the request to fail").not.toBeNull();
  expect(error.status).toBe(status);
  return error;
}

export const login = (who: "admin" | "principal" | "teacher" | "accountant" | "parent", password = PASSWORD) =>
  call("POST", "/auth/login", { email: `${who}@whizchool.lk`, password });

export const logout = () => call("POST", "/auth/logout");
