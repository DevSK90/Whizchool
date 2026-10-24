"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { ReceiptView } from "@/components/fees/receipt-view";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { usePayment } from "@/lib/api/hooks";

export default function PortalReceiptPage({ params }: PageProps<"/portal/receipts/[id]">) {
  const { id } = use(params);
  const t = useTranslations("portal.pay");
  const { data, error, refetch, isPending } = usePayment(id);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader className="no-print" back={{ href: `/portal/children/${data.studentId}?tab=fees`, label: t("backToFees") }} title={data.receiptNo} />
      <ReceiptView payment={data} school={data.school} />
    </>
  );
}
