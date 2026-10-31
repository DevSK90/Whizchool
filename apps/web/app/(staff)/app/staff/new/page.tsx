"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { StaffForm } from "@/components/staff/staff-form";
import { api } from "@/lib/api/client";

export default function NewStaffPage() {
  const t = useTranslations("staff");
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <div>
      <PageHeader back={{ href: "/app/staff", label: t("title") }} title={t("form.newTitle")} description={t("form.newDescription")} />
      <StaffForm
        submitLabel={t("add")}
        onSubmit={async (values) => {
          const { id } = await api.post<{ id: string }>("/staff", values);
          await qc.invalidateQueries({ queryKey: ["staff"] });
          toast.success(values.login ? t("form.addedInvited", { email: values.email ?? "" }) : t("form.added"));
          router.push(`/app/staff/${id}`);
        }}
      />
    </div>
  );
}
