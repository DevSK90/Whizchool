import type { HttpMethod } from "@whizchool/shared/api";
import type { Ctx } from "./helpers";

export interface Route {
  method: HttpMethod;
  /** Express-style path, e.g. "/students/:id" */
  path: string;
  handler: (ctx: Ctx) => unknown;
  /** Reachable without a session (public pages, webhooks) */
  public?: boolean;
}

interface CompiledRoute extends Route {
  regex: RegExp;
  keys: string[];
}

export function compile(routes: Route[]): CompiledRoute[] {
  return routes.map((r) => {
    const keys: string[] = [];
    const pattern = r.path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    return { ...r, keys, regex: new RegExp(`^${pattern}$`) };
  });
}

export function match(routes: CompiledRoute[], method: HttpMethod, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { route: r, params };
  }
  return null;
}
