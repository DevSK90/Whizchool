"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { ReportCardView } from "@/components/reports/report-card-view";
import { useReportCard } from "@/lib/api/hooks";

export default function StudentReportCardPage({ params }: PageProps<"/app/report-cards/[examId]/student/[studentId]">) {
  const { examId, studentId } = use(params);
  const t = useTranslations("academics.reportCards.card");
  const { data, error, refetch, isPending } = useReportCard(examId, studentId);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader
        className="no-print"
        back={{ href: `/app/report-cards/${examId}/class/${data.student.classId}`, label: t("back") }}
        title={data.student.fullName}
        description={data.exam.name}
      />
      <ReportCardView card={data} />
    </>
  );
}
