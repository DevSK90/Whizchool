"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/page-header";
import { ProfileView } from "@/components/profile/profile-view";

export default function PortalProfilePage() {
  const t = useTranslations("admin.profile");
  return (
    <>
      <PageHeader title={t("title")} />
      <ProfileView />
    </>
  );
}
