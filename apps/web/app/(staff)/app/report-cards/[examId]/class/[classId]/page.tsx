"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, MessageSquarePlus, Pencil, Printer, Send, Undo2, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { api } from "@/lib/api/client";
import { useApiMutation, useReportCard, useReportCardClass } from "@/lib/api/hooks";
import type { ReportCardSummary } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";

const GRADE_ORDER = ["A", "B", "C", "S", "W", "AB"];

export default function ClassReportCardsPage({ params }: PageProps<"/app/report-cards/[examId]/class/[classId]">) {
  const { examId, classId } = use(params);
  const t = useTranslations("academics.reportCards.class");
  const tc = useTranslations("common");
  const can = useCan();
  const { data, error, refetch, isPending } = useReportCardClass(examId, classId);
  const [remarkFor, setRemarkFor] = useState<ReportCardSummary | null>(null);
  const inv = [["reportCards"], ["dashboard"], ["exams"]];
  const approve = useApiMutation((force: boolean) => api.post("/report-cards/approve", { examId, classId, force }), { invalidate: inv, success: t("approved") });
  const release = useApiMutation(() => api.post<{ notified: number }>("/report-cards/release", { examId, classId }), {
    invalidate: inv,
    success: (r) => t("released", { count: r.notified }),
  });
  const revert = useApiMutation(() => api.post("/report-cards/revert", { examId, classId }), { invalidate: inv, success: t("reverted") });

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const missing = data.rows.filter((r) => !r.hasRemark).length;
  const canRemark = can("reportCards.edit") && data.status === "draft";

  return (
    <>
      <PageHeader
        back={{ href: `/app/report-cards?exam=${examId}`, label: t("back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t("title", { className: data.className, exam: data.exam.name })}
            <StatusBadge kind="reportCard" status={data.status} />
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/app/report-cards/${examId}/class/${classId}/print`}>
                <Printer /> {t("printAll")}
              </Link>
            </Button>
            {can("reportCards.approve") && (
              <>
                {data.status === "draft" && (
                  <ConfirmDialog
                    trigger={
                      <Button>
                        <CheckCircle2 /> {t("approve")}
                      </Button>
                    }
                    title={t("approveTitle", { className: data.className })}
                    description={missing ? t("approveMissing", { count: missing }) : t("approveBody")}
                    confirmLabel={t("approve")}
                    onConfirm={() => approve.mutateAsync(missing > 0)}
                  />
                )}
                {data.status === "approved" && (
                  <>
                    <ConfirmDialog
                      trigger={
                        <Button variant="outline">
                          <Undo2 /> {t("revert")}
                        </Button>
                      }
                      title={t("revert")}
                      confirmLabel={t("revert")}
                      onConfirm={() => revert.mutateAsync(undefined)}
                    />
                    <ConfirmDialog
                      trigger={
                        <Button>
                          <Send /> {t("release")}
                        </Button>
                      }
                      title={t("releaseTitle")}
                      description={t("releaseBody", { count: data.rows.length })}
                      confirmLabel={t("release")}
                      onConfirm={() => release.mutateAsync(undefined)}
                    />
                  </>
                )}
              </>
            )}
          </>
        }
      />
      {!data.marksComplete && (
        <Alert className="mb-4">
          <Info />
          <AlertDescription>{t("marksPending")}</AlertDescription>
        </Alert>
      )}
      <DataTable
        rows={data.rows}
        rowKey={(r) => r.studentId}
        columns={[
          { key: "rank", header: t("rank"), className: "w-14 tabular font-medium", cell: (r) => r.rank },
          {
            key: "student",
            header: t("student"),
            cell: (r) => (
              <Link href={`/app/report-cards/${examId}/student/${r.studentId}`} className="font-medium hover:underline">
                {r.fullName}
              </Link>
            ),
          },
          { key: "total", header: t("total"), hideBelow: "md", className: "tabular", cell: (r) => r.total },
          { key: "avg", header: t("average"), className: "tabular", cell: (r) => r.average.toFixed(2) },
          {
            key: "grades",
            header: t("grades"),
            hideBelow: "lg",
            cell: (r) => (
              <span className="text-xs text-muted-foreground tabular">
                {GRADE_ORDER.filter((g) => r.grades[g])
                  .map((g) => `${r.grades[g]}${g}`)
                  .join(" ")}
              </span>
            ),
          },
          {
            key: "remark",
            header: t("remark"),
            cell: (r) =>
              canRemark ? (
                <Button variant="ghost" size="sm" onClick={() => setRemarkFor(r)} className={r.hasRemark ? "" : "text-primary"}>
                  {r.hasRemark ? <Pencil /> : <MessageSquarePlus />} {r.hasRemark ? t("editRemark") : t("noRemark")}
                </Button>
              ) : r.hasRemark ? (
                <CheckCircle2 className="size-4 text-success" aria-label="✓" />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            key: "view",
            header: "",
            className: "text-right",
            cell: (r) => (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/app/report-cards/${examId}/student/${r.studentId}`}>{t("view")}</Link>
              </Button>
            ),
          },
        ]}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {tc("total")}: {data.rows.length}
      </p>
      {remarkFor && <RemarkDialog examId={examId} row={remarkFor} onClose={() => setRemarkFor(null)} />}
    </>
  );
}

function RemarkDialog({ examId, row, onClose }: { examId: string; row: ReportCardSummary; onClose: () => void }) {
  const t = useTranslations("academics.reportCards.class");
  const tc = useTranslations("common");
  const card = useReportCard(examId, row.studentId);
  const [text, setText] = useState<string | null>(null);
  const value = text ?? card.data?.classTeacherRemark ?? "";
  const save = useApiMutation(() => api.put(`/report-cards/${examId}/${row.studentId}/remarks`, { classTeacherRemark: value.trim() }), {
    invalidate: [["reportCards"], ["reportCard", examId, row.studentId]],
    success: t("remarkSaved"),
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("remark")}</DialogTitle>
          <DialogDescription>
            {row.fullName} · {t("average")} {row.average.toFixed(1)} · {t("rank")} {row.rank}
          </DialogDescription>
        </DialogHeader>
        {card.isPending ? (
          <Spinner />
        ) : (
          <Field>
            <FieldLabel htmlFor="remark" className="sr-only">
              {t("remark")}
            </FieldLabel>
            <Textarea id="remark" rows={4} maxLength={300} value={value} placeholder={t("remarkPlaceholder")} onChange={(e) => setText(e.target.value)} autoFocus />
            <FieldDescription>{tc("characters", { count: value.length, max: 300 })}</FieldDescription>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending || !value.trim()}>
            {save.isPending && <Spinner />} {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
