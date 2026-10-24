"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { useApiMutation, usePromotionPreview } from "@/lib/api/hooks";
import type { PromotionAction, PromotionPreview, PromotionRow } from "@/lib/api/types";
import { useCan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTIONS: PromotionAction[] = ["promote", "repeat", "leave", "graduate"];

function gradeOf(className: string) {
  return parseInt(className, 10);
}

export default function PromotionsPage() {
  const t = useTranslations("academics.promotions");
  const { data, error, refetch, isPending } = usePromotionPreview();
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (data.completed) {
    return (
      <>
        <PageHeader title={t("title")} />
        <Alert>
          <CheckCircle2 />
          <AlertTitle>{t("completedTitle", { year: data.toYearName })}</AlertTitle>
          <AlertDescription>{t("completedBody", { ...data.completed, date: formatDate(data.completed.at) })}</AlertDescription>
        </Alert>
      </>
    );
  }
  return <PromotionEditor data={data} />;
}

function PromotionEditor({ data }: { data: PromotionPreview }) {
  const t = useTranslations("academics.promotions");
  const ta = useTranslations("status.promotion");
  const tc = useTranslations("common");
  const can = useCan();
  const [rows, setRows] = useState<PromotionRow[]>(data.rows);
  const [classId, setClassIdState] = useState(data.rows[0]?.fromClassId ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const setClassId = (id: string) => {
    setClassIdState(id);
    setSelected([]);
  };

  const classes = useMemo(() => [...new Map(data.rows.map((r) => [r.fromClassId, r.fromClassName])).entries()], [data.rows]);
  const visible = rows.filter((r) => r.fromClassId === classId);
  const counts = Object.fromEntries(ACTIONS.map((a) => [a, rows.filter((r) => r.action === a).length])) as Record<PromotionAction, number>;
  const missing = rows.filter((r) => (r.action === "promote" || r.action === "repeat") && !r.toClassId).length;

  const update = (ids: string[], patch: Partial<PromotionRow>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (!ids.includes(r.studentId)) return r;
        const next = { ...r, ...patch };
        if (patch.action) {
          const g = gradeOf(r.fromClassName);
          const section = r.fromClassName.split("-")[1]?.toLowerCase();
          next.toClassId =
            patch.action === "promote" ? (g < 11 || g === 12 ? `next_${g + 1}${section}` : undefined) : patch.action === "repeat" ? `next_${g}${section}` : undefined;
        }
        return next;
      }),
    );

  const confirm = useApiMutation(() => api.post("/promotions/confirm", { rows }), {
    invalidate: [["promotions"], ["years"]],
    success: t("done", { year: data.toYearName }),
  });

  const targetOptions = (r: PromotionRow) => {
    const g = gradeOf(r.fromClassName);
    const want = r.action === "repeat" ? g : g + 1;
    return data.targetClasses.filter((c) => c.gradeNumber === want);
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", { next: data.toYearName })}
        actions={
          can("promotions.approve") && (
            <ConfirmDialog
              trigger={<Button disabled={missing > 0}>{t("confirm")}</Button>}
              title={t("confirmTitle", { year: data.toYearName })}
              description={t("confirmBody", { year: data.toYearName })}
              confirmLabel={t("confirm")}
              onConfirm={() => confirm.mutateAsync(undefined)}
            >
              <p className="text-sm">{t("summary", counts)}</p>
            </ConfirmDialog>
          )
        }
      />
      <p className="mb-2 text-sm tabular">{t("summary", counts)}</p>
      {missing > 0 && (
        <Alert className="mb-4">
          <AlertTriangle />
          <AlertDescription>{t("needsTarget", { count: missing })}</AlertDescription>
        </Alert>
      )}
      <FilterBar>
        <FilterSelect ariaLabel={t("filterClass")} value={classId} onChange={setClassId} options={classes.map(([id, name]) => ({ value: id, label: name }))} className="sm:w-36" />
        {selected.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span>{t("bulk", { count: selected.length })}</span>
            {ACTIONS.map((a) => (
              <Button key={a} size="sm" variant="outline" onClick={() => update(selected, { action: a })}>
                {ta(a)}
              </Button>
            ))}
          </div>
        )}
        <span className="text-xs text-muted-foreground sm:ml-auto">{t("basedOn")}</span>
      </FilterBar>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10">
                <Checkbox
                  aria-label={tc("a11y.selectAll")}
                  checked={visible.length > 0 && selected.length === visible.length}
                  onCheckedChange={(c) => setSelected(c ? visible.map((r) => r.studentId) : [])}
                />
              </TableHead>
              <TableHead>{t("columns.student")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("columns.average")}</TableHead>
              <TableHead>{t("columns.action")}</TableHead>
              <TableHead>{t("columns.to", { year: data.toYearName })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.studentId} className={cn(r.action !== "promote" && "bg-muted/30")}>
                <TableCell>
                  <Checkbox
                    aria-label={r.fullName}
                    checked={selected.includes(r.studentId)}
                    onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.studentId] : s.filter((x) => x !== r.studentId)))}
                  />
                </TableCell>
                <TableCell>
                  <p className="font-medium">{r.fullName}</p>
                  <p className="text-xs text-muted-foreground tabular">{r.admissionNo}</p>
                </TableCell>
                <TableCell className="hidden tabular sm:table-cell">
                  {r.average !== undefined ? (
                    <span className={cn(r.average < 35 && "font-medium text-destructive")} title={r.average < 35 ? t("lowAverage") : undefined}>
                      {r.average.toFixed(1)}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Select value={r.action} onValueChange={(v) => update([r.studentId], { action: v as PromotionAction })}>
                    <SelectTrigger className="h-8 w-36" aria-label={t("columns.action")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((a) => (
                        <SelectItem key={a} value={a} disabled={a === "graduate" && gradeOf(r.fromClassName) !== 13}>
                          {ta(a)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {r.action === "promote" || r.action === "repeat" ? (
                    <Select value={r.toClassId ?? ""} onValueChange={(v) => update([r.studentId], { toClassId: v })}>
                      <SelectTrigger className={cn("h-8 w-32", !r.toClassId && "border-warning")} aria-label={t("columns.to", { year: data.toYearName })}>
                        <SelectValue placeholder={t("chooseClass")} />
                      </SelectTrigger>
                      <SelectContent>
                        {targetOptions(r).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
