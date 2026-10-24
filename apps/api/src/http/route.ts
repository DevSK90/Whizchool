import type { Request, Response, Router } from "express";
import type { z } from "zod";
import { ApiError, type HttpMethod } from "@whizchool/shared/api";
import type { PermissionKey } from "@whizchool/shared/permissions";
import type { SessionUser } from "@whizchool/shared/types";
import { validationError } from "./errors";

/** Who may call a route. Checked before input validation and the handler. */
export type Access = "public" | "session" | { permission: PermissionKey };

export interface RouteContext<Q, B> {
  req: Request;
  res: Response;
  params: Record<string, string>;
  query: Q;
  body: B;
  /** The signed-in user, or null on public routes called anonymously. */
  session: SessionUser | null;
}

export interface RouteDef<Q = unknown, B = unknown> {
  method: HttpMethod;
  /** Express path relative to /api/v1, e.g. "/students/:id". */
  path: string;
  access: Access;
  /** One line for docs and the generated access-matrix tests. */
  summary: string;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  /**
   * Bodies are JSON unless a route opts out: uploads are multipart and the PayHere webhook
   * is form-encoded. Requiring JSON elsewhere means a plain cross-site HTML form can't hit us.
   */
  bodyType?: "json" | "multipart" | "form";
  /** HTTP status on success (default 200; 204 when the handler returns nothing). */
  status?: number;
  handler: (ctx: RouteContext<Q, B>) => unknown;
}

/** Identity function that lets TypeScript infer query/body types from the Zod schemas. */
export function defineRoute<Q = undefined, B = undefined>(def: RouteDef<Q, B>): RouteDef<Q, B> {
  return def;
}

/** Set by the session middleware (Phase 1); null until then or when signed out. */
export function currentSession(res: Response): SessionUser | null {
  return (res.locals.session as SessionUser | undefined) ?? null;
}

function authorize(access: Access, session: SessionUser | null) {
  if (access === "public") return;
  if (!session) throw new ApiError(401, "unauthenticated", "Please sign in to continue.");
  if (access !== "session" && !session.permissions.includes(access.permission)) {
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
      const session = currentSession(res);
      authorize(route.access, session);
      if (UNSAFE.has(route.method) && (route.bodyType ?? "json") === "json" && hasBody(req) && !req.is("application/json")) {
        throw new ApiError(415, "unsupported_media_type", "Send the request body as JSON.");
      }
      const result = await route.handler({
        req,
        res,
        params: req.params as Record<string, string>,
        query: parse(route.query, req.query),
        body: parse(route.body, req.body ?? {}),
        session,
      });
      if (res.headersSent) return;
      if (result === undefined) res.status(route.status ?? 204).end();
      else res.status(route.status ?? 200).json(result);
    });
  }
}
