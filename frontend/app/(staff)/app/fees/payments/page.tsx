"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { usePayments } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";
import { DatePicker } from "@/components/shared/date-picker";

export default function PaymentsPage() {
  const t = useTranslations("fees.payments");
  const tm = useTranslations("status.method");
  const tr = useTranslations("fees.record");
  const can = useCan();
  const router = useRouter();
  const url = useUrlState<"search" | "method" | "from" | "to" | "sort">({ sort: "-paidAt" });
  const list = usePayments({ search: url.get("search"), method: url.get("method"), from: url.get("from"), to: url.get("to"), sort: url.get("sort"), page: url.page, pageSize: 25 });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can("payments.create") && (
            <RecordPaymentDialog
              trigger={
                <Button>
                  <Banknote /> {tr("submit")}
                </Button>
              }
            />
          )
        }
      />
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <FilterSelect
          ariaLabel={t("columns.method")}
          value={url.get("method")}
          onChange={(v) => url.set({ method: v })}
          allLabel={t("allMethods")}
          options={(["cash", "bank_deposit", "cheque", "payhere"] as const).map((m) => ({ value: m, label: tm(m) }))}
        />
        <DatePicker className="w-full sm:w-44" clearable placeholder={t("from")} value={url.get("from")} max={url.get("to") || undefined} onChange={(v) => url.set({ from: v })} />
        <DatePicker className="w-full sm:w-44" clearable placeholder={t("to")} value={url.get("to")} min={url.get("from") || undefined} onChange={(v) => url.set({ to: v })} />
      </FilterBar>
      <DataTable
        rows={list.data?.items}
        loading={list.isFetching && !list.data}
        error={list.error}
        onRetry={list.refetch}
        rowKey={(p) => p.id}
        onRowClick={(p) => router.push(`/app/fees/payments/${p.id}`)}
        sort={url.get("sort")}
        onSort={(sort) => url.set({ sort })}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
        columns={[
          { key: "receipt", header: t("columns.receipt"), cell: (p) => <span className="font-mono text-xs">{p.receiptNo}</span> },
          {
            key: "student",
            header: t("columns.student"),
            sortKey: "student",
            cell: (p) => (
              <div>
                <p className="font-medium">{p.studentName}</p>
                <p className="text-xs text-muted-foreground">{p.className}</p>
              </div>
            ),
          },
          { key: "date", header: t("columns.date"), sortKey: "paidAt", hideBelow: "md", cell: (p) => formatDateTime(p.paidAt) },
          { key: "method", header: t("columns.method"), hideBelow: "sm", cell: (p) => tm(p.method) },
          { key: "ref", header: t("columns.reference"), hideBelow: "lg", cell: (p) => <span className="text-muted-foreground">{p.reference ?? "—"}</span> },
          { key: "amount", header: t("columns.amount"), sortKey: "amount", className: "text-right tabular font-medium", headClassName: "text-right", cell: (p) => formatMoney(p.amount) },
          { key: "status", header: t("columns.status"), hideBelow: "sm", cell: (p) => <StatusBadge kind="payment" status={p.status} /> },
        ]}
      />
    </>
  );
}
