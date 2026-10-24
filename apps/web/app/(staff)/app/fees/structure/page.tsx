"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useDiscounts, useFeeStructures, useFeeTypes, useGrades, useSchool, useYears } from "@/lib/api/hooks";
import type { FeeType } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { useResettableState } from "@/hooks/use-resettable-state";

export default function FeeStructurePage() {
  const t = useTranslations("fees.structure");
  const tr = useTranslations("status.recurrence");
  const can = useCan();
  const editable = can("fees.edit");
  const grades = useGrades();
  const feeTypes = useFeeTypes();
  const structures = useFeeStructures();
  const discounts = useDiscounts();
  const { data: school } = useSchool();
  const years = useYears();
  const [amounts, setAmounts] = useResettableState(
    structures.data,
    (d) => Object.fromEntries((d ?? []).map((s) => [`${s.gradeId}|${s.feeTypeId}`, String(s.amount)])) as Record<string, string>,
  );
  const columns = useMemo(() => feeTypes.data?.filter((f) => f.recurrence !== "ad_hoc" || ["fee_exam", "fee_sports"].includes(f.id)) ?? [], [feeTypes.data]);

  const save = useApiMutation(
    () =>
      api.put("/fee-structures", {
        items: Object.entries(amounts).map(([k, v]) => {
          const [gradeId, feeTypeId] = k.split("|");
          return { gradeId, feeTypeId, amount: Number(v || 0) };
        }),
      }),
    { invalidate: [["feeStructures"]], success: t("saved") },
  );

  if (grades.isPending || feeTypes.isPending || structures.isPending) return <PageSkeleton />;
  const err = grades.error ?? feeTypes.error ?? structures.error;
  if (err) return <ErrorState error={err} onRetry={() => structures.refetch()} />;
  const yearName = years.data?.find((y) => y.id === school?.currentYearId)?.name ?? "";

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", { year: yearName })}
        actions={
          editable && (
            <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
              {save.isPending && <Spinner />} {t("save")}
            </Button>
          )
        }
      />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="sticky left-0 bg-card">{t("grade")}</TableHead>
              {columns.map((f) => (
                <TableHead key={f.id} className="min-w-36 text-right">
                  {f.name}
                  <span className="block text-[11px] font-normal">{tr(f.recurrence)}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grades.data?.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="sticky left-0 bg-card font-medium">{g.name}</TableCell>
                {columns.map((f) => {
                  const key = `${g.id}|${f.id}`;
                  return (
                    <TableCell key={f.id} className="text-right">
                      {editable ? (
                        <Input
                          aria-label={`${g.name} – ${f.name}`}
                          inputMode="numeric"
                          className="ml-auto h-8 w-28 text-right tabular"
                          value={amounts[key] ?? ""}
                          onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value.replace(/[^\d]/g, "") }))}
                        />
                      ) : (
                        <span className="tabular">{amounts[key] ? formatMoney(Number(amounts[key])) : "—"}</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("feeTypes")}</CardTitle>
            <CardDescription>{t("feeTypesDescription")}</CardDescription>
            {editable && (
              <CardAction>
                <FeeTypeDialog />
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {feeTypes.data?.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{f.name}</p>
                    {f.description && <p className="truncate text-xs text-muted-foreground">{f.description}</p>}
                  </div>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    {tr(f.recurrence)}
                    {editable && <FeeTypeActiveSwitch feeType={f} />}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("discounts")}</CardTitle>
            <CardDescription>{t("discountsDescription")}</CardDescription>
            {editable && (
              <CardAction>
                <DiscountDialog />
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {discounts.data?.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium">{d.name}</p>
                    {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                  </div>
                  <span className="font-medium tabular">{d.kind === "percent" ? `${d.value}%` : formatMoney(d.value)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function FeeTypeActiveSwitch({ feeType }: { feeType: FeeType }) {
  const t = useTranslations("fees.structure");
  const save = useApiMutation((active: boolean) => api.put(`/fee-types/${feeType.id}`, { ...feeType, active }), { invalidate: [["feeTypes"]] });
  return <Switch aria-label={t("active")} checked={feeType.active} onCheckedChange={(c) => save.mutate(c)} disabled={save.isPending} />;
}

function FeeTypeDialog() {
  const t = useTranslations("fees.structure");
  const tr = useTranslations("status.recurrence");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", recurrence: "ad_hoc", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useApiMutation(() => api.post("/fee-types", form), { invalidate: [["feeTypes"]], success: t("created"), toastError: false, onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && (setForm({ name: "", recurrence: "ad_hoc", description: "" }), setErrors({})))}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> {t("addFeeType")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addFeeType")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="ftname">{t("name")}</FieldLabel>
            <Input id="ftname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{t("recurrence")}</FieldLabel>
            <FilterSelect
              ariaLabel={t("recurrence")}
              value={form.recurrence}
              onChange={(v) => setForm({ ...form, recurrence: v })}
              options={(["monthly", "one_time", "ad_hoc"] as const).map((r) => ({ value: r, label: tr(r) }))}
              className="sm:w-full"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ftdesc">{tc("details")}</FieldLabel>
            <Input id="ftdesc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={() => create.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : {}))} disabled={create.isPending}>
            {create.isPending && <Spinner />} {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscountDialog() {
  const t = useTranslations("fees.structure");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "percent", value: "", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useApiMutation(() => api.post("/discounts", { ...form, value: Number(form.value) }), {
    invalidate: [["discounts"]],
    success: t("created"),
    toastError: false,
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && (setForm({ name: "", kind: "percent", value: "", description: "" }), setErrors({})))}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> {t("addDiscount")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addDiscount")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="dname">{t("name")}</FieldLabel>
            <Input id="dname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("kind")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("kind")}
                value={form.kind}
                onChange={(v) => setForm({ ...form, kind: v })}
                options={[
                  { value: "percent", label: t("percent") },
                  { value: "fixed", label: t("fixed") },
                ]}
                className="sm:w-full"
              />
            </Field>
            <Field data-invalid={!!errors.value}>
              <FieldLabel htmlFor="dval">{t("value")}</FieldLabel>
              <Input id="dval" inputMode="numeric" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value.replace(/[^\d]/g, "") })} aria-invalid={!!errors.value} />
              <FieldError>{errors.value}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ddesc">{tc("details")}</FieldLabel>
            <Input id="ddesc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={() => create.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : {}))} disabled={create.isPending}>
            {create.isPending && <Spinner />} {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
