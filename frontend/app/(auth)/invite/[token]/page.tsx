"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { LinkIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/states";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { api } from "@/lib/api/client";
import { usePublicSchool } from "@/lib/api/hooks";
import type { SessionUser } from "@/lib/api/types";
import { homeFor } from "@/lib/auth";

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = use(params);
  const t = useTranslations("auth.invite");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: school } = usePublicSchool();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.get<{ name: string; email: string; kind: string }>(`/auth/invites/${token}`),
    retry: false,
  });

  if (invite.isPending) return <Skeleton className="h-80 w-full rounded-xl" />;
  if (invite.error) return <EmptyState icon={LinkIcon} title={t("invalidTitle")} description={t("invalidBody")} className="bg-card" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title", { school: school?.name ?? "Whizchool" })}</CardTitle>
        <CardDescription>{t("subtitle", { email: invite.data.email })}</CardDescription>
      </CardHeader>
      <CardContent>
        <SetPasswordForm
          submitLabel={t("submit")}
          onSubmit={async (password) => {
            const user = await api.post<SessionUser>(`/auth/invites/${token}/accept`, { password });
            qc.clear();
            qc.setQueryData(["auth", "me"], user);
            router.replace(homeFor(user));
          }}
        />
      </CardContent>
    </Card>
  );
}
