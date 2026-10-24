"use client";

import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useClasses, useDiscounts, useSubjects } from "@/lib/api/hooks";
import type { StudentDetail } from "@/lib/api/types";
import { applyServerErrors } from "@/lib/forms";
import { DatePicker } from "@/components/shared/date-picker";

const PHONE = /^0\d{2}\s?\d{3}\s?\d{4}$/;

export type StudentFormValues = {
  firstName: string;
  lastName: string;
  gender: "M" | "F";
  dob: string;
  religion?: string;
  address: string;
  classId: string;
  electiveSubjectIds: string[];
  discountIds: string[];
  medical: { bloodGroup?: string; allergies?: string; conditions?: string };
  guardian?: { name: string; relationship: "Father" | "Mother" | "Guardian"; phone: string; email?: string };
  inviteParent?: boolean;
};

export function StudentForm({
  student,
  submitLabel,
  onSubmit,
}: {
  student?: StudentDetail;
  submitLabel: string;
  onSubmit: (values: StudentFormValues) => Promise<void>;
}) {
  const t = useTranslations("students.form");
  const tc = useTranslations("common");
  const ts = useTranslations("status");
  const classes = useClasses();
  const subjects = useSubjects();
  const discounts = useDiscounts();
  const isNew = !student;

  const req = z.string().trim().min(1, tc("required"));
  const schema = z.object({
    firstName: req,
    lastName: req,
    gender: z.enum(["M", "F"], { message: tc("required") }),
    dob: req,
    religion: z.string().optional(),
    address: req,
    classId: req,
    electiveSubjectIds: z.array(z.string()),
    discountIds: z.array(z.string()),
    medical: z.object({ bloodGroup: z.string().optional(), allergies: z.string().optional(), conditions: z.string().optional() }),
    guardian: isNew
      ? z.object({
          name: req,
          relationship: z.enum(["Father", "Mother", "Guardian"]),
          phone: z.string().regex(PHONE, "e.g. 077 123 4567"),
          email: z.union([z.email(), z.literal("")]).optional(),
        })
      : z.any().optional(),
    inviteParent: z.boolean().optional(),
  });

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: student
      ? {
          firstName: student.firstName,
          lastName: student.lastName,
          gender: student.gender,
          dob: student.dob,
          religion: student.religion ?? "",
          address: student.address,
          classId: student.classId,
          electiveSubjectIds: student.electiveSubjectIds,
          discountIds: student.discountIds,
          medical: { bloodGroup: student.medical?.bloodGroup ?? "", allergies: student.medical?.allergies ?? "", conditions: student.medical?.conditions ?? "" },
        }
      : {
          firstName: "",
          lastName: "",
          dob: "",
          religion: "",
          address: "",
          classId: "",
          electiveSubjectIds: [],
          discountIds: [],
          medical: {},
          guardian: { name: "", relationship: "Mother", phone: "", email: "" },
          inviteParent: true,
        },
  });
  const { errors, isSubmitting } = form.formState;
  const classId = useWatch({ control: form.control, name: "classId" });
  const cls = classes.data?.find((c) => c.id === classId);
  const isOL = cls ? cls.gradeNumber === 10 || cls.gradeNumber === 11 : false;
  const baskets = ([1, 2, 3] as const).map((n) => ({ n, subjects: subjects.data?.filter((s) => s.basket === n && s.levels.includes("ol")) ?? [] }));

  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit(v);
    } catch (e) {
      applyServerErrors(e, form.setError);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("student")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.firstName}>
                <FieldLabel htmlFor="firstName">{t("firstName")}</FieldLabel>
                <Input id="firstName" aria-invalid={!!errors.firstName} {...form.register("firstName")} />
                <FieldError>{errors.firstName?.message}</FieldError>
              </Field>
              <Field data-invalid={!!errors.lastName}>
                <FieldLabel htmlFor="lastName">{t("lastName")}</FieldLabel>
                <Input id="lastName" aria-invalid={!!errors.lastName} {...form.register("lastName")} />
                <FieldError>{errors.lastName?.message}</FieldError>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field data-invalid={!!errors.gender}>
                <FieldLabel>{t("gender")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full" aria-invalid={!!errors.gender}>
                        <SelectValue placeholder={tc("selectPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="M">{ts("gender.M")}</SelectItem>
                        <SelectItem value="F">{ts("gender.F")}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{errors.gender?.message}</FieldError>
              </Field>
              <Field data-invalid={!!errors.dob}>
                <FieldLabel htmlFor="dob">{t("dob")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="dob"
                  render={({ field }) => (
                    <DatePicker
                      id="dob"
                      value={field.value}
                      onChange={field.onChange}
                      invalid={!!errors.dob}
                      fromYear={new Date().getFullYear() - 22}
                      toYear={new Date().getFullYear() - 3}
                    />
                  )}
                />
                <FieldError>{errors.dob?.message}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="religion">{t("religion")}</FieldLabel>
                <Input id="religion" {...form.register("religion")} />
              </Field>
            </div>
            <Field data-invalid={!!errors.address}>
              <FieldLabel htmlFor="address">{t("address")}</FieldLabel>
              <Input id="address" aria-invalid={!!errors.address} {...form.register("address")} />
              <FieldError>{errors.address?.message}</FieldError>
            </Field>
            <Field data-invalid={!!errors.classId}>
              <FieldLabel>{t("class")}</FieldLabel>
              <Controller
                control={form.control}
                name="classId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full sm:w-60" aria-invalid={!!errors.classId}>
                      <SelectValue placeholder={tc("selectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.streamName ? ` · ${c.streamName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{errors.classId?.message}</FieldError>
            </Field>
            {isOL && (
              <FieldSet>
                <FieldLegend variant="label">{t("electives")}</FieldLegend>
                <div className="grid gap-4 sm:grid-cols-3">
                  {baskets.map(({ n, subjects: options }) => (
                    <Controller
                      key={n}
                      control={form.control}
                      name="electiveSubjectIds"
                      render={({ field }) => {
                        const current = field.value.find((id) => options.some((o) => o.id === id)) ?? "";
                        return (
                          <Field>
                            <FieldLabel>{t("basket", { n })}</FieldLabel>
                            <Select
                              value={current}
                              onValueChange={(v) => field.onChange([...field.value.filter((id) => !options.some((o) => o.id === id)), v])}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder={tc("selectPlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                {options.map((o) => (
                                  <SelectItem key={o.id} value={o.id}>
                                    {o.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        );
                      }}
                    />
                  ))}
                </div>
              </FieldSet>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("medical")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="blood">{t("bloodGroup")}</FieldLabel>
              <Input id="blood" {...form.register("medical.bloodGroup")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="allergies">{t("allergies")}</FieldLabel>
              <Input id="allergies" {...form.register("medical.allergies")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="conditions">{t("conditions")}</FieldLabel>
              <Input id="conditions" {...form.register("medical.conditions")} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("discounts")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Controller
            control={form.control}
            name="discountIds"
            render={({ field }) => (
              <div className="grid gap-3 sm:grid-cols-2">
                {discounts.data?.map((d) => (
                  <Field key={d.id} orientation="horizontal">
                    <Checkbox
                      id={d.id}
                      checked={field.value.includes(d.id)}
                      onCheckedChange={(c) => field.onChange(c ? [...field.value, d.id] : field.value.filter((x) => x !== d.id))}
                    />
                    <FieldLabel htmlFor={d.id} className="font-normal">
                      {d.name} ({d.kind === "percent" ? `${d.value}%` : d.value})
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            )}
          />
        </CardContent>
      </Card>

      {isNew && (
        <Card>
          <CardHeader>
            <CardTitle>{t("guardian")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.guardian?.name}>
                  <FieldLabel htmlFor="gname">{t("guardianName")}</FieldLabel>
                  <Input id="gname" aria-invalid={!!errors.guardian?.name} {...form.register("guardian.name")} />
                  <FieldError>{errors.guardian?.name?.message}</FieldError>
                </Field>
                <Field>
                  <FieldLabel>{t("relationship")}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="guardian.relationship"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["Mother", "Father", "Guardian"] as const).map((r) => (
                            <SelectItem key={r} value={r}>
                              {ts(`relationship.${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.guardian?.phone}>
                  <FieldLabel htmlFor="gphone">{t("phone")}</FieldLabel>
                  <Input id="gphone" type="tel" placeholder="077 123 4567" aria-invalid={!!errors.guardian?.phone} {...form.register("guardian.phone")} />
                  <FieldError>{errors.guardian?.phone?.message}</FieldError>
                </Field>
                <Field data-invalid={!!errors.guardian?.email}>
                  <FieldLabel htmlFor="gemail">{t("email")}</FieldLabel>
                  <Input id="gemail" type="email" aria-invalid={!!errors.guardian?.email} {...form.register("guardian.email")} />
                  <FieldError>{errors.guardian?.email?.message}</FieldError>
                </Field>
              </div>
              <Field orientation="horizontal">
                <Controller
                  control={form.control}
                  name="inviteParent"
                  render={({ field }) => <Checkbox id="invite" checked={!!field.value} onCheckedChange={(c) => field.onChange(c === true)} />}
                />
                <div>
                  <FieldLabel htmlFor="invite" className="font-normal">
                    {t("invite")}
                  </FieldLabel>
                  <FieldDescription>{t("inviteHint")}</FieldDescription>
                </div>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
