"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/shared/status-badge";
import type { InvoiceListItem } from "@whizchool/shared/types";
import { formatDate, formatMoney, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Mobile-friendly invoice rows, optionally selectable (parent portal "pay now"). */
export function InvoiceList({
  invoices,
  href,
  selected,
  onToggle,
}: {
  invoices: InvoiceListItem[];
  href?: (inv: InvoiceListItem) => string;
  selected?: string[];
  onToggle?: (id: string) => void;
}) {
  const t = useTranslations("fees.student");
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {invoices.map((inv) => {
        const selectable = onToggle && inv.balance > 0;
        const title = inv.period ? formatPeriod(inv.period) : inv.lines[0]?.description;
        const body = (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {inv.number} · {t("due")} {formatDate(inv.dueDate)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-sm font-medium tabular">{formatMoney(inv.balance > 0 ? inv.balance : inv.total)}</span>
              <StatusBadge kind="invoice" status={inv.overdue ? "overdue" : inv.status} />
            </div>
          </div>
        );
        return (
          <li key={inv.id} className={cn("flex items-center gap-3 px-3 py-2.5", selected?.includes(inv.id) && "bg-primary/5")}>
            {onToggle && (
              <Checkbox
                aria-label={`${inv.number}`}
                disabled={!selectable}
                checked={selected?.includes(inv.id) ?? false}
                onCheckedChange={() => onToggle(inv.id)}
              />
            )}
            {href ? (
              <Link href={href(inv)} className="flex min-w-0 flex-1 hover:opacity-80">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
