"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError, errorMessage, newIdempotencyKey } from "@/lib/api/client";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { useQueryClient } from "@tanstack/react-query";
import type { Paginated, PaymentListItem, PaymentMethod, StudentListItem } from "@whizchool/shared/types";
import { formatMoney, toISODate } from "@/lib/format";
import { DatePicker } from "@/components/shared/date-picker";

const METHODS: Exclude<PaymentMethod, "payhere">[] = ["cash", "bank_deposit", "cheque"];

export function RecordPaymentDialog({ trigger, student }: { trigger: ReactNode; student?: { id: string; fullName: string; balance: number } }) {
  const t = useTranslations("fees.record");
  const tm = useTranslations("status.method");
  const tc = useTranslations("common");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(student);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const idemKey = useRef<string | null>(null);
  const [done, setDone] = useState<PaymentListItem | null>(null);

  function reset() {
    idemKey.current = null;
    setPicked(student);
    setAmount("");
    setMethod("cash");
    setReference("");
    setDate(toISODate(new Date()));
    setErrors({});
    setDone(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!picked) errs.studentId = tc("required");
    if (!(Number(amount) > 0)) errs.amount = tc("required");
    if (method !== "cash" && !reference.trim()) errs.reference = tc("required");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      idemKey.current ??= newIdempotencyKey();
      const p = await api.post<PaymentListItem>(
        "/payments",
        { studentId: picked!.id, amount: Number(amount), method, reference, paidAt: date },
        { idempotencyKey: idemKey.current },
      );
      setDone(p);
      for (const key of [["payments"], ["invoices"], ["invoice"], ["student", picked!.id], ["students"], ["fees"], ["defaulters"], ["dashboard"]]) {
        qc.invalidateQueries({ queryKey: key });
      }
    } catch (er) {
      if (er instanceof ApiError && er.fields) setErrors(er.fields);
      else setErrors({ form: errorMessage(er) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <CheckCircle2 className="size-8 text-success" />
              <DialogTitle>{t("done", { receiptNo: done.receiptNo })}</DialogTitle>
              <DialogDescription>
                {done.studentName} · {formatMoney(done.amount)}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {tc("close")}
              </Button>
              <Button asChild>
                <Link href={`/app/fees/payments/${done.id}`}>{t("viewReceipt")}</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="my-6">
              <Field data-invalid={!!errors.studentId}>
                <FieldLabel>{t("student")}</FieldLabel>
                {student ? (
                  <p className="text-sm font-medium">{student.fullName}</p>
                ) : (
                  <StudentPicker value={picked} onChange={setPicked} />
                )}
                {picked && (
                  <FieldDescription>{picked.balance > 0 ? t("outstanding", { amount: formatMoney(picked.balance) }) : t("noBalance")}</FieldDescription>
                )}
                <FieldError>{errors.studentId}</FieldError>
              </Field>
              <Field data-invalid={!!errors.amount}>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="amount">{t("amount")}</FieldLabel>
                  {picked && picked.balance > 0 && (
                    <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setAmount(String(picked.balance))}>
                      {t("payFull")}
                    </Button>
                  )}
                </div>
                <Input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!!errors.amount} className="tabular" />
                <FieldError>{errors.amount}</FieldError>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t("method")}</FieldLabel>
                  <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {tm(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="pdate">{t("date")}</FieldLabel>
                  <DatePicker id="pdate" value={date} max={toISODate(new Date())} onChange={setDate} />
                </Field>
              </div>
              {method !== "cash" && (
                <Field data-invalid={!!errors.reference}>
                  <FieldLabel htmlFor="ref">{t("reference")}</FieldLabel>
                  <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} aria-invalid={!!errors.reference} />
                  <FieldDescription>{t("referenceHint")}</FieldDescription>
                  <FieldError>{errors.reference}</FieldError>
                </Field>
              )}
              {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />} {t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StudentPicker({
  value,
  onChange,
}: {
  value?: { id: string; fullName: string; balance: number };
  onChange: (s: { id: string; fullName: string; balance: number }) => void;
}) {
  const t = useTranslations("fees.record");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 250);
  const results = useQuery({
    queryKey: ["students", "picker", q],
    queryFn: () => api.get<Paginated<StudentListItem>>("/students", { search: q, pageSize: 8 }),
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start font-normal">
          {value ? value.fullName : <span className="text-muted-foreground">{t("studentPlaceholder")}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("studentPlaceholder")} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{results.isFetching ? tc("loading") : tc("noResults")}</CommandEmpty>
            <CommandGroup>
              {results.data?.items.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    onChange({ id: s.id, fullName: s.fullName, balance: s.balance });
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">
                    {s.fullName} <span className="text-muted-foreground">· {s.className} · {s.admissionNo}</span>
                  </span>
                  {s.balance > 0 && <span className="text-xs tabular text-muted-foreground">{formatMoney(s.balance)}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
