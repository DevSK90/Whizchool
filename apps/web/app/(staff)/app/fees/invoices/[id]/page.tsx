"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Banknote, Ban, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { InvoiceDocument } from "@/components/fees/invoice-document";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { api } from "@/lib/api/client";
import { useApiMutation, useInvoice } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

export default function InvoiceDetailPage({ params }: PageProps<"/app/fees/invoices/[id]">) {
  const { id } = use(params);
  const t = useTranslations("fees.invoice");
  const tm = useTranslations("status.method");
  const tr = useTranslations("fees.record");
  const can = useCan();
  const { data: inv, error, refetch, isPending } = useInvoice(id);
  const [reason, setReason] = useState("");
  const voidInv = useApiMutation(() => api.post(`/invoices/${id}/void`, { reason }), {
    invalidate: [["invoice", id], ["invoices"], ["fees"]],
    success: t("voided"),
  });
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        className="no-print"
        back={{ href: "/app/fees/invoices", label: t("back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {inv.number} <StatusBadge kind="invoice" status={inv.overdue ? "overdue" : inv.status} />
          </span>
        }
        description={
          <Link href={`/app/students/${inv.studentId}`} className="hover:underline">
            {inv.studentName} · {inv.className}
          </Link>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer />
            </Button>
            {can("fees.edit") && inv.paid === 0 && inv.status !== "void" && (
              <ConfirmDialog
                trigger={
                  <Button variant="outline">
                    <Ban /> {t("void")}
                  </Button>
                }
                title={t("voidTitle")}
                description={t("voidBody")}
                confirmLabel={t("void")}
                destructive
                onConfirm={() => voidInv.mutateAsync(undefined)}
              >
                <Field>
                  <FieldLabel htmlFor="reason">{t("voidReason")}</FieldLabel>
                  <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              </ConfirmDialog>
            )}
            {can("payments.create") && inv.balance > 0 && (
              <RecordPaymentDialog
                student={{ id: inv.studentId, fullName: inv.studentName, balance: inv.balance }}
                trigger={
                  <Button>
                    <Banknote /> {tr("submit")}
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <InvoiceDocument invoice={inv} />
        </div>
        <Card className="no-print h-fit">
          <CardHeader>
            <CardTitle>{t("payments")}</CardTitle>
          </CardHeader>
          <CardContent>
            {inv.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
            ) : (
              <ul className="divide-y">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/app/fees/payments/${p.id}`} className="min-w-0 hover:underline">
                      <p className="font-medium">{p.receiptNo}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(p.paidAt)} · {tm(p.method)}
                      </p>
                    </Link>
                    <div className="flex flex-col items-end gap-1">
                      <span className="tabular">{formatMoney(p.allocations.find((a) => a.invoiceId === inv.id)?.amount ?? p.amount)}</span>
                      {p.status !== "completed" && <StatusBadge kind="payment" status={p.status} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
