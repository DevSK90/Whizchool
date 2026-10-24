"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/shared/status-badge";
import { ApplicationTimeline } from "@/components/admissions/timeline";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import type { ApplicationStatusView } from "@whizchool/shared/types";
import { formatDate, formatDateTime } from "@/lib/format";

export function StatusLookup() {
  const t = useTranslations("apply.status");
  const params = useSearchParams();
  const [result, setResult] = useState<ApplicationStatusView | null>(null);
  const schema = z.object({
    refNo: z.string().trim().min(4, t("refPlaceholder")),
    email: z.email(),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { refNo: params.get("ref") ?? "", email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setResult(null);
    try {
      setResult(await api.get<ApplicationStatusView>("/applications/status", v));
    } catch (e) {
      form.setError("root", { message: e instanceof ApiError && e.status === 404 ? t("notFound") : errorMessage(e) });
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.refNo}>
                  <FieldLabel htmlFor="refNo">{t("refNo")}</FieldLabel>
                  <Input id="refNo" placeholder={t("refPlaceholder")} className="uppercase" aria-invalid={!!errors.refNo} {...form.register("refNo")} />
                  <FieldError>{errors.refNo?.message}</FieldError>
                </Field>
                <Field data-invalid={!!errors.email}>
                  <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
                  <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register("email")} />
                  <FieldError>{errors.email?.message}</FieldError>
                </Field>
              </div>
              {errors.root && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-fit" disabled={isSubmitting}>
                {isSubmitting && <Spinner />}
                {t("submit")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {result.studentName} <span className="font-normal text-muted-foreground">· {result.gradeName}</span>
              </span>
              <StatusBadge kind="application" status={result.stage} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("refNo")}</dt>
                <dd className="font-medium">{result.refNo}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("submitted")}</dt>
                <dd className="font-medium">{formatDate(result.submittedAt)}</dd>
              </div>
              {result.interviewAt && result.stage === "interview" && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">{t("interview")}</dt>
                  <dd className="font-medium">{formatDateTime(result.interviewAt)}</dd>
                </div>
              )}
            </dl>
            <Alert>
              <AlertDescription>{t(`next.${result.stage}`)}</AlertDescription>
            </Alert>
            <div>
              <h3 className="mb-3 text-sm font-medium">{t("timeline")}</h3>
              <ApplicationTimeline items={result.timeline} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
