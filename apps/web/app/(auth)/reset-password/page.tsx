"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { api } from "@/lib/api/client";

export default function ResetPasswordPage() {
  const t = useTranslations("auth.reset");
  const router = useRouter();
  const token = useSearchParams().get("token");

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("invalid")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/forgot-password">{t("requestNew")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription />
      </CardHeader>
      <CardContent>
        <SetPasswordForm
          submitLabel={t("submit")}
          onSubmit={async (password) => {
            await api.post("/auth/reset-password", { token, password });
            toast.success(t("done"));
            router.replace("/login");
          }}
        />
      </CardContent>
    </Card>
  );
}
