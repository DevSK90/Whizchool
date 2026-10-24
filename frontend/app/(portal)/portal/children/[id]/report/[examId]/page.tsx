"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { ReportCardView } from "@/components/reports/report-card-view";
import { useReportCard } from "@/lib/api/hooks";

export default function PortalReportCardPage({ params }: PageProps<"/portal/children/[id]/report/[examId]">) {
  const { id, examId } = use(params);
  const t = useTranslations("portal.report");
  const { data, error, refetch, isPending } = useReportCard(examId, id);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader className="no-print" back={{ href: `/portal/children/${id}?tab=results`, label: t("back") }} title={data.exam.name} description={data.student.fullName} />
      <ReportCardView card={data} />
    </>
  );
}
