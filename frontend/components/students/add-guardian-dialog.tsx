"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FilterSelect } from "@/components/shared/filters";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation } from "@/lib/api/hooks";
import type { Guardian } from "@/lib/api/types";

const EMPTY = { name: "", relationship: "Father" as Guardian["relationship"], phone: "", email: "", nic: "", occupation: "", inviteParent: true };

/** Adds a guardian to a student, or links an existing one with the same email/phone (siblings). */
export function AddGuardianDialog({ studentId }: { studentId: string }) {
  const t = useTranslations("students.guardians");
  const tf = useTranslations("students.profile.fields");
  const ts = useTranslations("status.relationship");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useApiMutation(
    () => api.post<{ guardian: Guardian; linked: boolean; inviteLink?: string }>(`/students/${studentId}/guardians`, form),
    {
      invalidate: [["student", studentId], ["students"]],
      toastError: false,
      onSuccess: (r) => {
        toast.success(r.linked ? t("linked", { name: r.guardian.name }) : t("added"), {
          description: r.inviteLink ? t("inviteLink", { link: r.inviteLink }) : undefined,
        });
        setOpen(false);
      },
    },
  );
  const field = (key: "name" | "phone" | "email" | "nic" | "occupation", label: string, type = "text") => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel htmlFor={`ag-${key}`}>{label}</FieldLabel>
      <Input id={`ag-${key}`} type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-invalid={!!errors[key]} />
      <FieldError>{errors[key]}</FieldError>
    </Field>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(EMPTY);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus /> {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
          <DialogDescription>{t("addDescription")}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            {field("name", tc("name"))}
            <Field>
              <FieldLabel>{tf("relationship")}</FieldLabel>
              <FilterSelect
                ariaLabel={tf("relationship")}
                value={form.relationship}
                onChange={(v) => setForm({ ...form, relationship: v as Guardian["relationship"] })}
                options={(["Father", "Mother", "Guardian"] as const).map((r) => ({ value: r, label: ts(r) }))}
                className="sm:w-full"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("phone", tc("phone"), "tel")}
            {field("email", tc("email"), "email")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("nic", tf("nic"))}
            {field("occupation", tf("occupation"))}
          </div>
          <Field orientation="horizontal">
            <Checkbox id="ag-invite" checked={form.inviteParent} onCheckedChange={(c) => setForm({ ...form, inviteParent: c === true })} />
            <FieldLabel htmlFor="ag-invite" className="font-normal">
              {t("invite")}
            </FieldLabel>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={add.isPending}
            onClick={() => add.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : { name: e.message }))}
          >
            {add.isPending && <Spinner />} {t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
