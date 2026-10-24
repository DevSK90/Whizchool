import { z } from "zod";
import type { Paginated } from "@whizchool/shared/types";

/** Out-of-range paging values are clamped rather than rejected, as the web app's tables expect. */
const clamp = (fallback: number, min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
    });

/** Query params shared by every paginated list: page, pageSize, search, sort ("name" or "-name"). */
export const listQuery = z.object({
  page: clamp(1, 1, 100_000),
  pageSize: clamp(20, 5, 100),
  search: z.string().trim().max(100).optional().transform((s) => s || undefined),
  sort: z.string().max(50).optional(),
});

export type ListQuery = z.infer<typeof listQuery>;

export const skipTake = (q: ListQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

export const page = <T>(items: T[], total: number, q: ListQuery): Paginated<T> => ({ items, total, page: q.page, pageSize: q.pageSize });

/** "-lastLoginAt" → { field: "lastLoginAt", dir: "desc" }, limited to the allowed fields. */
export function parseSort<F extends string>(sort: string | undefined, allowed: readonly F[], fallback: F) {
  const desc = sort?.startsWith("-") ?? false;
  const field = (desc ? sort!.slice(1) : sort) as F;
  return { field: allowed.includes(field) ? field : fallback, dir: desc ? ("desc" as const) : ("asc" as const) };
}

/** Prisma returns null for empty optional columns; the API contract leaves such fields out. */
export function omitNulls<T extends object>(row: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as { [K in keyof T]: Exclude<T[K], null> };
}
