"use client";

import { use, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, LockOpen, Save, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useExams, useGradeBands, useMarkSheet } from "@/lib/api/hooks";
import type { MarkValue } from "@whizchool/shared/types";
import { useCan, useSession } from "@/lib/auth";
import { gradeFor } from "@whizchool/shared/grading";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/hooks/use-url-state";
import { useResettableState } from "@/hooks/use-resettable-state";

function parse(raw: string): MarkValue | "invalid" {
  const v = raw.trim().toUpperCase();
  if (v === "") return null;
  if (v === "AB") return "AB";
  if (!/^\d{1,3}$/.test(v)) return "invalid";
  const n = Number(v);
  return n >= 0 && n <= 100 ? n : "invalid";
}

export default function MarkSheetPage({ params }: PageProps<"/app/exams/[examId]/marks">) {
  const { examId } = use(params);
  const t = useTranslations("academics.exams.sheet");
  const can = useCan();
  const user = useSession();
  const url = useUrlState<"classId" | "subjectId">();
  const classId = url.get("classId");
  const subjectId = url.get("subjectId");
  const exams = useExams();
  const bands = useGradeBands();
  const { data, error, refetch, isPending } = useMarkSheet(examId, classId, subjectId);
  const [values, setValues] = useResettableState(data, (d) =>
    Object.fromEntries((d?.rows ?? []).map((r) => [r.studentId, r.mark === null ? "" : String(r.mark)])) as Record<string, string>,
  );
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const parsed = useMemo(() => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, parse(v)])), [values]);
  const invalid = Object.values(parsed).some((v) => v === "invalid");
  const entered = Object.values(parsed).filter((v) => v !== null && v !== "invalid").length;
  const complete = !!data && entered === data.rows.length;
  const nums = Object.values(parsed).filter((v): v is number => typeof v === "number");
  const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "—";
  const dirty = !!data && data.rows.some((r) => (r.mark === null ? "" : String(r.mark)) !== (values[r.studentId] ?? ""));

  const save = useApiMutation(
    (submit: boolean) =>
      api.put(`/exams/${examId}/marks`, {
        classId,
        subjectId,
        submit,
        marks: Object.entries(parsed).map(([studentId, mark]) => ({ studentId, mark })),
      }),
    {
      invalidate: [["marks", examId, classId, subjectId], ["exam", examId], ["reportCards"], ["dashboard"]],
      success: (_, submit) => (submit ? t("submittedToast") : t("saved")),
      onSuccess: () => setServerErrors({}),
    },
  );
  const unlock = useApiMutation(() => api.post(`/exams/${examId}/marks/unlock`, { classId, subjectId }), {
    invalidate: [["marks", examId, classId, subjectId], ["exam", examId]],
    success: t("unlocked"),
  });

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const exam = exams.data?.find((e) => e.id === examId);
  const fullScope = user?.roles.some((r) => r.scope === "all");
  const run = (submit: boolean) =>
    save.mutateAsync(submit).catch((e) => {
      if (e instanceof ApiError && e.fields) setServerErrors(e.fields);
      throw e;
    });

  return (
    <>
      <PageHeader
        back={{ href: `/app/exams?exam=${examId}`, label: t("back") }}
        title={t("title", { subject: data.subjectName, className: data.className })}
        description={exam?.name}
        actions={
          data.submitted &&
          can("marks.edit") &&
          fullScope && (
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <LockOpen /> {t("unlock")}
                </Button>
              }
              title={t("unlockTitle")}
              description={t("unlockBody")}
              confirmLabel={t("unlock")}
              onConfirm={() => unlock.mutateAsync(undefined)}
            />
          )
        }
      />

      {data.submitted ? (
        <Alert className="mb-4">
          <Lock />
          <AlertDescription>{t("locked")}</AlertDescription>
        </Alert>
      ) : !data.editable ? (
        <Alert className="mb-4">
          <Lock />
          <AlertDescription>{t("closed")}</AlertDescription>
        </Alert>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">{t("hint")}</p>
      )}

      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground tabular">
        <span>{t("progress", { entered, total: data.rows.length })}</span>
        <span>{t("average", { avg })}</span>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead>{t("student")}</TableHead>
              <TableHead className="w-32">{t("mark")}</TableHead>
              <TableHead className="w-16 text-center">{t("grade")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r, i) => {
              const p = parsed[r.studentId];
              const bad = p === "invalid" || !!serverErrors[r.studentId];
              return (
                <TableRow key={r.studentId}>
                  <TableCell className="text-right text-xs text-muted-foreground tabular">{i + 1}</TableCell>
                  <TableCell>
                    <label htmlFor={`m-${r.studentId}`} className="block">
                      <span className="font-medium">{r.fullName}</span>
                      <span className="ml-2 text-xs text-muted-foreground tabular">{r.admissionNo}</span>
                    </label>
                  </TableCell>
                  <TableCell>
                    <Input
                      id={`m-${r.studentId}`}
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      value={values[r.studentId] ?? ""}
                      disabled={!data.editable}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={3}
                      aria-invalid={bad}
                      title={bad ? t("invalid") : undefined}
                      className={cn("h-8 w-20 text-center tabular", p === "AB" && "text-muted-foreground")}
                      onChange={(e) => setValues((v) => ({ ...v, [r.studentId]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "ArrowDown") {
                          e.preventDefault();
                          inputs.current[i + 1]?.focus();
                          inputs.current[i + 1]?.select();
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          inputs.current[i - 1]?.focus();
                          inputs.current[i - 1]?.select();
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-center font-medium">{p === "invalid" ? "!" : gradeFor(p ?? null, bands.data)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {data.editable && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {dirty && <span className="mr-auto text-sm text-muted-foreground">{t("unsaved")}</span>}
          {invalid && <span className="mr-auto text-sm text-destructive">{t("invalid")}</span>}
          {!invalid && !complete && <span className="mr-auto text-sm text-muted-foreground">{t("allRequired")}</span>}
          <Button variant="outline" onClick={() => run(false).catch(() => {})} disabled={save.isPending || invalid || !dirty}>
            {save.isPending && save.variables === false ? <Spinner /> : <Save />} {t("saveDraft")}
          </Button>
          <ConfirmDialog
            trigger={
              <Button disabled={save.isPending || invalid || !complete}>
                <Send /> {t("submit")}
              </Button>
            }
            title={t("submitTitle")}
            description={t("submitBody")}
            confirmLabel={t("submit")}
            onConfirm={() => run(true)}
          />
        </div>
      )}
    </>
  );
}
