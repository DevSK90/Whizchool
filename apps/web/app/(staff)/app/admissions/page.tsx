"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ExternalLink, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useApplicationCounts, useApplications, useGrades } from "@/lib/api/hooks";
import type { ApplicationListItem, ApplicationStage } from "@whizchool/shared/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

const STAGES: (ApplicationStage | "all")[] = ["all", "new", "interview", "accepted", "enrolled", "rejected", "withdrawn"];

export default function AdmissionsPage() {
  const t = useTranslations("admissions");
  const ts = useTranslations("status.application");
  const router = useRouter();
  const url = useUrlState<"stage" | "search" | "gradeId" | "sort">({ stage: "all", sort: "-submittedAt" });
  const params = { stage: url.get("stage"), search: url.get("search"), gradeId: url.get("gradeId"), sort: url.get("sort"), page: url.page, pageSize: 20 };
  const list = useApplications(params);
  const counts = useApplicationCounts();
  const grades = useGrades();

  const columns: Column<ApplicationListItem>[] = [
    { key: "ref", header: t("columns.ref"), cell: (a) => <span className="font-mono text-xs">{a.refNo}</span>, hideBelow: "md" },
    {
      key: "student",
      header: t("columns.student"),
      sortKey: "name",
      cell: (a) => (
        <Link href={`/app/admissions/${a.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {a.studentName}
        </Link>
      ),
    },
    { key: "grade", header: t("columns.grade"), sortKey: "grade", cell: (a) => a.gradeName },
    {
      key: "guardian",
      header: t("columns.guardian"),
      hideBelow: "lg",
      cell: (a) => (
        <div>
          <p>{a.guardianName}</p>
          <p className="text-xs text-muted-foreground">{a.guardianPhone}</p>
        </div>
      ),
    },
    { key: "submitted", header: t("columns.submitted"), sortKey: "submittedAt", hideBelow: "sm", cell: (a) => formatDate(a.submittedAt) },
    { key: "interview", header: t("columns.interview"), sortKey: "interviewAt", hideBelow: "lg", cell: (a) => (a.interviewAt && a.stage === "interview" ? formatDateTime(a.interviewAt) : "—") },
    { key: "stage", header: t("columns.stage"), cell: (a) => <StatusBadge kind="application" status={a.stage} /> },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/apply" target="_blank">
              <ExternalLink /> {t("publicForm")}
            </Link>
          </Button>
        }
      />
      <Tabs value={url.get("stage")} onValueChange={(v) => url.set({ stage: v })} className="mb-4">
        <TabsList className="h-auto flex-wrap">
          {STAGES.map((s) => (
            <TabsTrigger key={s} value={s} className="gap-1.5">
              {s === "all" ? t("tabs.all") : ts(s)}
              <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular">{counts.data?.[s] ?? 0}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <FilterSelect
          ariaLabel={t("columns.grade")}
          value={url.get("gradeId")}
          onChange={(v) => url.set({ gradeId: v })}
          allLabel={t("allGrades")}
          options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(a) => a.id}
        loading={list.isFetching && !list.data}
        error={list.error}
        onRetry={list.refetch}
        onRowClick={(a) => router.push(`/app/admissions/${a.id}`)}
        sort={url.get("sort")}
        onSort={(sort) => url.set({ sort })}
        empty={<EmptyState icon={UserPlus} title={t("empty.title")} description={t("empty.description")} className="border-0" />}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
      />
    </>
  );
}
