"use client";

import { useTranslations } from "next-intl";
import { WalkInForm } from "@/components/admissions/walk-in-form";
import { PageHeader } from "@/components/shared/page-header";

export default function NewApplicationPage() {
  const t = useTranslations("admissions");
  return (
    <>
      <PageHeader className="no-print" back={{ href: "/app/admissions", label: t("detail.back") }} title={t("walkIn.title")} description={t("walkIn.description")} />
      <WalkInForm />
    </>
  );
}
