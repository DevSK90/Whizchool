import type { Request } from "express";
import { ApiError } from "@whizchool/shared/api";

export interface RateLimitRule {
  /** Groups counters, e.g. "login". */
  name: string;
  windowMs: number;
  max: number;
  /** What one counter tracks; defaults to the client IP. */
  key?: (req: Request) => string;
}

// Fixed-window counters in memory: enough for one API process (PLAN.md runs a single VPS).
const windows = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(rule: RateLimitRule, req: Request) {
  const now = Date.now();
  const id = `${rule.name}:${rule.key ? rule.key(req) : req.ip}`;
  let w = windows.get(id);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + rule.windowMs };
    windows.set(id, w);
  }
  w.count++;
  if (w.count > rule.max) {
    const retryAfter = Math.ceil((w.resetAt - now) / 1000);
    throw Object.assign(new ApiError(429, "too_many_requests", "Too many attempts. Please wait a few minutes and try again."), { retryAfter });
  }
  if (windows.size > 50_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
}

/** Test support: forget all counters. */
export function resetRateLimits() {
  windows.clear();
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const emailOf = (req: Request) => String(req.body?.email ?? "").trim().toLowerCase();

export const limits = {
  /** Guessing one account's password, and spraying many accounts from one address. */
  login: [
    { name: "login-account", windowMs: FIFTEEN_MINUTES, max: 10, key: (req: Request) => `${req.ip}|${emailOf(req)}` },
    { name: "login-ip", windowMs: FIFTEEN_MINUTES, max: 50 },
  ],
  passwordEmail: [{ name: "password-email", windowMs: FIFTEEN_MINUTES, max: 5 }],
  tokenUse: [{ name: "token-use", windowMs: FIFTEEN_MINUTES, max: 20 }],
  /** The public admission form: uploads, submissions and status lookups by visitors. */
  publicUpload: [{ name: "public-upload", windowMs: FIFTEEN_MINUTES, max: 20 }],
  apply: [{ name: "apply", windowMs: FIFTEEN_MINUTES, max: 5 }],
  statusLookup: [{ name: "status-lookup", windowMs: FIFTEEN_MINUTES, max: 30 }],
} satisfies Record<string, RateLimitRule[]>;
