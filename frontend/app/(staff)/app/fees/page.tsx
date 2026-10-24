"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertOctagon, Banknote, CalendarPlus, FilePlus2, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BilledCollectedChart } from "@/components/charts/charts";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useClasses, useFeesSummary, useFeeTypes, useGrades } from "@/lib/api/hooks";
import { useCan } from "@/lib/auth";
import { formatMoney, formatPeriod, toISODate } from "@/lib/format";
import { DatePicker, MonthPicker } from "@/components/shared/date-picker";

export default function FeesOverviewPage() {
  const t = useTranslations("fees.overview");
  const tm = useTranslations("status.method");
  const tn = useTranslations("nav");
  const can = useCan();
  const { data, error, refetch, isPending } = useFeesSummary();
  const [table, setTable] = useState(false);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const methodTotal = data.byMethod.reduce((a, m) => a + m.amount, 0);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {can("fees.create") && <GenerateDialog />}
            {can("fees.create") && <ChargeDialog />}
            {can("payments.create") && (
              <RecordPaymentDialog
                trigger={
                  <Button>
                    <Banknote /> {t("record")}
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("collected")} value={formatMoney(data.collectedThisMonth)} hint={t("vsLast", { amount: formatMoney(data.collectedLastMonth) })} icon={Wallet} href="/app/fees/payments" />
        <StatCard label={t("outstanding")} value={formatMoney(data.outstanding)} hint={t("overdue", { count: data.overdueInvoices })} icon={Receipt} href="/app/fees/invoices?status=overdue" />
        <StatCard label={t("defaulters")} value={data.defaulters} hint={t("defaultersHint")} icon={AlertOctagon} href="/app/fees/defaulters" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("chartTitle")}</CardTitle>
            <CardDescription>{t("chartDescription")}</CardDescription>
            <CardAction>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={table} onCheckedChange={setTable} /> {t("tableView")}
              </label>
            </CardAction>
          </CardHeader>
          <CardContent>
            {table ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("month")}</TableHead>
                    <TableHead className="text-right">{t("billed")}</TableHead>
                    <TableHead className="text-right">{t("collectedSeries")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.monthly.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell>{formatPeriod(m.month)}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(m.billed)}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(m.collected)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <BilledCollectedChart data={data.monthly} labels={{ billed: t("billed"), collected: t("collectedSeries") }} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("byMethod")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.byMethod.map((m) => (
              <div key={m.method} className="space-y-1.5">
                <div className="flex justify-between gap-2 text-sm">
                  <span>{tm(m.method)}</span>
                  <span className="font-medium tabular">{formatMoney(m.amount)}</span>
                </div>
                <Progress value={methodTotal ? (m.amount / methodTotal) * 100 : 0} aria-label={tm(m.method)} />
              </div>
            ))}
            <Button variant="outline" className="w-full" asChild>
              <Link href="/app/fees/payments">{tn("payments")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function GenerateDialog() {
  const t = useTranslations("fees.generate");
  const to = useTranslations("fees.overview");
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState("");
  const gen = useApiMutation(() => api.post<{ created: number }>("/invoices/generate-monthly", { period }), {
    invalidate: [["fees"], ["invoices"], ["students"], ["defaulters"]],
    success: (r) => t("done", { count: r.created }),
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          const d = new Date();
          d.setMonth(d.getMonth() + 1);
          setPeriod(toISODate(d).slice(0, 7));
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarPlus /> {to("generate")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>{t("month")}</FieldLabel>
          <MonthPicker ariaLabel={t("month")} value={period} onChange={setPeriod} className="sm:max-w-sm" />
        </Field>
        <DialogFooter>
          <Button onClick={() => gen.mutate(undefined)} disabled={!period || gen.isPending}>
            {gen.isPending && <Spinner />} {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChargeDialog() {
  const t = useTranslations("fees.charge");
  const tc = useTranslations("common");
  const classes = useClasses();
  const grades = useGrades();
  const feeTypes = useFeeTypes();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "class" as "class" | "grade", id: "", feeTypeId: "", description: "", amount: "", dueDate: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const charge = useApiMutation(
    () =>
      api.post<{ created: number }>("/invoices/charges", {
        target: { type: form.type, ids: [form.id] },
        feeTypeId: form.feeTypeId,
        description: form.description,
        amount: Number(form.amount),
        dueDate: form.dueDate,
      }),
    { invalidate: [["fees"], ["invoices"], ["students"]], success: (r) => t("done", { count: r.created }), toastError: false, onSuccess: () => setOpen(false) },
  );
  const submit = () => {
    const e: Record<string, string> = {};
    if (!form.id) e.target = tc("required");
    if (!form.feeTypeId) e.feeTypeId = tc("required");
    if (!(Number(form.amount) > 0)) e.amount = tc("required");
    if (!form.dueDate) e.dueDate = tc("required");
    setErrors(e);
    if (Object.keys(e).length) return;
    charge.mutateAsync(undefined).catch((er) => setErrors(er instanceof ApiError && er.fields ? er.fields : { target: er.message }));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          const d = new Date();
          d.setDate(d.getDate() + 14);
          setForm({ type: "class", id: "", feeTypeId: "", description: "", amount: "", dueDate: toISODate(d) });
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FilePlus2 /> {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("target")}</FieldLabel>
            <RadioGroup value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "class" | "grade", id: "" })} className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="class" /> {t("targetClass")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="grade" /> {t("targetGrade")}
              </label>
            </RadioGroup>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.target}>
              <FieldLabel>{form.type === "class" ? t("class") : t("grade")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("target")}
                value={form.id}
                onChange={(v) => setForm({ ...form, id: v })}
                allLabel={tc("selectPlaceholder")}
                options={form.type === "class" ? (classes.data ?? []).map((c) => ({ value: c.id, label: c.name })) : (grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
                className="sm:w-full"
              />
              <FieldError>{errors.target}</FieldError>
            </Field>
            <Field data-invalid={!!errors.feeTypeId}>
              <FieldLabel>{t("feeType")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("feeType")}
                value={form.feeTypeId}
                onChange={(v) => setForm({ ...form, feeTypeId: v })}
                allLabel={tc("selectPlaceholder")}
                options={(feeTypes.data ?? []).filter((f) => f.recurrence === "ad_hoc" && f.active).map((f) => ({ value: f.id, label: f.name }))}
                className="sm:w-full"
              />
              <FieldError>{errors.feeTypeId}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="desc">{t("itemDescription")}</FieldLabel>
            <Input id="desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.amount}>
              <FieldLabel htmlFor="amt">{t("amount")}</FieldLabel>
              <Input id="amt" inputMode="numeric" className="tabular" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, "") })} aria-invalid={!!errors.amount} />
              <FieldError>{errors.amount}</FieldError>
            </Field>
            <Field data-invalid={!!errors.dueDate}>
              <FieldLabel htmlFor="due">{t("dueDate")}</FieldLabel>
              <DatePicker id="due" value={form.dueDate} min={toISODate(new Date())} invalid={!!errors.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
              <FieldError>{errors.dueDate}</FieldError>
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={submit} disabled={charge.isPending}>
            {charge.isPending && <Spinner />} {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
