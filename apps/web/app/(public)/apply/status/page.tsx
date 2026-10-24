import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { serverT as t } from "@/i18n/server";
import { StatusLookup } from "./status-lookup";

export const metadata: Metadata = { title: t("apply.status.metaTitle") };

export default function ApplicationStatusPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t("apply.status.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("apply.status.subtitle")}</p>
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-60 w-full rounded-xl" />}>
          <StatusLookup />
        </Suspense>
      </div>
    </main>
  );
}
