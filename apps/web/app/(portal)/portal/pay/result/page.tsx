"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, XCircle, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { usePayHereOrder } from "@/lib/api/hooks";
import { formatMoney } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

export default function PaymentResultPage() {
  const t = useTranslations("portal.pay");
  const qc = useQueryClient();
  const orderId = useUrlState<"order">().get("order");
  // Poll until the gateway's notification has been processed.
  const { data, error, refetch, isPending } = usePayHereOrder(orderId, true);

  useEffect(() => {
    if (data?.status === "success") {
      qc.invalidateQueries({ queryKey: ["student"] });
      qc.invalidateQueries({ queryKey: ["portal"] });
    }
  }, [data?.status, qc]);

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const view = {
    success: { icon: CheckCircle2, cls: "text-success", title: t("successTitle"), body: t("successBody", { amount: formatMoney(data.amount), student: data.studentName, receiptNo: data.receiptNo ?? "" }) },
    failed: { icon: XCircle, cls: "text-destructive", title: t("failedTitle"), body: t("failedBody") },
    cancelled: { icon: MinusCircle, cls: "text-muted-foreground", title: t("cancelledTitle"), body: t("cancelledBody") },
    pending: { icon: Loader2, cls: "animate-spin text-primary", title: t("pendingTitle"), body: t("pendingBody") },
  }[data.status];

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <view.icon className={`size-12 ${view.cls}`} />
        <h1 className="text-xl font-semibold">{view.title}</h1>
        <p className="text-sm text-muted-foreground">{view.body}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {data.status === "success" && data.paymentId && (
            <Button asChild>
              <Link href={`/portal/receipts/${data.paymentId}`}>{t("viewReceipt")}</Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href="/portal">{t("backToFees")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
