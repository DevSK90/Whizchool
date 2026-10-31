"use client";

import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/shared/states";
import { ResponsiveTimetable } from "@/components/timetable/timetable-board";
import { useMyTimetable } from "@/lib/api/hooks";

export default function MyTimetablePage() {
  const t = useTranslations("academics.timetables");
  const { data, error, refetch, isPending } = useMyTimetable();
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader
        title={t("mine")}
        description={data.staffName}
        actions={
          data.blocks.length > 0 && (
            <Button variant="outline" className="no-print" onClick={() => window.print()}>
              <Printer /> {t("print")}
            </Button>
          )
        }
      />
      {data.blocks.length ? <ResponsiveTimetable hours={data.hours} blocks={data.blocks} /> : <EmptyState title={t("mineEmpty")} description={t("mineEmptyHint")} />}
    </>
  );
}
