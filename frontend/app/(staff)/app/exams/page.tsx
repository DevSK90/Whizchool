"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/shared/states";
import { Pill, StatusBadge } from "@/components/shared/status-badge";
import { api } from "@/lib/api/client";
import { useApiMutation, useExamProgress, useExams } from "@/lib/api/hooks";
import { useCan, useSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

export default function ExamsPage() {
  const t = useTranslations("academics.exams");
  const router = useRouter();
  const can = useCan();
  const user = useSession();
  const url = useUrlState<"exam" | "search" | "pending">();
  const exams = useExams();
  const defaultExam = exams.data?.find((e) => e.status === "marks_entry") ?? exams.data?.at(-1);
  const examId = url.get("exam") || defaultExam?.id || "";
  const progress = useExamProgress(examId);
  const exam = exams.data?.find((e) => e.id === examId);
  const fullScope = user?.roles.some((r) => r.scope === "all");

  const setStatus = useApiMutation((status: string) => api.put(`/exams/${examId}/status`, { status }), {
    invalidate: [["exams"], ["exam", examId]],
    success: t("statusChanged"),
  });

  const rows = useMemo(() => {
    const q = url.get("search").toLowerCase();
    return (progress.data?.sheets ?? []).filter(
      (s) => (!q || s.className.toLowerCase().includes(q) || s.subjectName.toLowerCase().includes(q)) && (url.get("pending") !== "1" || !s.submitted),
    );
  }, [progress.data, url]);

  if (exams.isPending) return <PageSkeleton />;
  if (exams.error) return <ErrorState error={exams.error} onRetry={exams.refetch} />;

  const sheets = progress.data?.sheets ?? [];
  const done = sheets.filter((s) => s.submitted).length;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs value={examId} onValueChange={(v) => url.set({ exam: v })} className="mb-4">
        <TabsList>
          {exams.data.map((e) => (
            <TabsTrigger key={e.id} value={e.id}>
              {e.termName}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {exam && (
        <Card className="mb-4 gap-0 py-0 shadow-none">
          <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{exam.name}</h2>
                <StatusBadge kind="exam" status={exam.status} />
              </div>
              <p className="text-sm text-muted-foreground">{t("dates", { start: formatDate(exam.startDate), end: formatDate(exam.endDate) })}</p>
            </div>
            <div className="flex flex-col gap-2 md:w-80">
              <p className="text-sm tabular">{t("progress", { done, total: sheets.length })}</p>
              <Progress value={sheets.length ? (done / sheets.length) * 100 : 0} aria-label={t("progress", { done, total: sheets.length })} />
            </div>
            {can("reportCards.approve") && (exam.status === "scheduled" || exam.status === "review") && (
              <Button onClick={() => setStatus.mutate("marks_entry")} disabled={setStatus.isPending}>
                {t("openEntry")}
              </Button>
            )}
            {can("reportCards.approve") && exam.status === "marks_entry" && (
              <ConfirmDialog
                trigger={<Button variant="outline">{t("closeEntry")}</Button>}
                title={t("closeEntry")}
                confirmLabel={t("closeEntry")}
                onConfirm={() => setStatus.mutateAsync("review")}
              />
            )}
          </CardContent>
        </Card>
      )}

      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={url.get("pending") === "1"} onCheckedChange={(c) => url.set({ pending: c ? "1" : "" })} />
          {t("onlyPending")}
        </label>
        <span className="text-sm text-muted-foreground sm:ml-auto">{fullScope ? t("all") : t("mine")}</span>
      </FilterBar>

      <DataTable
        rows={rows}
        loading={progress.isPending}
        error={progress.error}
        onRetry={progress.refetch}
        rowKey={(s) => `${s.classId}-${s.subjectId}`}
        onRowClick={(s) => router.push(`/app/exams/${examId}/marks?classId=${s.classId}&subjectId=${s.subjectId}`)}
        empty={<EmptyState title={t("noSheets")} className="border-0" />}
        columns={[
          { key: "class", header: t("columns.class"), cell: (s) => <span className="font-medium">{s.className}</span> },
          { key: "subject", header: t("columns.subject"), cell: (s) => s.subjectName },
          { key: "teacher", header: t("columns.teacher"), hideBelow: "lg", cell: (s) => <span className="text-muted-foreground">{s.teacherName ?? "—"}</span> },
          {
            key: "entered",
            header: t("columns.entered"),
            hideBelow: "sm",
            cell: (s) => (
              <div className="flex w-36 items-center gap-2">
                <Progress value={s.total ? (s.entered / s.total) * 100 : 0} className="h-1.5" aria-hidden />
                <span className="text-xs tabular text-muted-foreground">
                  {s.entered}/{s.total}
                </span>
              </div>
            ),
          },
          {
            key: "status",
            header: t("columns.status"),
            cell: (s) =>
              s.submitted ? (
                <Pill tone="success" icon={CheckCircle2}>{t("submitted")}</Pill>
              ) : s.entered > 0 ? (
                <Pill tone="warning" icon={PencilLine}>{t("inProgress")}</Pill>
              ) : (
                <Pill tone="neutral" icon={CircleDashed}>{t("notStarted")}</Pill>
              ),
          },
        ]}
      />
    </>
  );
}
