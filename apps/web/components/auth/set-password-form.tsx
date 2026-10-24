"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { PasswordInput } from "@/components/shared/password-input";
import { applyServerErrors } from "@/lib/forms";

/** New password + confirmation, shared by reset-password and invitation acceptance. */
export function SetPasswordForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (password: string) => Promise<void> }) {
  const t = useTranslations("auth");
  const schema = z
    .object({
      password: z.string().min(8, t("password.tooShort")),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: t("password.mismatch") });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        try {
          await onSubmit(v.password);
        } catch (e) {
          applyServerErrors(e, form.setError);
        }
      })}
    >
      <FieldGroup>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">{t("reset.newPassword")}</FieldLabel>
          <PasswordInput id="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password} {...form.register("password")} />
          <FieldDescription>{t("password.rules")}</FieldDescription>
          <FieldError>{errors.password?.message}</FieldError>
        </Field>
        <Field data-invalid={!!errors.confirm}>
          <FieldLabel htmlFor="confirm">{t("reset.confirmPassword")}</FieldLabel>
          <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register("confirm")} />
          <FieldError>{errors.confirm?.message}</FieldError>
        </Field>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
