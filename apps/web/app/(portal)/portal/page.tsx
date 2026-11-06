"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import { GraduationCap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChildCard, ComingUp, LatestNotices, NeedsAttention } from "@/components/portal/home";
import { CardsSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { useExams, useNotices, usePortalChildren, useTerms } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth";
import { toISODate } from "@/lib/format";

export default function PortalHomePage() {
  const t = useTranslations("portal.home");
  const user = useSession();
  const children = usePortalChildren();
  const notices = useNotices();
  const terms = useTerms();
  const exams = useExams();
  const [today] = useState(() => toISODate(new Date()));
  const first = user?.name.replace(/^(Mr|Mrs|Ms|Dr)\.\s*/, "").split(" ")[0] ?? "";
  const weekday = parseISO(today).getDay();
  // A weekday in term: the register is taken and there are classes.
  const schoolDay = weekday >= 1 && weekday <= 5 && !!terms.data?.some((x) => x.startDate <= today && today <= x.endDate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("greeting", { name: first })}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <p className="text-sm text-muted-foreground">{format(parseISO(today), "EEEE, d MMMM yyyy")}</p>
      </div>

      {children.isPending ? (
        <CardsSkeleton count={2} className="lg:grid-cols-2" />
      ) : children.error ? (
        <ErrorState error={children.error} onRetry={children.refetch} />
      ) : children.data.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t("noChildren")} />
      ) : (
        <>
          <NeedsAttention items={children.data} today={today} schoolDay={schoolDay} />
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section aria-label={t("children")} className="space-y-6">
              {children.data.map((c) => (
                <ChildCard key={c.id} child={c} today={today} schoolDay={schoolDay} />
              ))}
            </section>
            <aside className="space-y-6">
              {terms.data && exams.data ? <ComingUp terms={terms.data} exams={exams.data} kids={children.data} today={today} /> : <Skeleton className="h-40 w-full rounded-xl" />}
              <LatestNotices notices={notices.data} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
