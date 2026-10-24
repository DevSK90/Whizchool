"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { useApiMutation, useClasses, useDefaulters } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

export default function DefaultersPage() {
  const t = useTranslations("fees.defaulters");
  const tst = useTranslations("students");
  const tc = useTranslations("common");
  const can = useCan();
  const url = useUrlState<"search" | "classId">();
  const classes = useClasses();
  const list = useDefaulters({ search: url.get("search"), classId: url.get("classId") });
  const [selected, setSelected] = useState<string[]>([]);
  const rows = list.data ?? [];
  const target = selected.length ? selected : rows.map((r) => r.studentId);
  const remind = useApiMutation(() => api.post<{ sent: number }>("/fees/defaulters/remind", { studentIds: target }), {
    invalidate: [["defaulters"], ["messages"]],
    success: (r) => t("sent", { count: r.sent }),
    onSuccess: () => setSelected([]),
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can("messaging.create") &&
          rows.length > 0 && (
            <ConfirmDialog
              trigger={
                <Button>
                  <MessageSquareWarning /> {selected.length ? t("remindSelected", { count: selected.length }) : t("remind")}
                </Button>
              }
              title={t("remindTitle")}
              description={t("remindBody", { count: target.length })}
              confirmLabel={t("remind")}
              onConfirm={() => remind.mutateAsync(undefined)}
            />
          )
        }
      />
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} />
        <FilterSelect
          ariaLabel={tst("columns.class")}
          value={url.get("classId")}
          onChange={(v) => url.set({ classId: v })}
          allLabel={tst("allClasses")}
          options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          className="sm:w-36"
        />
        {rows.length > 0 && (
          <span className="text-sm text-muted-foreground tabular sm:ml-auto">
            {t("total", { count: rows.length, amount: formatMoney(rows.reduce((a, r) => a + r.balance, 0)) })}
          </span>
        )}
      </FilterBar>
      <DataTable
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        onRetry={list.refetch}
        rowKey={(r) => r.studentId}
        empty={<EmptyState icon={CheckCircle2} title={t("empty")} className="border-0" />}
        columns={[
          {
            key: "sel",
            header: (
              <Checkbox
                aria-label={tc("a11y.selectAll")}
                checked={rows.length > 0 && selected.length === rows.length}
                onCheckedChange={(c) => setSelected(c ? rows.map((r) => r.studentId) : [])}
              />
            ),
            className: "w-10",
            cell: (r) => (
              <Checkbox
                aria-label={r.fullName}
                checked={selected.includes(r.studentId)}
                onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.studentId] : s.filter((x) => x !== r.studentId)))}
              />
            ),
          },
          {
            key: "student",
            header: t("columns.student"),
            cell: (r) => (
              <Link href={`/app/students/${r.studentId}`} className="font-medium hover:underline">
                {r.fullName}
              </Link>
            ),
          },
          { key: "class", header: t("columns.class"), cell: (r) => r.className },
          {
            key: "guardian",
            header: t("columns.guardian"),
            hideBelow: "lg",
            cell: (r) => (
              <div>
                <p>{r.guardianName}</p>
                <p className="text-xs text-muted-foreground">{r.guardianPhone}</p>
              </div>
            ),
          },
          { key: "inv", header: t("columns.invoices"), hideBelow: "md", className: "tabular", cell: (r) => r.overdueInvoices },
          { key: "oldest", header: t("columns.oldest"), hideBelow: "md", cell: (r) => formatDate(r.oldestDueDate) },
          { key: "bal", header: t("columns.balance"), className: "text-right tabular font-medium", headClassName: "text-right", cell: (r) => formatMoney(r.balance) },
          { key: "rem", header: t("columns.reminded"), hideBelow: "lg", cell: (r) => <span className="text-muted-foreground">{r.lastReminderAt ? formatDate(r.lastReminderAt) : t("never")}</span> },
        ]}
      />
    </>
  );
}
