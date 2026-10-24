"use client";

// Based on the shadcn/ui "login-04" block: two-column card with the form on the left and an image panel on the right.
// Adapted for Whizchool: email + password only (accounts are created by invitation), brand panel instead of an image.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { BellRing, FileText, Info, Wallet } from "lucide-react";
import { cn } from "cn";
import { LogoMark } from "@/components/brand/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PasswordInput } from "@/components/shared/password-input";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import type { SessionUser } from "@/lib/api/types";
import { homeFor, safeNext } from "@/lib/auth";

const POINTS = [
  { key: "results", icon: FileText },
  { key: "attendance", icon: BellRing },
  { key: "fees", icon: Wallet },
] as const;

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const t = useTranslations("auth");
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const schema = z.object({
    email: z.email(t("validation.email")),
    password: z.string().min(1, t("validation.passwordRequired")),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const user = await api.post<SessionUser>("/auth/login", values);
      qc.clear();
      qc.setQueryData(["auth", "me"], user);
      const next = safeNext(params.get("next"));
      router.replace(
        next && next.startsWith(homeFor(user)) ? next : homeFor(user),
      );
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof ApiError ? error.message : errorMessage(error),
      });
    }
  });

  return (
    <div data-wide className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:min-h-[580px] md:grid-cols-2">
          <form
            className="flex flex-col justify-center p-6 sm:p-10 md:p-12 [&_[data-slot=input-group]]:h-11 [&_[data-slot=input]]:h-11 [&_input]:text-base [&_label]:text-[15px]"
            onSubmit={onSubmit}
            noValidate
          >
            <FieldGroup className="gap-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <LogoMark className="mb-1 size-11 md:hidden" />
                <h1 className="text-3xl font-bold tracking-tight">
                  {t("login.title")}
                </h1>
                <p className="text-base text-balance text-muted-foreground">
                  {t("login.subtitle")}
                </p>
              </div>
              {params.get("expired") && !errors.root && (
                <Alert>
                  <Info />
                  <AlertDescription>
                    {t("login.sessionExpired")}
                  </AlertDescription>
                </Alert>
              )}
              {errors.root && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="email">{t("login.email")}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder={t("login.emailPlaceholder")}
                  aria-invalid={!!errors.email}
                  {...form.register("email")}
                />
                <FieldError>{errors.email?.message}</FieldError>
              </Field>
              <Field data-invalid={!!errors.password}>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">
                    {t("login.password")}
                  </FieldLabel>
                  <Link
                    href="/forgot-password"
                    className="ml-auto text-sm underline-offset-2 hover:underline"
                  >
                    {t("login.forgot")}
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  {...form.register("password")}
                />
                <FieldError>{errors.password?.message}</FieldError>
              </Field>
              <Field>
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 text-base"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Spinner />}
                  {isSubmitting ? t("login.submitting") : t("login.submit")}
                </Button>
              </Field>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card" />
              <FieldDescription className="text-center">
                {t("login.noAccount")}{" "}
                <Link href="/apply" className="whitespace-nowrap">
                  {t("login.applyLink")}
                </Link>
              </FieldDescription>
            </FieldGroup>
          </form>

          {/* Brand panel in place of the block's image */}
          <div className="relative hidden overflow-hidden bg-[#05071a] text-white md:block">
            <div
              aria-hidden
              className="absolute -top-24 -right-16 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(79,91,255,0.6),transparent)] blur-2xl"
            />
            <div
              aria-hidden
              className="absolute -bottom-28 -left-16 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(47,140,255,0.4),transparent)] blur-2xl"
            />
            <div
              aria-hidden
              className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_70%_10%,black,transparent_70%)]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
                backgroundSize: "36px 36px",
              }}
            />
            <div className="relative flex h-full flex-col justify-between p-10 lg:p-12">
              <div className="flex items-center gap-2.5">
                <LogoMark className="size-10" />
                <span className="text-lg font-semibold tracking-tight">
                  Whizchool
                </span>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-white/50 uppercase">
                  {t("login.panelEyebrow")}
                </p>
                <p className="mt-3 text-4xl leading-tight font-semibold text-balance">
                  <span className="bg-gradient-to-r from-[#c7cdff] via-[#8b93ff] to-[#66b6ff] bg-clip-text text-transparent">
                    {t("login.panelTitle")}
                  </span>
                </p>
                <ul className="mt-8 space-y-4">
                  {POINTS.map(({ key, icon: Icon }) => (
                    <li
                      key={key}
                      className="flex items-center gap-3.5 text-base text-white/80"
                    >
                      <span className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-[#aab1ff]">
                        <Icon className="size-5" />
                      </span>
                      {t(`login.panelPoints.${key}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* <FieldDescription className="px-6 text-center">{t("login.terms")}</FieldDescription> */}
    </div>
  );
}
