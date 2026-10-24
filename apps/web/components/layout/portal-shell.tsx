"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Home, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { CardsSkeleton } from "@/components/shared/states";
import { useSchool } from "@/lib/api/hooks";
import { AreaGate } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { DemoBadge } from "./staff-shell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

const TABS = [
  { href: "/portal", key: "home", icon: Home },
  { href: "/portal/notices", key: "notices", icon: Bell },
  { href: "/portal/profile", key: "profile", icon: UserRound },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/portal" ? pathname === "/portal" || pathname.startsWith("/portal/children") || pathname.startsWith("/portal/pay") || pathname.startsWith("/portal/receipts") : pathname.startsWith(href);
}

export function PortalShellSkeleton() {
  return (
    <div className="min-h-svh">
      <div className="h-14 border-b" />
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <CardsSkeleton count={2} />
      </div>
    </div>
  );
}

function PortalHeaderNav() {
  const t = useTranslations("nav.portal");
  const tc = useTranslations("common");
  const pathname = usePathname();
  return (
    <>
      <nav className="hidden items-center gap-1 md:flex" aria-label={tc("a11y.portalNav")}>
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
              isActive(pathname, tab.href) && "bg-accent text-accent-foreground",
            )}
          >
            {t(tab.key)}
          </Link>
        ))}
      </nav>
    </>
  );
}

/** Mobile bottom tab bar — must live outside the blurred header (backdrop-filter creates a containing block for fixed elements). */
function PortalTabBar() {
  const t = useTranslations("nav.portal");
  const tc = useTranslations("common");
  const pathname = usePathname();
  return (
    <>
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label={tc("a11y.portalNav")}
      >
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground", active && "text-primary")}
            >
              <tab.icon className="size-5" />
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  const { data: school } = useSchool();
  return (
    <AreaGate area="parent" fallback={<PortalShellSkeleton />}>
      <div className="min-h-svh bg-background">
        <header className="no-print sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <Link href="/portal" className="min-w-0">
              <Logo subtitle={school?.name} />
            </Link>
            <div className="flex-1" />
            <PortalHeaderNav />
            <DemoBadge />
            <ThemeToggle />
            <UserMenu profileHref="/portal/profile" />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pt-5 pb-24 md:pb-10">
          {children}
        </main>
        <PortalTabBar />
      </div>
    </AreaGate>
  );
}
