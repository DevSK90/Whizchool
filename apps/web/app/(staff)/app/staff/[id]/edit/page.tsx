"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StaffForm } from "@/components/staff/staff-form";
import { api } from "@/lib/api/client";
import { useStaffMember } from "@/lib/api/hooks";

export default function EditStaffPage({ params }: PageProps<"/app/staff/[id]/edit">) {
  const { id } = use(params);
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: staff, error, refetch, isPending } = useStaffMember(id);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <div>
      <PageHeader back={{ href: `/app/staff/${id}`, label: staff.name }} title={t("form.editTitle", { name: staff.name })} />
      <StaffForm
        staff={staff}
        submitLabel={tc("saveChanges")}
        onSubmit={async (values) => {
          await api.put(`/staff/${id}`, values);
          await Promise.all([qc.invalidateQueries({ queryKey: ["staff"] }), qc.invalidateQueries({ queryKey: ["staffMember", id] }), qc.invalidateQueries({ queryKey: ["users"] })]);
          toast.success(t("form.saved"));
          router.push(`/app/staff/${id}`);
        }}
      />
    </div>
  );
}
