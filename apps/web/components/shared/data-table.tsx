"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "./states";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** API sort key; makes the header clickable */
  sortKey?: string;
  className?: string;
  headClassName?: string;
  /** Hide below this breakpoint to keep tables readable on small screens */
  hideBelow?: "sm" | "md" | "lg";
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  onRowClick,
  sort,
  onSort,
  empty,
  pagination,
  className,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  sort?: string;
  onSort?: (sort: string) => void;
  empty?: ReactNode;
  pagination?: { page: number; pageSize: number; total: number; onPage: (page: number) => void };
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  const t = useTranslations("common");
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const sortDesc = sort?.startsWith("-");
  const sortField = sortDesc ? sort?.slice(1) : sort;

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((c) => (
              <TableHead key={c.key} className={cn("h-10 text-xs font-medium text-muted-foreground", c.hideBelow && HIDE[c.hideBelow], c.headClassName)}>
                {c.sortKey && onSort ? (
                  <button
                    type="button"
                    className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground"
                    onClick={() => onSort(sortField === c.sortKey && !sortDesc ? `-${c.sortKey}` : c.sortKey!)}
                  >
                    {c.header}
                    {sortField === c.sortKey ? (
                      sortDesc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />
                    ) : (
                      <ArrowUpDown className="size-3.5 opacity-50" />
                    )}
                  </button>
                ) : (
                  c.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !rows
            ? Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn(c.hideBelow && HIDE[c.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows?.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && "cursor-pointer", rowClassName?.(row))}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn("py-2.5", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {!loading && rows?.length === 0 && (
        <div className="p-4">{empty ?? <EmptyState title={t("noResults")} description={t("noResultsHint")} className="border-0" />}</div>
      )}
      {pagination && pagination.total > 0 && <Pagination {...pagination} loading={loading} />}
    </div>
  );
}

function Pagination({ page, pageSize, total, onPage, loading }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; loading?: boolean }) {
  const t = useTranslations("common.pagination");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-sm text-muted-foreground">
      <span className="tabular">{t("showing", { from, to, total })}</span>
      <div className="flex items-center gap-1">
        <span className="mr-2 hidden tabular sm:inline">{t("pageOf", { page, pages })}</span>
        <Button variant="outline" size="icon-sm" aria-label={t("previous")} disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label={t("next")} disabled={page >= pages || loading} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
