"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StudentForm } from "@/components/students/student-form";
import { api } from "@/lib/api/client";
import { useStudent } from "@/lib/api/hooks";

export default function EditStudentPage({ params }: PageProps<"/app/students/[id]/edit">) {
  const { id } = use(params);
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: student, error, refetch, isPending } = useStudent(id);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <div>
      <PageHeader back={{ href: `/app/students/${id}`, label: student.fullName }} title={t("form.editTitle", { name: student.fullName })} />
      <StudentForm
        student={student}
        submitLabel={tc("saveChanges")}
        onSubmit={async (v) => {
          await api.put(`/students/${id}`, v);
          await Promise.all([qc.invalidateQueries({ queryKey: ["student", id] }), qc.invalidateQueries({ queryKey: ["students"] })]);
          toast.success(t("form.updated"));
          router.push(`/app/students/${id}`);
        }}
      />
    </div>
  );
}
