"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, FileCheck2, Phone, UploadCloud } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectItem } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { FloatingDatePicker, FloatingInput, FloatingSelect, FloatingTextarea, PhoneField, SectionLabel } from "@/components/shared/floating-field";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api/client";
import { usePublicSchool } from "@/lib/api/hooks";
import type { ApplicationInput, Grade } from "@whizchool/shared/types";
import { applyServerErrors } from "@/lib/forms";
import { mobileDigits, toInternationalPhone, toLocalPhone } from "@whizchool/shared/phone";
import { formatDate } from "@/lib/format";
import { checkFile, uploadFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";

type DocKind = "birth_certificate" | "photo" | "report";
const DOC_KINDS: DocKind[] = ["birth_certificate", "photo", "report"];
const STEPS = ["student", "guardian", "documents", "review", "done"] as const;

export function ApplyForm() {
  const t = useTranslations("apply");
  const ts = useTranslations("status");
  const [step, setStep] = useState(0);
  const [docs, setDocs] = useState<Partial<Record<DocKind, { name: string; size: number; fileId: string }>>>({});
  const [uploading, setUploading] = useState<DocKind | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [done, setDone] = useState<{ refNo: string; email: string } | null>(null);
  // One key per form instance: a retried or double-clicked submit creates the application once.
  const [idemKey] = useState(newIdempotencyKey);
  const grades = useQuery({ queryKey: ["grades"], queryFn: () => api.get<Grade[]>("/grades"), staleTime: Infinity });
  const school = usePublicSchool();
  const thisYear = new Date().getFullYear();

  const req = z.string().trim().min(1, t("validation.required"));
  const schema = z.object({
    applyingGradeId: req,
    student: z.object({
      firstName: req,
      lastName: req,
      gender: z.enum(["M", "F"], { message: t("validation.required") }),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("validation.dob")),
      religion: z.string().optional(),
      address: req,
      previousSchool: z.string().optional(),
      medicalNotes: z.string().optional(),
    }),
    guardian: z.object({
      name: req,
      relationship: z.enum(["Father", "Mother", "Guardian"]),
      phone: z.string().refine((v) => mobileDigits(v) !== null, t("validation.phone")),
      email: z.email(t("validation.email")),
      nic: z.string().optional(),
      occupation: z.string().optional(),
    }),
    consent: z.literal(true, { message: t("review.consentRequired") }),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      applyingGradeId: "",
      student: { firstName: "", lastName: "", dob: "", address: "", religion: "", previousSchool: "", medicalNotes: "" },
      guardian: { name: "", relationship: "Mother", phone: "", email: "", nic: "", occupation: "" },
      consent: false as unknown as true,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const values = useWatch({ control: form.control }) as Values;
  const gradeName = grades.data?.find((g) => g.id === values.applyingGradeId)?.name;
  const current = done ? STEPS.length - 1 : step;

  const STEP_FIELDS: FieldPath<Values>[][] = [
    ["applyingGradeId", "student.firstName", "student.lastName", "student.gender", "student.dob", "student.address"],
    ["guardian.name", "guardian.relationship", "guardian.phone", "guardian.email"],
    [],
    ["consent"],
  ];

  function go(to: number) {
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function next() {
    if (!(await form.trigger(STEP_FIELDS[step]))) {
      // Mark the step's fields touched so errors clear while typing. Otherwise an error only clears
      // on blur, and the layout shift as it disappears swallows the user's next click on "Next".
      for (const name of STEP_FIELDS[step]) form.setValue(name, form.getValues(name), { shouldTouch: true });
      return;
    }
    if (step === 2 && !docs.birth_certificate) return setDocError(t("documents.birthRequired"));
    go(step + 1);
  }

  async function pickFile(kind: DocKind, file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file, "application-document");
    if (problem) return setDocError(t(`documents.${problem}`, { name: file.name }));
    setDocError(null);
    setUploading(kind);
    try {
      const ref = await uploadFile(file, "application-document");
      setDocs((d) => ({ ...d, [kind]: { name: file.name, size: file.size, fileId: ref.id } }));
    } catch (e) {
      setDocError(errorMessage(e));
    } finally {
      setUploading(null);
    }
  }

  const onSubmit = form.handleSubmit(async (v) => {
    const body: ApplicationInput = {
      applyingGradeId: v.applyingGradeId,
      student: v.student,
      guardian: { ...v.guardian, phone: toLocalPhone(mobileDigits(v.guardian.phone)!) },
      documents: DOC_KINDS.filter((k) => docs[k]).map((k) => ({ ...docs[k]!, kind: k })),
    };
    try {
      setDone(await api.post<{ refNo: string; email: string }>("/applications", body, { idempotencyKey: idemKey }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      if (applyServerErrors(e, form.setError)) go(0);
    }
  });

  const err = (path: FieldPath<Values>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let e: any = errors;
    for (const p of path.split(".")) e = e?.[p];
    return e?.message as string | undefined;
  };
  const input = (path: FieldPath<Values>, label: string, opts: Partial<ComponentProps<typeof FloatingInput>> = {}) => (
    <FloatingInput id={path} label={label} error={err(path)} {...opts} {...form.register(path)} />
  );

  return (
    <div className="rounded-[28px] border bg-card p-2 shadow-[0_30px_80px_-30px_color-mix(in_oklch,var(--primary)_35%,transparent)]">
      <div className="grid overflow-hidden rounded-[22px] md:min-h-[720px] md:grid-cols-[300px_1fr]">
        {/* ---------- Sidebar with stepper ---------- */}
        <aside className="flex flex-col bg-primary/[0.06] p-6 sm:p-8 dark:bg-primary/[0.09]">
          <Logo />
          <h1 className="mt-8 text-2xl font-semibold tracking-tight md:mt-10">{t("sidebar.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("sidebar.body")}</p>

          {/* vertical stepper (tablet & desktop) */}
          <ol className="mt-9 hidden md:block" aria-label={t("stepOf", { step: current + 1, total: STEPS.length })}>
            {STEPS.map((s, i) => {
              const complete = i < current || (done && i === current);
              const active = i === current && !done;
              return (
                <li key={s} className="relative flex gap-4 pb-7 last:pb-0" aria-current={active ? "step" : undefined}>
                  {i < STEPS.length - 1 && (
                    <span aria-hidden className={cn("absolute top-10 bottom-1 left-[17px] w-0.5 rounded-full", i < current ? "bg-primary" : "bg-border")} />
                  )}
                  <span
                    className={cn(
                      "relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                      complete && "bg-primary text-primary-foreground",
                      active && "bg-card text-primary ring-2 ring-primary",
                      !complete && !active && "bg-muted text-muted-foreground",
                    )}
                  >
                    {complete ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="pt-1">
                    <span className={cn("block text-[15px] font-semibold", !complete && !active && "text-muted-foreground")}>{t(`steps.${s}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`stepHints.${s}`)}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {/* compact progress (mobile) */}
          <div className="mt-6 md:hidden">
            <div className="flex gap-1.5">
              {STEPS.map((s, i) => (
                <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= current ? "bg-primary" : "bg-border")} />
              ))}
            </div>
            <p className="mt-2 text-sm font-medium">
              {t("stepOf", { step: current + 1, total: STEPS.length })} · {t(`steps.${STEPS[current]}`)}
            </p>
          </div>

          {school.data && (
            <div className="mt-auto hidden pt-10 md:block">
              <div className="flex items-start gap-3 rounded-2xl border border-primary/15 bg-card/60 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Phone className="size-4" />
                </span>
                <div className="text-sm">
                  <p className="font-medium">{t("sidebar.help")}</p>
                  <p className="text-muted-foreground">{t("sidebar.call", { phone: school.data.phone })}</p>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ---------- Form pane ---------- */}
        <section className="flex flex-col bg-muted/40 p-6 sm:p-10 dark:bg-background/40">
          {done ? (
            <Success done={done} />
          ) : (
            <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
              <div key={step} className="flex-1 animate-in duration-300 fade-in slide-in-from-right-3">
                {step === 0 && (
                  <div className="space-y-9">
                    <div>
                      <SectionLabel>{t("sections.grade")}</SectionLabel>
                      <Controller
                        control={form.control}
                        name="applyingGradeId"
                        render={({ field }) => (
                          <FloatingSelect id="applyingGradeId" label={t("student.grade")} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} error={errors.applyingGradeId?.message} className="sm:max-w-xs">
                            {grades.data?.map((g) => (
                              <SelectItem key={g.id} value={g.id}>
                                {g.name}
                              </SelectItem>
                            ))}
                          </FloatingSelect>
                        )}
                      />
                    </div>
                    <div>
                      <SectionLabel>{t("sections.personal")}</SectionLabel>
                      <div className="grid gap-5 sm:grid-cols-2">
                        {input("student.firstName", t("student.firstName"), { autoComplete: "off" })}
                        {input("student.lastName", t("student.lastName"), { autoComplete: "off" })}
                        <Controller
                          control={form.control}
                          name="student.gender"
                          render={({ field }) => (
                            <FloatingSelect id="student.gender" label={t("student.gender")} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} error={errors.student?.gender?.message}>
                              <SelectItem value="M">{ts("gender.M")}</SelectItem>
                              <SelectItem value="F">{ts("gender.F")}</SelectItem>
                            </FloatingSelect>
                          )}
                        />
                        <Controller
                          control={form.control}
                          name="student.dob"
                          render={({ field }) => (
                            <FloatingDatePicker
                              id="student.dob"
                              label={t("student.dob")}
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              error={errors.student?.dob?.message}
                              fromYear={thisYear - 20}
                              toYear={thisYear - 3}
                            />
                          )}
                        />
                      </div>
                    </div>
                    <div>
                      <SectionLabel>{t("sections.address")}</SectionLabel>
                      {input("student.address", t("student.address"), { autoComplete: "street-address" })}
                    </div>
                    <div>
                      <SectionLabel>{t("sections.background")}</SectionLabel>
                      <div className="grid gap-5 sm:grid-cols-2">
                        {input("student.religion", t("student.religion"))}
                        {input("student.previousSchool", t("student.previousSchool"))}
                        <FloatingTextarea
                          id="student.medicalNotes"
                          label={t("student.medical")}
                          help={t("help.medical")}
                          className="sm:col-span-2"
                          rows={3}
                          {...form.register("student.medicalNotes")}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-9">
                    <div>
                      <SectionLabel>{t("sections.guardian")}</SectionLabel>
                      <div className="grid gap-5 sm:grid-cols-2">
                        {input("guardian.name", t("guardian.name"), { autoComplete: "name", hint: t("guardian.namePlaceholder") })}
                        <Controller
                          control={form.control}
                          name="guardian.relationship"
                          render={({ field }) => (
                            <FloatingSelect id="guardian.relationship" label={t("guardian.relationship")} value={field.value} onValueChange={field.onChange}>
                              {(["Mother", "Father", "Guardian"] as const).map((r) => (
                                <SelectItem key={r} value={r}>
                                  {ts(`relationship.${r}`)}
                                </SelectItem>
                              ))}
                            </FloatingSelect>
                          )}
                        />
                      </div>
                    </div>
                    <div>
                      <SectionLabel>{t("sections.contact")}</SectionLabel>
                      <div className="grid max-w-xl gap-5">
                        <PhoneField
                          id="guardian.phone"
                          code={t("guardian.countryCode")}
                          label={t("guardian.phone")}
                          autoComplete="tel-national"
                          error={err("guardian.phone")}
                          help={t("help.phone")}
                          {...form.register("guardian.phone")}
                        />
                        {input("guardian.email", t("guardian.email"), { type: "email", autoComplete: "email", help: t("help.email") })}
                      </div>
                    </div>
                    <div>
                      <SectionLabel>{t("sections.more")}</SectionLabel>
                      <div className="grid gap-5 sm:grid-cols-2">
                        {input("guardian.nic", t("guardian.nic"), { help: t("help.nic") })}
                        {input("guardian.occupation", t("guardian.occupation"))}
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div>
                    <SectionLabel>{t("sections.documents")}</SectionLabel>
                    <div className="grid gap-4 sm:grid-cols-3">
                      {DOC_KINDS.map((kind) => {
                        const file = docs[kind];
                        const busy = uploading === kind;
                        return (
                          <label
                            key={kind}
                            className={cn(
                              "group relative flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed bg-card px-4 py-7 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.03] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30",
                              file && "border-solid border-primary/40 bg-primary/[0.04]",
                            )}
                          >
                            <span className="absolute top-3 right-3 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {kind === "birth_certificate" ? t("documents.required") : t("documents.optional")}
                            </span>
                            <span className={cn("flex size-12 items-center justify-center rounded-full", file ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                              {busy ? <Spinner className="size-5" /> : file ? <FileCheck2 className="size-5" /> : <UploadCloud className="size-5" />}
                            </span>
                            <span className="mt-4 text-sm font-semibold">{t(`documents.${kind}`)}</span>
                            <span className="mt-1 max-w-full truncate text-xs text-muted-foreground">
                              {busy ? t("documents.uploading") : file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : t("documents.upload")}
                            </span>
                            {file && <span className="mt-3 text-xs font-medium text-primary">{t("documents.replace")}</span>}
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png,.webp"
                              className="sr-only"
                              disabled={uploading !== null}
                              onChange={(e) => {
                                pickFile(kind, e.target.files?.[0]);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">{t("documents.formats")}</p>
                    {docError && (
                      <p role="alert" className="mt-3 text-sm text-destructive">
                        {docError}
                      </p>
                    )}
                  </div>
                )}

                {step === 3 && (
                  <div>
                    <SectionLabel>{t("sections.review")}</SectionLabel>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <ReviewCard title={t("steps.student")} onEdit={() => go(0)} editLabel={t("review.edit")}>
                        <Row label={t("student.grade")} value={gradeName} />
                        <Row label={t("student.firstName")} value={`${values.student.firstName} ${values.student.lastName}`} />
                        <Row label={t("student.gender")} value={values.student.gender ? ts(`gender.${values.student.gender}`) : ""} />
                        <Row label={t("student.dob")} value={values.student.dob ? formatDate(values.student.dob) : ""} />
                        <Row label={t("student.address")} value={values.student.address} />
                        <Row label={t("student.previousSchool")} value={values.student.previousSchool} />
                      </ReviewCard>
                      <ReviewCard title={t("steps.guardian")} onEdit={() => go(1)} editLabel={t("review.edit")}>
                        <Row label={t("guardian.name")} value={`${values.guardian.name} (${ts(`relationship.${values.guardian.relationship}`)})`} />
                        <Row label={t("guardian.phone")} value={mobileDigits(values.guardian.phone ?? "") ? toInternationalPhone(mobileDigits(values.guardian.phone)!) : ""} />
                        <Row label={t("guardian.email")} value={values.guardian.email} />
                        <Row label={t("guardian.nic")} value={values.guardian.nic} />
                      </ReviewCard>
                      <ReviewCard title={t("steps.documents")} onEdit={() => go(2)} editLabel={t("review.edit")} className="lg:col-span-2">
                        {DOC_KINDS.filter((k) => docs[k]).map((k) => (
                          <Row key={k} label={t(`documents.${k}`)} value={docs[k]!.name} />
                        ))}
                      </ReviewCard>
                    </div>
                    <label
                      className={cn(
                        "mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border bg-card p-4 text-sm",
                        errors.consent && "border-destructive",
                      )}
                    >
                      <Controller
                        control={form.control}
                        name="consent"
                        render={({ field }) => (
                          <Checkbox id="consent" className="mt-0.5" checked={!!field.value} onCheckedChange={(c) => field.onChange(c === true)} aria-invalid={!!errors.consent} />
                        )}
                      />
                      <span>{t("review.consent")}</span>
                    </label>
                    {errors.consent && <p className="mt-1.5 px-1 text-xs text-destructive">{errors.consent.message}</p>}
                  </div>
                )}
              </div>

              <div className="mt-10 border-t pt-6">
                <div className="flex items-center justify-between gap-3">
                  {step > 0 ? (
                    <Button type="button" variant="ghost" className="rounded-full" onClick={() => go(step - 1)} disabled={isSubmitting}>
                      <ArrowLeft /> {t("back")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  {step < 3 ? (
                    <Button type="button" size="lg" className="h-11 rounded-full px-8 text-[15px]" onClick={next} disabled={uploading !== null}>
                      {t("next")} <ArrowRight />
                    </Button>
                  ) : (
                    <Button type="submit" size="lg" className="h-11 rounded-full px-8 text-[15px]" disabled={isSubmitting}>
                      {isSubmitting && <Spinner />}
                      {isSubmitting ? t("submitting") : t("submit")}
                    </Button>
                  )}
                </div>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function Success({ done }: { done: { refNo: string; email: string } }) {
  const t = useTranslations("apply");
  return (
    <div className="flex flex-1 animate-in flex-col justify-center duration-500 fade-in zoom-in-95" role="status">
      <span className="flex size-16 items-center justify-center rounded-full bg-success/12 text-success">
        <CheckCircle2 className="size-8" />
      </span>
      <h2 className="mt-6 text-3xl font-semibold tracking-tight">{t("success.title")}</h2>
      <p className="mt-3 max-w-lg text-muted-foreground">{t("success.body", done)}</p>
      <div className="mt-6 w-fit rounded-2xl border bg-card px-5 py-4">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{t("status.refNo")}</p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-wide">{done.refNo}</p>
      </div>
      <SectionLabel className="mt-8">{t("success.next")}</SectionLabel>
      <ol className="space-y-3">
        {(["one", "two", "three"] as const).map((k, i) => (
          <li key={k} className="flex items-center gap-3 text-sm">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
            {t(`success.steps.${k}`)}
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap gap-3 border-t pt-6">
        <Button asChild size="lg" className="h-11 rounded-full px-7">
          <Link href={`/apply/status?ref=${done.refNo}`}>{t("success.status")}</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-11 rounded-full px-7">
          <Link href="/">{t("success.home")}</Link>
        </Button>
      </div>
    </div>
  );
}

function ReviewCard({ title, onEdit, editLabel, children, className }: { title: string; onEdit: () => void; editLabel: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card", className)}>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onEdit}>
          {editLabel}
        </Button>
      </div>
      <dl className="divide-y text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-5 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
