"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { LogoMark } from "@/components/brand/logo";
import { useApplicationCounts, useSchool } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";
import { STAFF_NAV, activeHref } from "./nav-config";

export function AppSidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const can = useCan();
  const { data: school } = useSchool();
  const { setOpenMobile } = useSidebar();
  const counts = useApplicationCounts(can("admissions.view"));
  const active = activeHref(pathname);
  const newApplications = counts.data?.new;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Whizchool">
              <Link href="/app">
                <LogoMark className="size-8! shrink-0" />
                <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="text-sm font-semibold">Whizchool</span>
                  <span className="truncate text-xs text-muted-foreground">{school?.name ?? " "}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="group-data-[collapsible=icon]:overflow-y-auto">
        {STAFF_NAV.map((group) => {
          const items = group.items.filter((i) => can(i.perm));
          if (!items.length) return null;
          return (
            <SidebarGroup key={group.key ?? "main"}>
              {group.key && <SidebarGroupLabel>{t(`groups.${group.key}`)}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={active === item.href} tooltip={t(item.key)}>
                        <Link href={item.href} onClick={() => setOpenMobile(false)}>
                          <item.icon />
                          <span>{t(item.key)}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.key === "admissions" && !!newApplications && (
                        <>
                          <SidebarMenuBadge>{newApplications}</SidebarMenuBadge>
                          <span aria-hidden className="pointer-events-none absolute top-1 right-1 hidden size-2 rounded-full bg-primary ring-2 ring-sidebar group-data-[collapsible=icon]:block" />
                        </>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="px-4 pb-3 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
        v1.0 · {school?.shortName}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
