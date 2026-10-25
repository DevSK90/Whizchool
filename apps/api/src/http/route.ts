import type { Request, Response, Router } from "express";
import type { z } from "zod";
import { ApiError, type HttpMethod } from "@whizchool/shared/api";
import type { PermissionKey } from "@whizchool/shared/permissions";
import type { SessionUser } from "@whizchool/shared/types";
import type { AuthContext } from "../auth/context";
import { config } from "../config";
import { validationError } from "./errors";
import { idempotent } from "./idempotency";
import { checkRateLimit, type RateLimitRule } from "./rate-limit";

/** Who may call a route. Checked before input validation and the handler. */
export type Access = "public" | "session" | { permission: PermissionKey };

export interface RouteContext<Q, B> {
  req: Request;
  res: Response;
  params: Record<string, string>;
  query: Q;
  body: B;
  /** The caller's identity, permissions and data scope; null on public routes called anonymously. */
  auth: AuthContext | null;
  /** Shorthand for `auth.session`: what /auth/me returns. */
  session: SessionUser | null;
}

/** Context for routes that require a session: `auth` is guaranteed. */
export type AuthedContext<Q, B> = RouteContext<Q, B> & { auth: AuthContext; session: SessionUser };

interface RouteBase<Q, B> {
  method: HttpMethod;
  /** Express path relative to /api/v1, e.g. "/students/:id". */
  path: string;
  /** One line for docs and the generated access-matrix tests. */
  summary: string;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  /**
   * Bodies are JSON unless a route opts out: uploads are multipart and the PayHere webhook
   * is form-encoded. Requiring JSON elsewhere means a plain cross-site HTML form can't hit us.
   */
  bodyType?: "json" | "multipart" | "form";
  /** Honour the Idempotency-Key header: a retried request returns the first result instead of repeating the work. */
  idempotent?: boolean;
  /** Checked before the handler, after the body is parsed (so limits can key on e.g. the email). */
  rateLimit?: RateLimitRule[];
  /** HTTP status on success (default 200; 204 when the handler returns nothing). */
  status?: number;
}

type PublicRoute<Q, B> = RouteBase<Q, B> & { access: "public"; handler: (ctx: RouteContext<Q, B>) => unknown };
type AuthedRoute<Q, B> = RouteBase<Q, B> & { access: Exclude<Access, "public">; handler: (ctx: AuthedContext<Q, B>) => unknown };

export type RouteDef<Q = unknown, B = unknown> = PublicRoute<Q, B> | AuthedRoute<Q, B>;

/**
 * Identity function that lets TypeScript infer query/body types from the Zod schemas.
 * Separate overloads (not one union) keep that inference working for handler parameters.
 */
export function defineRoute<Q = undefined, B = undefined>(def: PublicRoute<Q, B>): RouteDef<Q, B>;
export function defineRoute<Q = undefined, B = undefined>(def: AuthedRoute<Q, B>): RouteDef<Q, B>;
export function defineRoute<Q, B>(def: RouteDef<Q, B>): RouteDef<Q, B> {
  return def;
}

/** Set by the session middleware; null when signed out. */
export function currentAuth(res: Response): AuthContext | null {
  return (res.locals.auth as AuthContext | undefined) ?? null;
}

function authorize(access: Access, auth: AuthContext | null) {
  if (access === "public") return;
  if (!auth) throw new ApiError(401, "unauthenticated", "Your session has expired. Please sign in again.");
  if (access !== "session" && !auth.session.permissions.includes(access.permission)) {
    throw new ApiError(403, "forbidden", "You don't have permission to do that.");
  }
}

function parse<T>(schema: z.ZodType<T> | undefined, value: unknown): T {
  if (!schema) return undefined as T;
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

const UNSAFE = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);

/** True when the request carries a non-empty body (`req.is` treats Content-Length: 0 as a body). */
function hasBody(req: Request) {
  return req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) > 0;
}

export function mountRoutes(router: Router, routes: RouteDef<any, any>[]) {
  for (const route of routes) {
    const method = route.method.toLowerCase() as Lowercase<HttpMethod>;
    router[method](route.path, async (req, res) => {
      const auth = currentAuth(res);
      authorize(route.access, auth);
      if (UNSAFE.has(route.method) && (route.bodyType ?? "json") === "json" && hasBody(req) && !req.is("application/json")) {
        throw new ApiError(415, "unsupported_media_type", "Send the request body as JSON.");
      }
      if (config.RATE_LIMITS) for (const rule of route.rateLimit ?? []) checkRateLimit(rule, req);
      const ctx = {
        req,
        res,
        params: req.params as Record<string, string>,
        query: parse(route.query, req.query),
        body: parse(route.body, req.body ?? {}),
        auth,
        session: auth?.session ?? null,
      };
      // `authorize` guarantees `auth` for non-public routes.
      const run = async () => (route.handler as (c: typeof ctx) => unknown)(ctx);
      const result = route.idempotent ? await idempotent(req, res, auth?.session.id ?? `ip:${req.ip}`, req.body, run) : await run();
      if (res.headersSent) return;
      if (result === undefined) res.status(route.status ?? 204).end();
      else res.status(route.status ?? 200).json(result);
    });
  }
}
