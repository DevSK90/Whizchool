"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarCheck, ChevronRight, GraduationCap, Pin, Wallet } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardsSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { useNotices, usePortalChildren } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth";
import { formatDate, formatMoney, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function PortalHomePage() {
  const t = useTranslations("portal.home");
  const user = useSession();
  const children = usePortalChildren();
  const notices = useNotices();
  const first = user?.name.replace(/^(Mr|Mrs|Ms|Dr)\.\s*/, "").split(" ")[0] ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("greeting", { name: first })}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {children.isPending ? (
        <CardsSkeleton count={2} className="md:grid-cols-2" />
      ) : children.error ? (
        <ErrorState error={children.error} onRetry={children.refetch} />
      ) : children.data.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t("noChildren")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {children.data.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="size-11">
                    <AvatarFallback className="bg-primary/10 font-medium text-primary">{initials(c.fullName)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle>{c.fullName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {c.className} · {c.admissionNo}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Metric icon={CalendarCheck} label={t("attendance")} value={`${c.attendanceRate.toFixed(0)}%`} />
                  <Metric
                    icon={GraduationCap}
                    label={t("latest")}
                    value={c.latestAverage !== undefined ? c.latestAverage.toFixed(1) : "—"}
                    hint={c.latestRank && c.classSize ? t("rank", { rank: c.latestRank, size: c.classSize }) : undefined}
                  />
                  <Metric
                    icon={Wallet}
                    label={t("balance")}
                    value={c.balance > 0 ? formatMoney(c.balance) : t("allPaid")}
                    hint={c.overdue > 0 ? t("overdue", { amount: formatMoney(c.overdue) }) : undefined}
                    danger={c.overdue > 0}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" asChild>
                    <Link href={`/portal/children/${c.id}`}>
                      {t("view")} <ChevronRight />
                    </Link>
                  </Button>
                  {c.balance > 0 && (
                    <Button className="flex-1" asChild>
                      <Link href={`/portal/children/${c.id}?tab=fees`}>
                        <Wallet /> {t("pay")}
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("notices")}</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/notices">{t("allNotices")}</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {notices.data?.slice(0, 3).map((n) => (
              <li key={n.id} className="py-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {n.pinned && <Pin className="size-3.5 text-primary" />}
                  {n.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.publishedAt)}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value, hint, danger }: { icon: typeof Wallet; label: string; value: string; hint?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-3">
      <Icon className="mx-auto size-4 text-muted-foreground" aria-hidden />
      <p className="mt-1 truncate text-sm font-semibold tabular">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      {hint && <p className={cn("mt-0.5 truncate text-[11px]", danger ? "font-medium text-destructive" : "text-muted-foreground")}>{hint}</p>}
    </div>
  );
}
