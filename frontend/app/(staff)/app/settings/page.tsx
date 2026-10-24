"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useExams, useGradeBands, useSchool, useSubjects, useTerms, useYears } from "@/lib/api/hooks";
import type { GradeBand, GradeLevel, School, Subject } from "@/lib/api/types";
import { useCan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { validateBands } from "@/lib/grading";
import { useUrlState } from "@/hooks/use-url-state";
import { useResettableState } from "@/hooks/use-resettable-state";
import { DatePicker } from "@/components/shared/date-picker";

export default function SettingsPage() {
  const t = useTranslations("admin.settings");
  const url = useUrlState<"tab">({ tab: "school" });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs value={url.get("tab")} onValueChange={(v) => url.set({ tab: v })}>
        <TabsList className="mb-4 h-auto flex-wrap">
          {(["school", "calendar", "subjects", "grading"] as const).map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="school">
          <SchoolProfile />
        </TabsContent>
        <TabsContent value="calendar">{url.get("tab") === "calendar" && <Calendar />}</TabsContent>
        <TabsContent value="subjects">{url.get("tab") === "subjects" && <Subjects />}</TabsContent>
        <TabsContent value="grading">{url.get("tab") === "grading" && <Grading />}</TabsContent>
      </Tabs>
    </>
  );
}

function SchoolProfile() {
  const t = useTranslations("admin.settings.school");
  const tc = useTranslations("common");
  const can = useCan();
  const editable = can("settings.edit");
  const { data, error, refetch, isPending } = useSchool();
  const [form, setForm] = useResettableState<School | undefined, School | null>(data, (d) => d ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation(() => api.put("/settings/school", form), { invalidate: [["school"], ["publicSchool"]], success: t("saved"), toastError: false, onSuccess: () => setErrors({}) });
  if (isPending || !form) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const field = (key: keyof School, label: string, hint?: string) => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel htmlFor={`s-${key}`}>{label}</FieldLabel>
      <Input id={`s-${key}`} value={String(form[key] ?? "")} disabled={!editable} onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-invalid={!!errors[key]} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{errors[key]}</FieldError>
    </Field>
  );
  return (
    <Card className="max-w-3xl">
      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            {field("name", t("name"))}
            {field("shortName", t("shortName"))}
          </div>
          {field("motto", t("motto"))}
          {field("address", t("address"))}
          <div className="grid gap-4 sm:grid-cols-3">
            {field("phone", t("phone"))}
            {field("email", t("email"))}
            {field("website", t("website"))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("principalName", t("principal"))}
            {field("smsSenderId", t("smsSender"), t("smsSenderHint"))}
          </div>
          {editable && (
            <div className="flex justify-end">
              <Button onClick={() => save.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : {}))} disabled={save.isPending}>
                {save.isPending && <Spinner />} {tc("saveChanges")}
              </Button>
            </div>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function Calendar() {
  const t = useTranslations("admin.settings.calendar");
  const can = useCan();
  const editable = can("settings.edit");
  const { data: school } = useSchool();
  const years = useYears();
  const terms = useTerms();
  const exams = useExams();
  const [dates, setDates] = useResettableState(
    terms.data,
    (d) => Object.fromEntries((d ?? []).map((x) => [x.id, { startDate: x.startDate, endDate: x.endDate }])) as Record<string, { startDate: string; endDate: string }>,
  );
  const save = useApiMutation(() => Promise.all(Object.entries(dates).map(([id, d]) => api.put(`/terms/${id}`, d))), { invalidate: [["terms"]], success: t("saved") });
  if (terms.isPending || years.isPending) return <PageSkeleton />;
  const year = years.data?.find((y) => y.id === school?.currentYearId);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("year", { name: year?.name ?? "" })}</CardTitle>
          <CardDescription>
            {year && `${formatDate(year.startDate)} – ${formatDate(year.endDate)}`}
          </CardDescription>
          <CardAction>{year && <Badge variant="secondary">{t(`yearStatus.${year.status}`)}</Badge>}</CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("term")}</TableHead>
                <TableHead>{t("start")}</TableHead>
                <TableHead>{t("end")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.data?.map((term) => (
                <TableRow key={term.id}>
                  <TableCell className="font-medium">{term.name}</TableCell>
                  {(["startDate", "endDate"] as const).map((k) => (
                    <TableCell key={k}>
                      {editable ? (
                        <DatePicker
                          className="w-44"
                          placeholder={`${term.name} ${k === "startDate" ? t("start") : t("end")}`}
                          value={dates[term.id]?.[k] ?? ""}
                          min={k === "endDate" ? dates[term.id]?.startDate : undefined}
                          onChange={(v) => setDates((d) => ({ ...d, [term.id]: { ...d[term.id], [k]: v } }))}
                        />
                      ) : (
                        formatDate(term[k])
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {editable && (
            <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
              {save.isPending && <Spinner />} {t("save")}
            </Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("exams")}</CardTitle>
          {editable && (
            <CardAction>
              <ExamDialog />
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {exams.data?.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{e.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(e.startDate)} – {formatDate(e.endDate)}
                  </p>
                </div>
                <StatusBadge kind="exam" status={e.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ExamDialog() {
  const t = useTranslations("admin.settings.calendar");
  const tc = useTranslations("common");
  const terms = useTerms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ termId: "", name: "", startDate: "", endDate: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useApiMutation(() => api.post("/exams", form), { invalidate: [["exams"]], success: t("examCreated"), toastError: false, onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && (setForm({ termId: "", name: "", startDate: "", endDate: "" }), setErrors({})))}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> {t("addExam")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addExam")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!!errors.termId}>
            <FieldLabel>{t("examTerm")}</FieldLabel>
            <FilterSelect ariaLabel={t("examTerm")} value={form.termId} onChange={(v) => setForm({ ...form, termId: v })} allLabel={tc("selectPlaceholder")} options={(terms.data ?? []).map((x) => ({ value: x.id, label: x.name }))} className="sm:w-full" />
            <FieldError>{errors.termId}</FieldError>
          </Field>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="ename">{t("examName")}</FieldLabel>
            <Input id="ename" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="estart">{t("examStart")}</FieldLabel>
              <DatePicker id="estart" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
            </Field>
            <Field data-invalid={!!errors.endDate}>
              <FieldLabel htmlFor="eend">{t("examEnd")}</FieldLabel>
              <DatePicker id="eend" value={form.endDate} min={form.startDate || undefined} invalid={!!errors.endDate} onChange={(v) => setForm({ ...form, endDate: v })} />
              <FieldError>{errors.endDate}</FieldError>
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={() => create.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : { name: e.message }))} disabled={create.isPending}>
            {create.isPending && <Spinner />} {tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LEVELS: GradeLevel[] = ["primary", "junior", "ol", "al"];

function Subjects() {
  const t = useTranslations("admin.settings.subjects");
  const tt = useTranslations("admin.settings.tabs");
  const tl = useTranslations("status.level");
  const can = useCan();
  const { data, error, refetch, isPending } = useSubjects();
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt("subjects")}</CardTitle>
        {can("settings.edit") && (
          <CardAction>
            <SubjectDialog />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{t("name")}</TableHead>
              <TableHead>{t("code")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("levels")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("basket")}</TableHead>
              <TableHead className="pr-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="pl-6 font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-xs">{s.code}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {s.levels.map((l) => (
                      <Badge key={l} variant="secondary">
                        {tl(l)}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{s.basket ? s.basket : <span className="text-muted-foreground">{t("core")}</span>}</TableCell>
                <TableCell className="pr-6 text-right">{can("settings.edit") && <SubjectDialog subject={s} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SubjectDialog({ subject }: { subject?: Subject }) {
  const t = useTranslations("admin.settings.subjects");
  const tl = useTranslations("status.level");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const blank = { name: "", code: "", levels: [] as GradeLevel[], basket: "" };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation(
    () => {
      const body = { ...form, basket: form.basket ? Number(form.basket) : undefined };
      return subject ? api.put(`/subjects/${subject.id}`, body) : api.post("/subjects", body);
    },
    { invalidate: [["subjects"]], success: t("saved"), toastError: false, onSuccess: () => setOpen(false) },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(subject ? { name: subject.name, code: subject.code, levels: subject.levels, basket: subject.basket ? String(subject.basket) : "" } : blank);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        {subject ? (
          <Button variant="ghost" size="icon-sm" aria-label={tc("edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus /> {t("add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{subject ? subject.name : t("add")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="sname">{t("name")}</FieldLabel>
              <Input id="sname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} />
              <FieldError>{errors.name}</FieldError>
            </Field>
            <Field data-invalid={!!errors.code}>
              <FieldLabel htmlFor="scode">{t("code")}</FieldLabel>
              <Input id="scode" value={form.code} disabled={!!subject} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} aria-invalid={!!errors.code} />
              <FieldError>{errors.code}</FieldError>
            </Field>
          </div>
          <Field data-invalid={!!errors.levels}>
            <FieldLabel>{t("levels")}</FieldLabel>
            <div className="flex flex-wrap gap-4">
              {LEVELS.map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.levels.includes(l)} onCheckedChange={(c) => setForm({ ...form, levels: c ? [...form.levels, l] : form.levels.filter((x) => x !== l) })} />
                  {tl(l)}
                </label>
              ))}
            </div>
            <FieldError>{errors.levels}</FieldError>
          </Field>
          {form.levels.includes("ol") && (
            <Field>
              <FieldLabel>{t("basket")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("basket")}
                value={form.basket}
                onChange={(v) => setForm({ ...form, basket: v })}
                allLabel={t("core")}
                options={["1", "2", "3"].map((b) => ({ value: b, label: b }))}
                className="sm:w-40"
              />
            </Field>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button onClick={() => save.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : { name: e.message }))} disabled={save.isPending}>
            {save.isPending && <Spinner />} {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Grading() {
  const t = useTranslations("admin.settings.grading");
  const can = useCan();
  const editable = can("settings.edit");
  const { data, error, refetch, isPending } = useGradeBands();
  const [bands, setBands] = useResettableState(data, (d) => (d ?? []).map((b): GradeBand => ({ ...b })));
  const problem = bands.length ? validateBands(bands) : null;
  const save = useApiMutation(() => api.put("/grade-bands", { bands }), { invalidate: [["gradeBands"]], success: t("saved") });
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const set = (i: number, patch: Partial<GradeBand>) => setBands((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("grade")}</TableHead>
              <TableHead>{t("min")}</TableHead>
              <TableHead>{t("max")}</TableHead>
              <TableHead>{t("label")}</TableHead>
              <TableHead>{t("pass")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bands.map((b, i) => (
              <TableRow key={i}>
                <TableCell className="text-lg font-semibold">{b.grade}</TableCell>
                {(["min", "max"] as const).map((k) => (
                  <TableCell key={k}>
                    <Input
                      className="h-8 w-20 tabular"
                      inputMode="numeric"
                      aria-label={`${b.grade} ${t(k)}`}
                      disabled={!editable}
                      value={b[k]}
                      onChange={(e) => set(i, { [k]: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Input className="h-8" aria-label={`${b.grade} ${t("label")}`} disabled={!editable} value={b.label} onChange={(e) => set(i, { label: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Switch aria-label={`${b.grade} ${t("pass")}`} disabled={!editable} checked={b.pass} onCheckedChange={(c) => set(i, { pass: c })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        {editable && (
          <Button onClick={() => save.mutate(undefined)} disabled={!!problem || save.isPending}>
            {save.isPending && <Spinner />} {t("save")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
