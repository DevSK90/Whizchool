// Typed REST client for the Whizchool API.
// NEXT_PUBLIC_API_MODE=http talks to Express at /api/v1 (same origin, session cookie);
// anything else uses the in-browser mock backend so the UI can be built before the API exists.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_MODE = process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1";

function buildQuery(query?: QueryParams) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function httpRequest<T>(method: HttpMethod, path: string, opts: RequestOptions): Promise<T> {
  const res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, {
    method,
    credentials: "include",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? res.statusText, err?.fields);
  }
  return data as T;
}

async function request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
  if (API_MODE === "http") return httpRequest<T>(method, path, opts);
  const { mockRequest } = await import("./mock/server");
  return mockRequest<T>(method, path, opts);
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    request<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
