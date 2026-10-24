import type { RequestHandler } from "express";
import { ApiError } from "@whizchool/shared/api";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated requests: a state-changing request from a browser
 * must come from one of our own origins. Server-to-server callers (the PayHere webhook,
 * curl) send neither Origin nor Sec-Fetch-Site and are judged by their own checks.
 */
export function originCheck(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin !== undefined) {
      if (allowed.has(origin)) return next();
      throw new ApiError(403, "bad_origin", "This request came from another site and was blocked.");
    }
    const site = req.get("sec-fetch-site");
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      throw new ApiError(403, "bad_origin", "This request came from another site and was blocked.");
    }
    next();
  };
}
