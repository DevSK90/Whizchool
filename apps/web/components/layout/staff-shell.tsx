"use client";

import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { PageSkeleton } from "@/components/shared/states";
import { API_MODE } from "@/lib/api/client";
import { AreaGate } from "@/lib/auth";
import { AppSidebar } from "./app-sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function DemoBadge() {
  const t = useTranslations("common.demo");
  if (API_MODE !== "mock") return null;
  return (
    <span className="hidden items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning-foreground lg:inline-flex dark:text-warning">
      <FlaskConical className="size-3.5" />
      {t("banner")}
    </span>
  );
}

/** The sidebar saves its open/collapsed state in a cookie; read it back so the choice survives reloads. */
function readSidebarCookie() {
  if (typeof document === "undefined") return true;
  return !document.cookie.split("; ").includes("sidebar_state=false");
}

export function StaffShellSkeleton() {
  return (
    <div className="flex min-h-svh">
      <div className="hidden w-64 shrink-0 border-r bg-sidebar p-3 md:block">
        <Skeleton className="mb-6 h-10 w-full" />
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="mb-2 h-7 w-full" />
        ))}
      </div>
      <div className="flex-1">
        <div className="h-14 border-b" />
        <div className="mx-auto max-w-7xl p-4 md:p-6">
          <PageSkeleton />
        </div>
      </div>
    </div>
  );
}

export function StaffShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  return (
    <AreaGate area="staff" fallback={<StaffShellSkeleton />}>
      <SidebarProvider defaultOpen={readSidebarCookie()}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
          {t("skipToContent")}
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="no-print sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-4">
            <SidebarTrigger aria-label={t("toggleSidebar")} />
            <Separator orientation="vertical" className="mx-1 data-vertical:h-5 data-vertical:self-center" />
            <div className="flex-1" />
            <DemoBadge />
            <ThemeToggle />
            <UserMenu profileHref="/app/profile" />
          </header>
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AreaGate>
  );
}
