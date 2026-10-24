"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FlaskConical, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { usePayHereOrder } from "@/lib/api/hooks";
import { formatMoney } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

/** Stand-in for PayHere's hosted checkout (mock mode only). */
export default function PayHereSandboxPage() {
  const t = useTranslations("portal.pay");
  const router = useRouter();
  const orderId = useUrlState<"order">().get("order");
  const { data, error, refetch, isPending } = usePayHereOrder(orderId);
  const [busy, setBusy] = useState<string | null>(null);

  async function complete(outcome: "success" | "failed" | "cancelled") {
    setBusy(outcome);
    // PayHere calls notify_url server-to-server, then redirects the parent to return_url.
    await api.post(`/payhere/sandbox/${orderId}/complete`, { outcome });
    router.replace(`/portal/pay/result?order=${orderId}`);
  }

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Alert>
        <FlaskConical />
        <AlertDescription>{t("sandboxNote")}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="rounded bg-[#1a73e8] px-1.5 py-0.5 text-xs font-bold text-white">PayHere</span>
            {t("sandboxTitle")}
          </CardTitle>
          <CardDescription>
            {t("merchant", { merchant: data.merchant })} · {t("order", { order: data.id })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs text-muted-foreground">{t("items")}</p>
            <p className="text-sm">{data.invoiceNumbers.join(", ")}</p>
            <p className="mt-3 text-xs text-muted-foreground">{t("amount")}</p>
            <p className="text-2xl font-semibold tabular">{formatMoney(data.amount, true)}</p>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="card">{t("cardNumber")}</FieldLabel>
              <Input id="card" defaultValue="4916 2175 0161 1292" inputMode="numeric" autoComplete="off" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="exp">{t("expiry")}</FieldLabel>
                <Input id="exp" defaultValue="12/28" autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="cvv">{t("cvv")}</FieldLabel>
                <Input id="cvv" defaultValue="123" autoComplete="off" />
              </Field>
            </div>
          </FieldGroup>
          <Button size="lg" className="h-11 w-full" disabled={!!busy || data.status !== "pending"} onClick={() => complete("success")}>
            {busy === "success" ? <Spinner /> : <Lock />} {busy === "success" ? t("processing") : t("payNow", { amount: formatMoney(data.amount) })}
          </Button>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => complete("cancelled")}>
              {t("cancel")}
            </Button>
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => complete("failed")}>
              {t("simulateFail")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
