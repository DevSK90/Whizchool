"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Filters, sorting and pagination live in the URL so views are shareable and survive reloads.
 * Setting any non-page key resets `page` to 1.
 */
export function useUrlState<K extends string>(defaults: Partial<Record<K, string>> = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const get = useCallback((key: K) => searchParams.get(key) ?? defaults[key] ?? "", [searchParams, defaults]);

  const set = useCallback(
    (patch: Partial<Record<K | "page", string | number | undefined | null>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === "" || v === (defaults as Record<string, string>)[k]) next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, defaults],
  );

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  return { get, set, page, searchParams };
}
