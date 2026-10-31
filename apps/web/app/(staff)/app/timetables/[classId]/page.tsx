"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/shared/states";
import { ResponsiveTimetable } from "@/components/timetable/timetable-board";
import { TimetableBuilder } from "@/components/timetable/timetable-builder";
import { useClasses, useClassTimetable } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";

export default function ClassTimetablePage({ params }: PageProps<"/app/timetables/[classId]">) {
  const { classId } = use(params);
  const t = useTranslations("academics.timetables");
  const can = useCan();
  const editable = can("timetable.edit");
  const { data, error, refetch, isPending } = useClassTimetable(classId, editable ? "draft" : "published");
  const classes = useClasses();
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader
        back={{ href: "/app/timetables", label: t("title") }}
        title={t("classTitle", { name: data.className })}
        description={t("classDescription")}
        actions={
          !editable &&
          data.blocks.length > 0 && (
            <Button variant="outline" className="no-print" onClick={() => window.print()}>
              <Printer /> {t("print")}
            </Button>
          )
        }
      />
      {editable ? (
        // One builder per class, so one class's unsaved board can't carry into another.
        <TimetableBuilder key={classId} view={data} classes={classes.data ?? []} />
      ) : data.blocks.length ? (
        <ResponsiveTimetable hours={data.hours} blocks={data.blocks} />
      ) : (
        <EmptyState title={t("notPublished")} />
      )}
    </>
  );
}
