"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useExams, useReportCardOverview } from "@/lib/api/hooks";
import type { ReportCardStatus } from "@whizchool/shared/types";
import { useUrlState } from "@/hooks/use-url-state";

const ORDER: ReportCardStatus[] = ["pending_marks", "draft", "approved", "released"];

export default function ReportCardsPage() {
  const t = useTranslations("academics.reportCards");
  const router = useRouter();
  const url = useUrlState<"exam">();
  const exams = useExams();
  const available = exams.data?.filter((e) => e.status !== "scheduled") ?? [];
  const examId = url.get("exam") || available.find((e) => e.status !== "released")?.id || available.at(-1)?.id || "";
  const overview = useReportCardOverview(examId);

  if (exams.isPending) return <PageSkeleton />;
  if (exams.error) return <ErrorState error={exams.error} onRetry={exams.refetch} />;

  const counts = ORDER.map((s) => ({ s, n: overview.data?.filter((r) => r.status === s).length ?? 0 }));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs value={examId} onValueChange={(v) => url.set({ exam: v })} className="mb-4">
        <TabsList>
          {available.map((e) => (
            <TabsTrigger key={e.id} value={e.id}>
              {e.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <ol className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {counts.map(({ s, n }, i) => (
          <li key={s} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{i + 1}.</span>
              <StatusBadge kind="reportCard" status={s} />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular">{n}</p>
            <p className="text-xs text-muted-foreground">{t(`flow.${s}`)}</p>
          </li>
        ))}
      </ol>

      <DataTable
        rows={overview.data}
        loading={overview.isPending}
        error={overview.error}
        onRetry={overview.refetch}
        rowKey={(r) => r.classId}
        onRowClick={(r) => router.push(`/app/report-cards/${examId}/class/${r.classId}`)}
        columns={[
          { key: "class", header: t("columns.class"), cell: (r) => <span className="font-medium">{r.className}</span> },
          { key: "teacher", header: t("columns.teacher"), hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{r.classTeacherName ?? "—"}</span> },
          { key: "sheets", header: t("columns.sheets"), className: "tabular", cell: (r) => `${r.sheetsSubmitted}/${r.sheetsTotal}` },
          { key: "students", header: t("columns.students"), hideBelow: "sm", className: "tabular", cell: (r) => r.students },
          { key: "status", header: t("columns.status"), cell: (r) => <StatusBadge kind="reportCard" status={r.status} /> },
        ]}
      />
    </>
  );
}
