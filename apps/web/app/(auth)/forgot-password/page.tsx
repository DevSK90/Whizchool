"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, API_MODE } from "@/lib/api/client";
import { applyServerErrors } from "@/lib/forms";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const schema = z.object({ email: z.email(t("validation.email")) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post("/auth/forgot-password", values);
      setSentTo(values.email);
    } catch (e) {
      applyServerErrors(e, form.setError);
    }
  });

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <MailCheck className="mb-2 size-8 text-primary" />
          <CardTitle className="text-xl">{t("forgot.sentTitle")}</CardTitle>
          <CardDescription>{t("forgot.sentBody", { email: sentTo })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {API_MODE === "mock" && (
            <Button variant="outline" asChild>
              <Link href="/reset-password?token=demo-reset-token">{t("forgot.demoLink")}</Link>
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link href="/login">{t("forgot.backToLogin")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("forgot.title")}</CardTitle>
        <CardDescription>{t("forgot.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">{t("login.email")}</FieldLabel>
              <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} {...form.register("email")} />
              <FieldError>{errors.email?.message}</FieldError>
            </Field>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {t("forgot.submit")}
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/login">{t("forgot.backToLogin")}</Link>
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
