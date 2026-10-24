"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PasswordInput } from "@/components/shared/password-input";
import { DetailList } from "@/components/shared/detail-list";
import { api } from "@/lib/api/client";
import { useSession } from "@/lib/auth";
import { applyServerErrors } from "@/lib/forms";

export function ProfileView() {
  const t = useTranslations("admin.profile");
  const tc = useTranslations("common");
  const tt = useTranslations("common.theme");
  const ta = useTranslations("auth.password");
  const user = useSession();
  const { theme, setTheme } = useTheme();
  const schema = z
    .object({
      currentPassword: z.string().min(1, tc("required")),
      newPassword: z.string().min(8, ta("tooShort")),
      confirm: z.string(),
    })
    .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: ta("mismatch") });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  if (!user) return null;

  return (
    <div className="grid max-w-4xl gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailList
            className="sm:grid-cols-1"
            items={[
              { label: tc("name"), value: user.name },
              { label: tc("email"), value: user.email },
            ]}
          />
          <div>
            <p className="text-sm text-muted-foreground">{t("roles")}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {user.roles.map((r) => (
                <Badge key={r.id} variant="secondary">
                  {r.name}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("preferences")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field>
            <FieldLabel>{t("theme")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v)} className="w-fit">
              <ToggleGroupItem value="light">{tt("light")}</ToggleGroupItem>
              <ToggleGroupItem value="dark">{tt("dark")}</ToggleGroupItem>
              <ToggleGroupItem value="system">{tt("system")}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel>{t("language")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value="en" className="w-fit">
              <ToggleGroupItem value="en">English</ToggleGroupItem>
              <ToggleGroupItem value="si" disabled>
                සිංහල
              </ToggleGroupItem>
              <ToggleGroupItem value="ta" disabled>
                தமிழ்
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>{t("languageSoon")}</FieldDescription>
          </Field>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>{t("password")}</CardTitle>
          <CardDescription>{ta("rules")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="max-w-md"
            onSubmit={form.handleSubmit(async (v) => {
              try {
                await api.post("/auth/change-password", { currentPassword: v.currentPassword, newPassword: v.newPassword });
                toast.success(t("done"));
                form.reset();
              } catch (e) {
                applyServerErrors(e, form.setError);
              }
            })}
          >
            <FieldGroup>
              <Field data-invalid={!!errors.currentPassword}>
                <FieldLabel htmlFor="cur">{t("current")}</FieldLabel>
                <PasswordInput id="cur" autoComplete="current-password" aria-invalid={!!errors.currentPassword} {...form.register("currentPassword")} />
                <FieldError>{errors.currentPassword?.message}</FieldError>
              </Field>
              <Field data-invalid={!!errors.newPassword}>
                <FieldLabel htmlFor="newp">{t("new")}</FieldLabel>
                <PasswordInput id="newp" autoComplete="new-password" aria-invalid={!!errors.newPassword} {...form.register("newPassword")} />
                <FieldError>{errors.newPassword?.message}</FieldError>
              </Field>
              <Field data-invalid={!!errors.confirm}>
                <FieldLabel htmlFor="conf">{t("confirm")}</FieldLabel>
                <PasswordInput id="conf" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register("confirm")} />
                <FieldError>{errors.confirm?.message}</FieldError>
              </Field>
              <Button type="submit" className="w-fit" disabled={isSubmitting}>
                {isSubmitting && <Spinner />} {t("submit")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
