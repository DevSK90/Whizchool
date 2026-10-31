"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { STAFF_TITLES, untitledName } from "@whizchool/shared/staff";
import type { StaffDetail } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { FilterSelect } from "@/components/shared/filters";
import { useRoles } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";
import { applyServerErrors } from "@/lib/forms";

export type StaffFormValues = {
  title: string;
  name: string;
  staffType: string;
  designation: string;
  phone: string;
  email: string;
  gender: string;
  dob: string;
  nic: string;
  address: string;
  joinedOn: string;
  qualifications: string;
  emergencyName: string;
  emergencyPhone: string;
  notes: string;
  login?: { roleIds: string[] };
};

/** Names the roles a new login can hold; shared with the profile page's "Give login" dialog. */
export function LoginRoles({ value, onChange, error }: { value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const t = useTranslations("staff.form");
  const roles = useRoles();
  return (
    <Field data-invalid={!!error}>
      <FieldLabel>{t("roles")}</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-3">
        {roles.data
          ?.filter((r) => r.scope !== "own_children")
          .map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={value.includes(r.id)} onCheckedChange={(c) => onChange(c ? [...value, r.id] : value.filter((id) => id !== r.id))} />
              {r.name}
            </label>
          ))}
      </div>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function StaffForm({ staff, submitLabel, onSubmit }: { staff?: StaffDetail; submitLabel: string; onSubmit: (values: StaffFormValues) => Promise<void> }) {
  const t = useTranslations("staff");
  const tf = useTranslations("staff.form");
  const tc = useTranslations("common");
  const ts = useTranslations("status");
  const can = useCan();
  const [withLogin, setWithLogin] = useState(false);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [rolesError, setRolesError] = useState<string>();
  const req = z.string().trim().min(1, tc("required"));
  const schema = z.looseObject({ name: req, designation: req, staffType: req, phone: req, joinedOn: req });

  const form = useForm<StaffFormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      title: staff?.title ?? "",
      name: staff ? untitledName(staff.title, staff.name) : "",
      staffType: staff?.staffType ?? "",
      designation: staff?.designation ?? "",
      phone: staff?.phone ?? "",
      email: staff?.email ?? "",
      gender: staff?.gender ?? "",
      dob: staff?.dob ?? "",
      nic: staff?.nic ?? "",
      address: staff?.address ?? "",
      joinedOn: staff?.joinedOn ?? "",
      qualifications: staff?.qualifications ?? "",
      emergencyName: staff?.emergencyName ?? "",
      emergencyPhone: staff?.emergencyPhone ?? "",
      notes: staff?.notes ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const canGiveLogin = !staff && can("users.create");

  const submit = form.handleSubmit(async (v) => {
    if (withLogin && !roleIds.length) {
      setRolesError(tf("chooseRole"));
      return;
    }
    setRolesError(undefined);
    try {
      await onSubmit(withLogin ? { ...v, login: { roleIds } } : v);
    } catch (e) {
      applyServerErrors(e, form.setError);
    }
  });

  const text = (key: "name" | "designation" | "phone" | "email" | "nic" | "address" | "emergencyName" | "emergencyPhone", label: string, extra?: { type?: string; placeholder?: string; disabled?: boolean; hint?: string }) => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel htmlFor={key}>{label}</FieldLabel>
      <Input id={key} type={extra?.type} placeholder={extra?.placeholder} disabled={extra?.disabled} aria-invalid={!!errors[key]} {...form.register(key)} />
      {extra?.hint && <FieldDescription>{extra.hint}</FieldDescription>}
      <FieldError>{errors[key]?.message}</FieldError>
    </Field>
  );
  const area = (key: "qualifications" | "notes", label: string) => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel htmlFor={key}>{label}</FieldLabel>
      <Textarea id={key} rows={3} aria-invalid={!!errors[key]} {...form.register(key)} />
      <FieldError>{errors[key]?.message}</FieldError>
    </Field>
  );
  const date = (key: "dob" | "joinedOn", label: string, fromYear: number, toYear: number) => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel htmlFor={key}>{label}</FieldLabel>
      <Controller control={form.control} name={key} render={({ field }) => <DatePicker id={key} value={field.value} onChange={field.onChange} invalid={!!errors[key]} fromYear={fromYear} toYear={toYear} />} />
      <FieldError>{errors[key]?.message}</FieldError>
    </Field>
  );
  const select = (key: "title" | "gender" | "staffType", label: string, options: { value: string; label: string }[], allLabel?: string) => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel>{label}</FieldLabel>
      <Controller control={form.control} name={key} render={({ field }) => <FilterSelect ariaLabel={label} value={field.value} onChange={field.onChange} allLabel={allLabel} options={options} className="sm:w-full" />} />
      <FieldError>{errors[key]?.message}</FieldError>
    </Field>
  );
  const year = new Date().getFullYear();

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{tf("personal")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-4">
              {select("title", tf("titleField"), STAFF_TITLES.map((v) => ({ value: v, label: v })), tc("none"))}
              <div className="sm:col-span-3">{text("name", tf("name"))}</div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {select("gender", tf("gender"), [{ value: "M", label: ts("gender.M") }, { value: "F", label: ts("gender.F") }], tc("selectPlaceholder"))}
              {date("dob", tf("dob"), year - 80, year - 15)}
              {text("nic", tf("nic"), { placeholder: "851234567V" })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("phone", tf("phone"), { type: "tel", placeholder: "077 123 4567" })}
              {text("email", tf("email"), { type: "email", disabled: !!staff?.userId, hint: staff?.userId ? tf("emailLocked") : tf("emailHint") })}
            </div>
            {text("address", tf("address"))}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tf("employment")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              {select("staffType", tf("type"), (["academic", "non_academic"] as const).map((v) => ({ value: v, label: t(`types.${v}`) })), tc("selectPlaceholder"))}
              {text("designation", tf("designation"), { placeholder: tf("designationPlaceholder") })}
              {date("joinedOn", tf("joinedOn"), year - 50, year + 1)}
            </div>
            {area("qualifications", tf("qualifications"))}
            {area("notes", tf("notes"))}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tf("emergency")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("emergencyName", tf("emergencyName"))}
            {text("emergencyPhone", tf("emergencyPhone"), { type: "tel", placeholder: "077 123 4567" })}
          </div>
        </CardContent>
      </Card>

      {canGiveLogin && (
        <Card>
          <CardHeader>
            <CardTitle>{tf("login")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox id="withLogin" checked={withLogin} onCheckedChange={(c) => setWithLogin(c === true)} />
                <div>
                  <FieldLabel htmlFor="withLogin" className="font-normal">
                    {tf("giveLogin")}
                  </FieldLabel>
                  <FieldDescription>{tf("giveLoginHint")}</FieldDescription>
                </div>
              </Field>
              {withLogin && <LoginRoles value={roleIds} onChange={setRoleIds} error={rolesError} />}
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
