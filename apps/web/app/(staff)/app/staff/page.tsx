"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Contact, Plus } from "lucide-react";
import type { Staff } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useStaffDirectory } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";
import { useUrlState } from "@/hooks/use-url-state";

export default function StaffPage() {
  const t = useTranslations("staff");
  const can = useCan();
  const router = useRouter();
  const url = useUrlState<"search" | "type" | "status" | "sort">({ status: "active" });
  const list = useStaffDirectory({ search: url.get("search"), type: url.get("type"), status: url.get("status"), sort: url.get("sort"), page: url.page, pageSize: 25 });

  const columns: Column<Staff>[] = [
    { key: "empNo", header: t("columns.empNo"), sortKey: "empNo", cell: (s) => <span className="tabular text-muted-foreground">{s.empNo}</span> },
    {
      key: "name",
      header: t("columns.name"),
      sortKey: "name",
      cell: (s) => (
        <Link href={`/app/staff/${s.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {s.name}
        </Link>
      ),
    },
    { key: "designation", header: t("columns.designation"), sortKey: "designation", hideBelow: "sm", cell: (s) => s.designation },
    { key: "type", header: t("columns.type"), hideBelow: "lg", cell: (s) => t(`types.${s.staffType}`) },
    { key: "phone", header: t("columns.phone"), hideBelow: "md", cell: (s) => <span className="tabular text-muted-foreground">{s.phone}</span> },
    { key: "status", header: t("columns.status"), hideBelow: "sm", cell: (s) => <StatusBadge kind="staff" status={s.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can("staff.create") && (
            <Button asChild>
              <Link href="/app/staff/new">
                <Plus /> {t("add")}
              </Link>
            </Button>
          )
        }
      />
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <FilterSelect
          ariaLabel={t("columns.type")}
          value={url.get("type")}
          onChange={(v) => url.set({ type: v })}
          allLabel={t("allTypes")}
          options={(["academic", "non_academic"] as const).map((v) => ({ value: v, label: t(`types.${v}`) }))}
        />
        <FilterSelect
          ariaLabel={t("columns.status")}
          value={url.get("status")}
          onChange={(v) => url.set({ status: v || "all" })}
          options={(["active", "inactive", "all"] as const).map((v) => ({ value: v, label: t(`statusFilter.${v}`) }))}
          className="sm:w-40"
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(s) => s.id}
        loading={list.isFetching && !list.data}
        error={list.error}
        onRetry={list.refetch}
        onRowClick={(s) => router.push(`/app/staff/${s.id}`)}
        sort={url.get("sort")}
        onSort={(sort) => url.set({ sort })}
        empty={<EmptyState icon={Contact} title={t("empty.title")} description={t("empty.description")} className="border-0" />}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
      />
    </>
  );
}
