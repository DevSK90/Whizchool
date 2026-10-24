"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { StudentForm } from "@/components/students/student-form";
import { api } from "@/lib/api/client";
import type { StudentListItem } from "@whizchool/shared/types";

export default function NewStudentPage() {
  const t = useTranslations("students");
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: "/app/students", label: t("profile.back") }} title={t("form.newTitle")} description={t("form.newDescription")} />
      <StudentForm
        submitLabel={t("form.create")}
        onSubmit={async ({ guardian, ...v }) => {
          const res = await api.post<StudentListItem & { inviteLink?: string }>("/students", {
            ...v,
            guardian: { ...guardian, email: guardian?.email || undefined },
          });
          await qc.invalidateQueries({ queryKey: ["students"] });
          qc.invalidateQueries({ queryKey: ["classes"] });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
          toast.success(t("form.created", { name: res.fullName, admissionNo: res.admissionNo }), {
            description: res.inviteLink ? t("form.inviteLink", { link: res.inviteLink }) : undefined,
          });
          router.push(`/app/students/${res.id}`);
        }}
      />
    </div>
  );
}
