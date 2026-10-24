"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/client";
import { useMe } from "@/lib/api/hooks";
import type { SessionUser } from "@whizchool/shared/types";
import type { PermissionKey } from "@whizchool/shared/permissions";

export function homeFor(user: Pick<SessionUser, "kind">) {
  return user.kind === "parent" ? "/portal" : "/app";
}

/** Only allow same-site relative redirects after sign-in. */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export function useSession() {
  const { data } = useMe();
  return data ?? null;
}

export function useCan() {
  const user = useSession();
  return (key: PermissionKey) => !!user?.permissions.includes(key);
}

export function Can({ perm, children, fallback = null }: { perm: PermissionKey; children: ReactNode; fallback?: ReactNode }) {
  const can = useCan();
  return <>{can(perm) ? children : fallback}</>;
}

const subscribe = () => () => {};
/** False during server prerender and hydration, true once running in the browser. */
export function useIsClient() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/**
 * Client-side gate for authenticated areas. Renders the fallback until the session is known,
 * redirects to sign-in on 401 and to the right home when a user opens the wrong area.
 */
export function AreaGate({ area, fallback, children }: { area: "staff" | "parent"; fallback: ReactNode; children: ReactNode }) {
  const isClient = useIsClient();
  const router = useRouter();
  const pathname = usePathname();
  const { data: user, error, isPending } = useMe();
  const unauthenticated = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}&expired=1`);
    else if (user && user.kind !== area) router.replace(homeFor(user));
  }, [unauthenticated, user, area, router, pathname]);

  if (!isClient || isPending || !user || user.kind !== area) {
    if (error && !unauthenticated) throw error;
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

export function useSignOut() {
  const router = useRouter();
  const qc = useQueryClient();
  return async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      qc.clear();
      router.replace("/login");
    }
  };
}
