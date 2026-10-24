"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoiceDocument } from "@/components/fees/invoice-document";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { useInvoice } from "@/lib/api/hooks";

export default function PortalInvoicePage({ params }: PageProps<"/portal/children/[id]/invoices/[invoiceId]">) {
  const { id, invoiceId } = use(params);
  const t = useTranslations("portal.pay");
  const tc = useTranslations("common");
  const { data, error, refetch, isPending } = useInvoice(invoiceId);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader
        className="no-print"
        back={{ href: `/portal/children/${id}?tab=fees`, label: t("backToFees") }}
        title={data.number}
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> {tc("print")}
          </Button>
        }
      />
      <InvoiceDocument invoice={data} />
    </>
  );
}
