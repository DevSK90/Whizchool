"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Pill } from "@/components/shared/status-badge";
import { useAttendanceSummary } from "@/lib/api/hooks";
import { toISODate } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";
import { DatePicker } from "@/components/shared/date-picker";

export default function AttendancePage() {
  const t = useTranslations("academics.attendance");
  const router = useRouter();
  const url = useUrlState<"date">();
  const date = url.get("date") || undefined;
  const { data, error, refetch, isPending } = useAttendanceSummary(date);
  const rows = data?.classes;
  const marked = rows?.filter((c) => c.marked).length ?? 0;
  const present = rows?.reduce((a, c) => a + (c.marked ? c.present : 0), 0) ?? 0;
  const total = rows?.reduce((a, c) => a + (c.marked ? c.total : 0), 0) ?? 0;
  const open = (classId: string) => router.push(`/app/attendance/${classId}${data ? `?date=${data.date}` : ""}`);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <FilterBar>
        <DatePicker
          className="w-full sm:w-52"
          value={data?.date ?? date ?? ""}
          max={toISODate(new Date())}
          placeholder={t("date")}
          onChange={(v) => url.set({ date: v })}
        />
      </FilterBar>
      {rows && rows.length > 1 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <StatCard label={t("marked")} value={t("summary", { marked, total: rows.length })} />
          <StatCard label={t("columns.present")} value={total ? t("rate", { rate: ((present / total) * 100).toFixed(1) }) : "—"} />
        </div>
      )}
      <DataTable
        rows={rows}
        loading={isPending}
        error={error}
        onRetry={refetch}
        rowKey={(c) => c.classId}
        onRowClick={(c) => open(c.classId)}
        columns={[
          { key: "class", header: t("columns.class"), cell: (c) => <span className="font-medium">{c.className}</span> },
          { key: "teacher", header: t("columns.teacher"), hideBelow: "md", cell: (c) => <span className="text-muted-foreground">{c.classTeacherName ?? "—"}</span> },
          { key: "present", header: t("columns.present"), className: "tabular", cell: (c) => (c.marked ? `${c.present}/${c.total}` : "—") },
          { key: "absent", header: t("columns.absent"), hideBelow: "sm", className: "tabular", cell: (c) => (c.marked ? c.absent : "—") },
          { key: "late", header: t("columns.late"), hideBelow: "sm", className: "tabular", cell: (c) => (c.marked ? c.late : "—") },
          {
            key: "status",
            header: t("columns.status"),
            cell: (c) =>
              c.marked ? (
                <Pill tone="success" icon={CheckCircle2}>{t("marked")}</Pill>
              ) : (
                <Pill tone="warning" icon={CircleDashed}>{t("notMarked")}</Pill>
              ),
          },
          {
            key: "action",
            header: "",
            className: "text-right",
            cell: (c) => (
              <Button size="sm" variant={c.marked ? "ghost" : "default"} onClick={(e) => (e.stopPropagation(), open(c.classId))}>
                {c.marked ? t("open") : t("mark")}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
