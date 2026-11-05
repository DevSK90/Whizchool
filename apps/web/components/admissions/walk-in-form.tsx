"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { CheckCircle2, FileCheck2, Printer, UploadCloud } from "lucide-react";
import type { ApplicationInput } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { FilterSelect } from "@/components/shared/filters";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api/client";
import { useGrades, usePublicSchool } from "@/lib/api/hooks";
import { applyServerErrors } from "@/lib/forms";
import { checkFile, uploadFile } from "@/lib/uploads";

type DocKind = "birth_certificate" | "photo" | "report";
const DOC_KINDS: DocKind[] = ["birth_certificate", "photo", "report"];

interface Saved {
  id: string;
  refNo: string;
  phone: string;
  email?: string;
  notified: boolean;
}

/** The office's form for a parent at the school. Unlike the public form, email and documents can come later. */
export function WalkInForm() {
  const t = useTranslations("admissions.walkIn");
  const ta = useTranslations("apply");
  const ts = useTranslations("status");
  const tc = useTranslations("common");
  const grades = useGrades();
  const [saved, setSaved] = useState<(Saved & { studentName: string }) | null>(null);
  const [idemKey] = useState(newIdempotencyKey);
  const [docs, setDocs] = useState<Partial<Record<DocKind, { name: string; size: number; fileId: string }>>>({});
  const [uploading, setUploading] = useState<DocKind | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const req = z.string().trim().min(1, tc("required"));
  const schema = z.object({
    applyingGradeId: req,
    student: z.object({
      firstName: req,
      lastName: req,
      gender: req,
      dob: req,
      religion: z.string(),
      address: req,
      previousSchool: z.string(),
      medicalNotes: z.string(),
    }),
    guardian: z.object({
      name: req,
      relationship: req,
      phone: req,
      email: z.union([z.literal(""), z.email(ta("validation.email"))]),
      nic: z.string(),
      occupation: z.string(),
    }),
    consent: z.literal(true, { message: t("consentRequired") }),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      applyingGradeId: "",
      student: { firstName: "", lastName: "", gender: "", dob: "", religion: "", address: "", previousSchool: "", medicalNotes: "" },
      guardian: { name: "", relationship: "Mother", phone: "", email: "", nic: "", occupation: "" },
      consent: false as unknown as true,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const thisYear = new Date().getFullYear();

  async function pickFile(kind: DocKind, file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file, "application-document");
    if (problem) return setDocError(ta(`documents.${problem}`, { name: file.name }));
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

  const submit = form.handleSubmit(async (v) => {
    const body = {
      applyingGradeId: v.applyingGradeId,
      student: v.student,
      guardian: v.guardian,
      documents: DOC_KINDS.filter((k) => docs[k]).map((k) => ({ ...docs[k]!, kind: k })),
    } as ApplicationInput;
    try {
      const result = await api.post<Saved>("/applications/walk-in", body, { idempotencyKey: idemKey });
      setSaved({ ...result, studentName: `${v.student.firstName} ${v.student.lastName}` });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      applyServerErrors(e, form.setError);
    }
  });

  if (saved) return <TrackingSlip saved={saved} />;

  const text = (name: "student.firstName" | "student.lastName" | "student.address" | "student.religion" | "student.previousSchool" | "guardian.name" | "guardian.phone" | "guardian.email" | "guardian.nic" | "guardian.occupation", label: string, hint?: string, type?: string) => {
    const [group, key] = name.split(".") as ["student" | "guardian", string];
    const error = (errors[group] as Record<string, { message?: string }> | undefined)?.[key]?.message;
    return (
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={name}>{label}</FieldLabel>
        <Input id={name} type={type} aria-invalid={!!error} {...form.register(name)} />
        {hint && <FieldDescription>{hint}</FieldDescription>}
        <FieldError>{error}</FieldError>
      </Field>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("student")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field data-invalid={!!errors.applyingGradeId}>
                <FieldLabel>{t("grade")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="applyingGradeId"
                  render={({ field }) => (
                    <FilterSelect ariaLabel={t("grade")} value={field.value} onChange={field.onChange} allLabel={tc("selectPlaceholder")} options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))} className="sm:w-full" />
                  )}
                />
                <FieldError>{errors.applyingGradeId?.message}</FieldError>
              </Field>
              {text("student.firstName", t("firstName"))}
              {text("student.lastName", t("lastName"))}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field data-invalid={!!errors.student?.gender}>
                <FieldLabel>{t("gender")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="student.gender"
                  render={({ field }) => (
                    <FilterSelect ariaLabel={t("gender")} value={field.value} onChange={field.onChange} allLabel={tc("selectPlaceholder")} options={[{ value: "M", label: ts("gender.M") }, { value: "F", label: ts("gender.F") }]} className="sm:w-full" />
                  )}
                />
                <FieldError>{errors.student?.gender?.message}</FieldError>
              </Field>
              <Field data-invalid={!!errors.student?.dob}>
                <FieldLabel htmlFor="student.dob">{t("dob")}</FieldLabel>
                <Controller control={form.control} name="student.dob" render={({ field }) => <DatePicker id="student.dob" value={field.value} onChange={field.onChange} invalid={!!errors.student?.dob} fromYear={thisYear - 20} toYear={thisYear - 3} />} />
                <FieldError>{errors.student?.dob?.message}</FieldError>
              </Field>
              {text("student.religion", t("religion"))}
            </div>
            {text("student.address", t("address"))}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("student.previousSchool", t("previousSchool"))}
              <Field>
                <FieldLabel htmlFor="medicalNotes">{t("medical")}</FieldLabel>
                <Textarea id="medicalNotes" rows={2} {...form.register("student.medicalNotes")} />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("guardian")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("guardian.name", t("guardianName"))}
              <Field>
                <FieldLabel>{t("relationship")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="guardian.relationship"
                  render={({ field }) => <FilterSelect ariaLabel={t("relationship")} value={field.value} onChange={field.onChange} options={(["Mother", "Father", "Guardian"] as const).map((r) => ({ value: r, label: ts(`relationship.${r}`) }))} className="sm:w-full" />}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("guardian.phone", t("phone"), t("phoneHint"), "tel")}
              {text("guardian.email", t("email"), t("emailHint"), "email")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("guardian.nic", t("nic"))}
              {text("guardian.occupation", t("occupation"))}
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("documents")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("documentsHint")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {DOC_KINDS.map((kind) => {
              const file = docs[kind];
              return (
                <label key={kind} className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 text-sm hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  {uploading === kind ? <Spinner /> : file ? <FileCheck2 className="size-4 shrink-0 text-success" /> : <UploadCloud className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0">
                    <span className="block font-medium">{ta(`documents.${kind}`)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{file ? file.name : ta("documents.upload")}</span>
                  </span>
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
          {docError && (
            <p role="alert" className="text-sm text-destructive">
              {docError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Field orientation="horizontal" data-invalid={!!errors.consent}>
            <Controller control={form.control} name="consent" render={({ field }) => <Checkbox id="consent" checked={!!field.value} onCheckedChange={(c) => field.onChange(c === true)} aria-invalid={!!errors.consent} />} />
            <div>
              <FieldLabel htmlFor="consent" className="font-normal">
                {t("consent")}
              </FieldLabel>
              <FieldError>{errors.consent?.message}</FieldError>
            </div>
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={isSubmitting || uploading !== null}>
          {isSubmitting && <Spinner />}
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}

/** Handed or read to the parent; the same details also go by SMS where the phone can receive one. */
function TrackingSlip({ saved }: { saved: Saved & { studentName: string } }) {
  const t = useTranslations("admissions.walkIn");
  const school = usePublicSchool();
  const statusPage = typeof window === "undefined" ? "/apply/status" : `${window.location.origin}/apply/status`;
  return (
    <Card role="status">
      <CardContent className="space-y-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="no-print size-8 shrink-0 text-success" />
          <div>
            <h2 className="text-lg font-semibold">{school.data?.name ?? t("savedTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("savedFor", { name: saved.studentName })}</p>
          </div>
        </div>
        <div className="w-fit rounded-xl border px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">{t("trackingNo")}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-wide">{saved.refNo}</p>
        </div>
        <p className="text-sm">{t("trackHow", { url: statusPage, contact: saved.phone })}</p>
        <p className="no-print text-sm text-muted-foreground">{saved.notified ? t("sent") : t("notSent")}</p>
        <div className="no-print flex flex-wrap gap-2">
          <Button onClick={() => window.print()}>
            <Printer /> {t("print")}
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/app/admissions/${saved.id}`}>{t("open")}</Link>
          </Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            {t("another")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
