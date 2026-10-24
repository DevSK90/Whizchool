"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { GraduationCap, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useClasses, useStudents } from "@/lib/api/hooks";
import type { StudentListItem } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

export default function StudentsPage() {
  const t = useTranslations("students");
  const can = useCan();
  const router = useRouter();
  const url = useUrlState<"search" | "classId" | "status" | "sort">({ status: "active" });
  const params = { search: url.get("search"), classId: url.get("classId"), status: url.get("status"), sort: url.get("sort"), page: url.page, pageSize: 25 };
  const list = useStudents(params);
  const classes = useClasses();

  const columns: Column<StudentListItem>[] = [
    { key: "adm", header: t("columns.admissionNo"), sortKey: "admissionNo", cell: (s) => <span className="tabular text-muted-foreground">{s.admissionNo}</span> },
    {
      key: "name",
      header: t("columns.name"),
      sortKey: "name",
      cell: (s) => (
        <Link href={`/app/students/${s.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {s.fullName}
        </Link>
      ),
    },
    { key: "class", header: t("columns.class"), sortKey: "class", cell: (s) => s.className },
    {
      key: "guardian",
      header: t("columns.guardian"),
      hideBelow: "lg",
      cell: (s) => (
        <div>
          <p>{s.primaryGuardian}</p>
          <p className="text-xs text-muted-foreground">{s.guardianPhone}</p>
        </div>
      ),
    },
    ...(can("fees.view")
      ? [
          {
            key: "balance",
            header: t("columns.balance"),
            sortKey: "balance",
            hideBelow: "md" as const,
            className: "text-right tabular",
            headClassName: "text-right",
            cell: (s: StudentListItem) => (s.balance > 0 ? formatMoney(s.balance) : <span className="text-muted-foreground">—</span>),
          },
        ]
      : []),
    { key: "status", header: t("columns.status"), hideBelow: "sm", cell: (s) => <StatusBadge kind="student" status={s.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {can("import.create") && (
              <Button variant="outline" asChild>
                <Link href="/app/import">
                  <Upload /> {t("import")}
                </Link>
              </Button>
            )}
            {can("students.create") && (
              <Button asChild>
                <Link href="/app/students/new">
                  <Plus /> {t("add")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <FilterSelect
          ariaLabel={t("columns.class")}
          value={url.get("classId")}
          onChange={(v) => url.set({ classId: v })}
          allLabel={t("allClasses")}
          options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          className="sm:w-36"
        />
        <FilterSelect
          ariaLabel={t("columns.status")}
          value={url.get("status")}
          onChange={(v) => url.set({ status: v || "all" })}
          options={(["active", "left", "graduated", "all"] as const).map((s) => ({ value: s, label: t(`statusFilter.${s}`) }))}
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
        onRowClick={(s) => router.push(`/app/students/${s.id}`)}
        sort={url.get("sort")}
        onSort={(sort) => url.set({ sort })}
        empty={<EmptyState icon={GraduationCap} title={t("empty.title")} description={t("empty.description")} className="border-0" />}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
      />
    </>
  );
}
