"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CreditCard, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvoiceList } from "@/components/fees/invoice-list";
import { PageHeader } from "@/components/shared/page-header";
import { CardsSkeleton, EmptyState, ErrorState, PageSkeleton } from "@/components/shared/states";
import { StudentAttendanceView } from "@/components/students/attendance-view";
import { StudentResultsView } from "@/components/students/results-view";
import { api, newIdempotencyKey } from "@/lib/api/client";
import { useApiMutation, useStudent, useStudentInvoices, useStudentPayments } from "@/lib/api/hooks";
import type { PayHereCheckout } from "@/lib/api/types";
import { formatDate, formatMoney, initials } from "@/lib/format";
import { startPayHereCheckout } from "@/lib/payhere";
import { useUrlState } from "@/hooks/use-url-state";

export default function ChildPage({ params }: PageProps<"/portal/children/[id]">) {
  const { id } = use(params);
  const t = useTranslations("portal.child");
  const url = useUrlState<"tab">({ tab: "results" });
  const { data: s, error, refetch, isPending } = useStudent(id);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const tab = url.get("tab");
  return (
    <>
      <PageHeader
        back={{ href: "/portal", label: t("back") }}
        title={
          <span className="flex items-center gap-3">
            <Avatar className="size-10">
              {s.photoUrl && <AvatarImage src={s.photoUrl} alt="" className="object-cover" />}
              <AvatarFallback className="bg-primary/10 text-primary">{initials(s.fullName)}</AvatarFallback>
            </Avatar>
            {s.fullName}
          </span>
        }
        description={`${s.className}${s.streamName ? ` · ${s.streamName}` : ""} · ${s.admissionNo}`}
      />
      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v })}>
        <TabsList className="mb-4 w-full sm:w-auto">
          {(["results", "attendance", "fees"] as const).map((k) => (
            <TabsTrigger key={k} value={k} className="flex-1 sm:flex-none">
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="results">{tab === "results" && <StudentResultsView studentId={id} reportHref={(examId) => `/portal/children/${id}/report/${examId}`} />}</TabsContent>
        <TabsContent value="attendance">{tab === "attendance" && <StudentAttendanceView studentId={id} />}</TabsContent>
        <TabsContent value="fees">{tab === "fees" && <ChildFees studentId={id} />}</TabsContent>
      </Tabs>
    </>
  );
}

function ChildFees({ studentId }: { studentId: string }) {
  const t = useTranslations("portal.child.fees");
  const tm = useTranslations("status.method");
  const ti = useTranslations("fees.invoices");
  const router = useRouter();
  const invoices = useStudentInvoices(studentId);
  const payments = useStudentPayments(studentId);
  const open = invoices.data?.filter((i) => i.balance > 0) ?? [];
  const [selected, setSelected] = useState<string[] | null>(null);
  const idem = useRef<{ selection: string; key: string } | null>(null);
  const chosen = selected ?? open.map((i) => i.id);
  const amount = open.filter((i) => chosen.includes(i.id)).reduce((a, i) => a + i.balance, 0);
  const balance = open.reduce((a, i) => a + i.balance, 0);
  const checkout = useApiMutation(
    () => {
      const selection = [...chosen].sort().join(",");
      if (idem.current?.selection !== selection) idem.current = { selection, key: newIdempotencyKey() };
      return api.post<PayHereCheckout>("/payhere/checkout", { invoiceIds: chosen }, { idempotencyKey: idem.current.key });
    },
    {
    onSuccess: (c) => startPayHereCheckout(c, (u) => router.push(u)),
  });

  if (invoices.isPending) return <CardsSkeleton count={2} />;
  if (invoices.error) return <ErrorState error={invoices.error} onRetry={invoices.refetch} />;
  if (!invoices.data.length) return <EmptyState title={t("noInvoices")} />;

  return (
    <div className="space-y-6">
      {balance > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardDescription>{t("outstanding")}</CardDescription>
            <CardTitle className="text-3xl tabular">{formatMoney(balance)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("selectHint")}</p>
            <InvoiceList
              invoices={open}
              selected={chosen}
              onToggle={(id) => setSelected(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])}
              href={(inv) => `/portal/children/${studentId}/invoices/${inv.id}`}
            />
            <Button size="lg" className="h-11 w-full" disabled={!amount || checkout.isPending || checkout.isSuccess} onClick={() => checkout.mutate(undefined)}>
              {checkout.isPending || checkout.isSuccess ? <Spinner /> : <CreditCard />}
              {checkout.isSuccess ? t("redirecting") : t("pay", { amount: formatMoney(amount) })}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("payHint")}</p>
          </CardContent>
        </Card>
      )}
      <Alert>
        <Info />
        <AlertDescription>{t("orPayAtSchool")}</AlertDescription>
      </Alert>
      <section>
        <h2 className="mb-2 font-semibold">{ti("title")}</h2>
        <InvoiceList invoices={invoices.data.filter((i) => i.balance <= 0)} href={(inv) => `/portal/children/${studentId}/invoices/${inv.id}`} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">{t("history")}</h2>
        {payments.data?.length ? (
          <ul className="divide-y rounded-xl border bg-card">
            {payments.data.map((p) => (
              <li key={p.id}>
                <Link href={`/portal/receipts/${p.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{p.receiptNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.paidAt)} · {tm(p.method)}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular">{formatMoney(p.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
        )}
      </section>
    </div>
  );
}
