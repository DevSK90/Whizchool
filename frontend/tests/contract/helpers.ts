// Drives the in-browser mock API directly. It mirrors the planned Express /api/v1 contract,
// so these tests double as the acceptance suite the real API must pass.
import { expect } from "vitest";
import type { HttpMethod, QueryParams } from "@/lib/api/client";
import { mockRequest, resetMockData } from "@/lib/api/mock/server";

export const PASSWORD = "demo1234";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- contract tests poke at loosely-typed JSON
export type Json = any;

export function call(method: HttpMethod, path: string, body?: unknown, query?: QueryParams, idempotencyKey?: string): Promise<Json> {
  return mockRequest<Json>(method, path, { body, query, idempotencyKey });
}

export const get = (path: string, query?: QueryParams) => call("GET", path, undefined, query);

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

export { resetMockData };
