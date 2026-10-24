"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { useClasses, useInvoices } from "@/lib/api/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";
import { MonthPicker } from "@/components/shared/date-picker";

export default function InvoicesPage() {
  const t = useTranslations("fees.invoices");
  const ts = useTranslations("status.invoice");
  const tst = useTranslations("students");
  const router = useRouter();
  const url = useUrlState<"search" | "status" | "period" | "classId" | "sort">({ sort: "-issueDate" });
  const classes = useClasses();
  const list = useInvoices({
    search: url.get("search"),
    status: url.get("status"),
    period: url.get("period"),
    classId: url.get("classId"),
    sort: url.get("sort"),
    page: url.page,
    pageSize: 25,
  });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <FilterSelect
          ariaLabel={t("columns.status")}
          value={url.get("status")}
          onChange={(v) => url.set({ status: v })}
          allLabel={t("allStatuses")}
          options={[
            { value: "overdue", label: t("overdueOnly") },
            ...(["unpaid", "partial", "paid", "void"] as const).map((s) => ({ value: s, label: ts(s) })),
          ]}
          className="sm:w-40"
        />
        <FilterSelect
          ariaLabel={t("columns.class")}
          value={url.get("classId")}
          onChange={(v) => url.set({ classId: v })}
          allLabel={tst("allClasses")}
          options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          className="sm:w-36"
        />
        <MonthPicker ariaLabel={t("allMonths")} allLabel={t("allMonths")} className="w-full sm:w-auto" value={url.get("period")} onChange={(v) => url.set({ period: v })} />
      </FilterBar>
      <DataTable
        rows={list.data?.items}
        loading={list.isFetching && !list.data}
        error={list.error}
        onRetry={list.refetch}
        rowKey={(i) => i.id}
        onRowClick={(i) => router.push(`/app/fees/invoices/${i.id}`)}
        sort={url.get("sort")}
        onSort={(sort) => url.set({ sort })}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
        columns={[
          {
            key: "number",
            header: t("columns.number"),
            sortKey: "issueDate",
            cell: (i) => (
              <Link href={`/app/fees/invoices/${i.id}`} className="font-mono text-xs hover:underline" onClick={(e) => e.stopPropagation()}>
                {i.number}
              </Link>
            ),
          },
          {
            key: "student",
            header: t("columns.student"),
            sortKey: "student",
            cell: (i) => (
              <div>
                <p className="font-medium">{i.studentName}</p>
                <p className="text-xs text-muted-foreground">
                  {i.admissionNo} · {i.className}
                </p>
              </div>
            ),
          },
          { key: "issued", header: t("columns.issued"), hideBelow: "lg", cell: (i) => formatDate(i.issueDate) },
          { key: "due", header: t("columns.due"), sortKey: "dueDate", hideBelow: "md", cell: (i) => formatDate(i.dueDate) },
          { key: "total", header: t("columns.total"), sortKey: "total", hideBelow: "sm", className: "text-right tabular", headClassName: "text-right", cell: (i) => formatMoney(i.total) },
          { key: "balance", header: t("columns.balance"), sortKey: "balance", className: "text-right tabular font-medium", headClassName: "text-right", cell: (i) => (i.balance > 0 ? formatMoney(i.balance) : "—") },
          { key: "status", header: t("columns.status"), cell: (i) => <StatusBadge kind="invoice" status={i.overdue ? "overdue" : i.status} /> },
        ]}
      />
    </>
  );
}
