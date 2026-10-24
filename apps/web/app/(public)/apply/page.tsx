import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { serverT as t } from "@/i18n/server";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = {
  title: t("apply.metaTitle"),
  description: t("apply.subtitle"),
  robots: { index: true, follow: true },
  alternates: { canonical: "/apply" },
};

export default function ApplyPage() {
  return (
    <main className="bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent)] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <Suspense fallback={<Skeleton className="h-[680px] w-full rounded-[28px]" />}>
          <ApplyForm />
        </Suspense>
      </div>
    </main>
  );
}
