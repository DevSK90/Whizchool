"use client";

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { ReceiptView } from "@/components/fees/receipt-view";
import { api } from "@/lib/api/client";
import { useApiMutation, usePayment } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";

export default function PaymentReceiptPage({ params }: PageProps<"/app/fees/payments/[id]">) {
  const { id } = use(params);
  const t = useTranslations("fees.payments");
  const can = useCan();
  const { data, error, refetch, isPending } = usePayment(id);
  const [reason, setReason] = useState("");
  const reverse = useApiMutation(() => api.post(`/payments/${id}/reverse`, { reason }), {
    invalidate: [["payment", id], ["payments"], ["invoices"], ["invoice"], ["fees"], ["students"], ["student"]],
    success: t("reversed"),
  });
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader
        className="no-print"
        back={{ href: "/app/fees/payments", label: t("title") }}
        title={`${t("receipt")} ${data.receiptNo}`}
        actions={
          can("payments.approve") &&
          data.status === "completed" && (
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <Undo2 /> {t("reverse")}
                </Button>
              }
              title={t("reverseTitle")}
              description={t("reverseBody")}
              confirmLabel={t("reverse")}
              destructive
              onConfirm={() => reverse.mutateAsync(undefined)}
            >
              <Field>
                <FieldLabel htmlFor="reason">{t("reverseReason")}</FieldLabel>
                <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </ConfirmDialog>
          )
        }
      />
      <ReceiptView payment={data} school={data.school} />
    </>
  );
}
