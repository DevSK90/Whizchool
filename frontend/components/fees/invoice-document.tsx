"use client";

import { useTranslations } from "next-intl";
import { LogoMark } from "@/components/brand/logo";
import { useSchool } from "@/lib/api/hooks";
import type { InvoiceDetail } from "@/lib/api/types";
import { formatDate, formatMoney } from "@/lib/format";

/** Printable invoice used by staff and parents. */
export function InvoiceDocument({ invoice: inv }: { invoice: InvoiceDetail }) {
  const t = useTranslations("fees.invoice");
  const s = useSchool().data;
  const subtotal = inv.lines.reduce((a, l) => a + l.amount, 0);
  const discount = inv.lines.reduce((a, l) => a + l.discount, 0);
  return (
    <article className="rounded-xl border bg-card p-6 print:border-0 print:p-0 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div className="flex items-start gap-3">
          <LogoMark className="size-10" />
          <div>
            <p className="font-semibold">{s?.name}</p>
            <p className="text-xs text-muted-foreground">{s?.address}</p>
            <p className="text-xs text-muted-foreground">{s?.phone}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tracking-tight">{inv.number}</p>
          <p className="text-sm text-muted-foreground">
            {t("issued")} {formatDate(inv.issueDate)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("due")} {formatDate(inv.dueDate)}
          </p>
        </div>
      </header>
      <section className="py-5 text-sm">
        <p className="text-xs text-muted-foreground uppercase">{t("billedTo")}</p>
        <p className="font-medium">{inv.studentName}</p>
        <p className="text-muted-foreground">
          {inv.admissionNo} · {inv.className}
          {inv.guardianName ? ` · ${inv.guardianName}` : ""}
        </p>
      </section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y text-left text-xs text-muted-foreground uppercase">
            <th className="py-2 font-medium">{t("item")}</th>
            <th className="py-2 text-right font-medium">{t("amount")}</th>
            <th className="py-2 text-right font-medium">{t("discount")}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right tabular">{formatMoney(l.amount)}</td>
              <td className="py-2 text-right tabular text-muted-foreground">{l.discount ? `– ${formatMoney(l.discount)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
        <Row label={t("subtotal")} value={formatMoney(subtotal)} />
        {discount > 0 && <Row label={t("discount")} value={`– ${formatMoney(discount)}`} />}
        <Row label={t("total")} value={formatMoney(inv.total)} strong />
        <Row label={t("paid")} value={formatMoney(inv.paid)} />
        <div className="border-t pt-1">
          <Row label={t("balance")} value={formatMoney(inv.status === "void" ? 0 : inv.balance)} strong />
        </div>
      </dl>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold tabular" : "tabular"}>{value}</dd>
    </div>
  );
}
