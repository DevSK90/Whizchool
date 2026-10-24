import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { logger } from "../logger";

/** Turns Zod issues into the `{ "student.firstName": "Required" }` map the web forms expect. */
export function validationError(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return new ApiError(422, "validation", "Please fix the highlighted fields.", fields);
}

export const notFound: RequestHandler = (req) => {
  throw new ApiError(404, "not_found", `No route for ${req.method} ${req.originalUrl.split("?")[0]}`);
};

/** Every error leaves as `{ error: { code, message, fields? } }`; unexpected ones are logged, not leaked. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let error: ApiError;
  if (err instanceof ApiError) error = err;
  else if (err instanceof z.ZodError) error = validationError(err);
  else if (err?.type === "entity.parse.failed") error = new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  else if (err?.type === "entity.too.large") error = new ApiError(413, "too_large", "The request body is too large.");
  else {
    (req.log ?? logger).error({ err }, "unhandled error");
    error = new ApiError(500, "internal", "Something went wrong. Please try again.");
  }
  if (res.headersSent) return;
  const retryAfter = (err as { retryAfter?: number }).retryAfter;
  if (retryAfter) res.set("Retry-After", String(retryAfter));
  res.status(error.status).json(error.toBody());
};
