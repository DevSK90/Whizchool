"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { useAuditLog } from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

const ENTITIES = ["Student", "Application", "Attendance", "Mark sheet", "Report cards", "Invoice", "Payment", "Message", "User", "Role", "School", "Import", "Promotions"];

export default function AuditLogPage() {
  const t = useTranslations("admin.audit");
  const url = useUrlState<"search" | "entity">();
  const list = useAuditLog({ search: url.get("search"), entity: url.get("entity"), page: url.page, pageSize: 30 });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <FilterSelect ariaLabel={t("columns.area")} value={url.get("entity")} onChange={(v) => url.set({ entity: v })} allLabel={t("allEntities")} options={ENTITIES.map((e) => ({ value: e, label: e }))} />
      </FilterBar>
      <DataTable
        rows={list.data?.items}
        loading={list.isFetching && !list.data}
        error={list.error}
        onRetry={list.refetch}
        rowKey={(a) => a.id}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
        columns={[
          { key: "when", header: t("columns.when"), cell: (a) => <span className="whitespace-nowrap text-muted-foreground tabular">{formatDateTime(a.at)}</span> },
          { key: "who", header: t("columns.who"), hideBelow: "sm", cell: (a) => <span className="font-medium">{a.actor}</span> },
          {
            key: "what",
            header: t("columns.what"),
            cell: (a) => (
              <div className="min-w-0">
                <p className="sm:hidden text-xs font-medium">{a.actor}</p>
                <p>{a.summary}</p>
              </div>
            ),
          },
          { key: "area", header: t("columns.area"), hideBelow: "md", cell: (a) => <Badge variant="outline">{a.entity}</Badge> },
        ]}
      />
    </>
  );
}
