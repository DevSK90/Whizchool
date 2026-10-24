"use client";

import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import type { PaymentListItem, School } from "@/lib/api/types";
import { formatDateTime, formatMoney } from "@/lib/format";

export function ReceiptView({ payment: p, school }: { payment: PaymentListItem; school: School }) {
  const t = useTranslations("fees.receiptView");
  const tm = useTranslations("status.method");
  const tc = useTranslations("common");
  return (
    <div className="space-y-4">
      <div className="no-print flex justify-end">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> {tc("print")}
        </Button>
      </div>
      <article className="mx-auto max-w-xl rounded-xl border bg-card p-6 print:border-0 sm:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <LogoMark className="size-10" />
          <div className="flex-1">
            <p className="font-semibold">{school.name}</p>
            <p className="text-xs text-muted-foreground">{school.address}</p>
            <p className="text-xs text-muted-foreground">
              {school.phone} · {school.email}
            </p>
          </div>
          <p className="text-sm font-semibold tracking-wide uppercase">{t("title")}</p>
        </header>
        {p.status === "reversed" && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("reversed")}</p>}
        <dl className="grid grid-cols-2 gap-4 py-5 text-sm">
          <Item label={t("receiptNo")} value={p.receiptNo} />
          <Item label={t("date")} value={formatDateTime(p.paidAt)} />
          <Item label={t("receivedFrom")} value={`${p.studentName} (${p.admissionNo}) · ${p.className}`} wide />
          <Item label={t("method")} value={tm(p.method)} />
          <Item label={t("reference")} value={p.reference ?? "—"} />
        </dl>
        <div className="border-t pt-4 text-sm">
          <p className="mb-2 text-xs text-muted-foreground uppercase">{t("appliedTo")}</p>
          <ul className="space-y-1">
            {p.allocations.map((a) => (
              <li key={a.invoiceId} className="flex justify-between">
                <span className="font-mono text-xs">{a.invoiceNumber}</span>
                <span className="tabular">{formatMoney(a.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-muted px-4 py-3">
          <span className="text-sm">{t("amount")}</span>
          <span className="text-xl font-semibold tabular">{formatMoney(p.amount)}</span>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {t("recordedBy")}: {p.recordedBy}
        </p>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">{t("footer")}</p>
      </article>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
