"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { ReportCardView } from "@/components/reports/report-card-view";
import { useReportCardBatch } from "@/lib/api/hooks";

/** Every report card of a class, one per printed page. */
export default function ClassReportCardsPrintPage({ params }: PageProps<"/app/report-cards/[examId]/class/[classId]/print">) {
  const { examId, classId } = use(params);
  const t = useTranslations("academics.reportCards.batch");
  const { data, error, refetch, isPending } = useReportCardBatch(examId, classId);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const first = data[0];
  return (
    <>
      <PageHeader
        className="no-print"
        back={{ href: `/app/report-cards/${examId}/class/${classId}`, label: t("back") }}
        title={first ? t("title", { className: first.student.className, exam: first.exam.name }) : ""}
        description={t("description", { count: data.length })}
        actions={
          <Button onClick={() => window.print()}>
            <Printer /> {t("print")}
          </Button>
        }
      />
      <div className="space-y-8 print:space-y-0">
        {data.map((card) => (
          <div key={card.student.id} className="break-after-page last:break-after-auto">
            <ReportCardView card={card} showPrintButton={false} />
          </div>
        ))}
      </div>
    </>
  );
}
