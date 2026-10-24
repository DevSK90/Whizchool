"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Banknote, Pencil, Trash2, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DetailList } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { AddGuardianDialog } from "@/components/students/add-guardian-dialog";
import { StudentAttendanceView } from "@/components/students/attendance-view";
import { DocumentsPanel } from "@/components/students/documents-panel";
import { StudentPhoto } from "@/components/students/student-photo";
import { StudentResultsView } from "@/components/students/results-view";
import { InvoiceList } from "@/components/fees/invoice-list";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useStudent, useStudentInvoices } from "@/lib/api/hooks";
import type { Guardian, StudentDetail, StudentStatus } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";
import { formatDate, formatMoney, toISODate } from "@/lib/format";
import { DatePicker } from "@/components/shared/date-picker";

export default function StudentProfilePage({ params }: PageProps<"/app/students/[id]">) {
  const { id } = use(params);
  const t = useTranslations("students.profile");
  const ts = useTranslations("status");
  const can = useCan();
  const { data: s, error, refetch, isPending } = useStudent(id);
  const [tab, setTab] = useState("overview");

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        back={{ href: "/app/students", label: t("back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <StudentPhoto studentId={s.id} name={s.fullName} photoUrl={s.photoUrl} editable={can("students.edit")} className="size-12" />
            {s.fullName}
            <StatusBadge kind="student" status={s.status} />
          </span>
        }
        description={`${t("admissionNo", { no: s.admissionNo })} · ${s.className}${s.streamName ? ` (${s.streamName})` : ""}`}
        actions={
          <>
            {can("payments.create") && s.balance > 0 && (
              <RecordPaymentDialog
                student={{ id: s.id, fullName: s.fullName, balance: s.balance }}
                trigger={
                  <Button variant="outline">
                    <Banknote /> {t("balance")}: {formatMoney(s.balance)}
                  </Button>
                }
              />
            )}
            {can("students.edit") && <StatusDialog student={s} />}
            {can("students.edit") && (
              <Button asChild>
                <Link href={`/app/students/${id}/edit`}>
                  <Pencil /> {t("edit")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={t("attendanceRate")} value={`${s.attendanceRate.toFixed(1)}%`} />
        {can("fees.view") && <MiniStat label={t("balance")} value={formatMoney(s.balance)} />}
        <MiniStat label={t("joined")} value={formatDate(s.joinedDate)} />
        <MiniStat label={t("subjects")} value={s.subjects.length} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto flex-wrap">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="guardians">{t("tabs.guardians")}</TabsTrigger>
          <TabsTrigger value="attendance">{t("tabs.attendance")}</TabsTrigger>
          <TabsTrigger value="results">{t("tabs.results")}</TabsTrigger>
          {can("fees.view") && <TabsTrigger value="fees">{t("tabs.fees")}</TabsTrigger>}
          <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("personal")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <DetailList
                items={[
                  { label: t("fields.nameWithInitials"), value: s.nameWithInitials },
                  { label: t("fields.gender"), value: ts(`gender.${s.gender}`) },
                  { label: t("fields.dob"), value: formatDate(s.dob) },
                  { label: t("fields.religion"), value: s.religion },
                  { label: t("fields.address"), value: s.address },
                  { label: t("joined"), value: formatDate(s.joinedDate) },
                  { label: t("fields.status"), value: s.leftDate ? `${t("left", { date: formatDate(s.leftDate) })}${s.leftReason ? ` — ${s.leftReason}` : ""}` : undefined },
                ]}
              />
              <div>
                <h3 className="mb-2 text-sm font-medium">{t("medical")}</h3>
                <DetailList
                  items={[
                    { label: t("fields.bloodGroup"), value: s.medical?.bloodGroup },
                    { label: t("fields.allergies"), value: s.medical?.allergies },
                    { label: t("fields.conditions"), value: s.medical?.conditions },
                  ]}
                />
              </div>
            </CardContent>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("subjects")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {s.subjects.map((sub) => (
                  <Badge key={sub.id} variant="secondary">
                    {sub.name}
                  </Badge>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("history")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {s.history.map((h) => (
                    <li key={h.yearName} className="flex justify-between">
                      <span className="text-muted-foreground">{h.yearName}</span>
                      <span className="font-medium">{h.className}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("discounts")}</CardTitle>
              </CardHeader>
              <CardContent>
                {s.discounts.length ? (
                  <ul className="space-y-1 text-sm">
                    {s.discounts.map((d) => (
                      <li key={d.id} className="flex justify-between">
                        <span>{d.name}</span>
                        <span className="font-medium">{d.kind === "percent" ? `${d.value}%` : formatMoney(d.value)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noDiscounts")}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="guardians" className="space-y-4">
          {can("students.edit") && (
            <div className="flex justify-end">
              <AddGuardianDialog studentId={s.id} />
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {s.guardians.map((g) => (
              <GuardianCard key={g.id} guardian={g} studentId={s.id} canEdit={can("students.edit")} canRemove={s.guardians.length > 1} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="attendance">{tab === "attendance" && <StudentAttendanceView studentId={s.id} />}</TabsContent>
        <TabsContent value="results">
          {tab === "results" && <StudentResultsView studentId={s.id} reportHref={(examId) => `/app/report-cards/${examId}/student/${s.id}`} />}
        </TabsContent>
        {can("fees.view") && <TabsContent value="fees">{tab === "fees" && <StudentFees student={s} />}</TabsContent>}
        <TabsContent value="documents">
          <DocumentsPanel studentId={s.id} documents={s.documents} editable={can("students.edit")} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular">{value}</p>
    </div>
  );
}

function StudentFees({ student }: { student: StudentDetail }) {
  const t = useTranslations("students.fees");
  const { data, error, refetch, isPending } = useStudentInvoices(student.id);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.length) return <EmptyState title={t("noInvoices")} />;
  return <InvoiceList invoices={data} href={(inv) => `/app/fees/invoices/${inv.id}`} />;
}

function GuardianCard({ guardian: g, studentId, canEdit, canRemove }: { guardian: Guardian; studentId: string; canEdit: boolean; canRemove: boolean }) {
  const t = useTranslations("students.profile");
  const tg = useTranslations("students.guardians");
  const ts = useTranslations("status");
  const tc = useTranslations("common");
  const [form, setForm] = useState(g);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const save = useApiMutation(() => api.put(`/guardians/${g.id}`, form), {
    invalidate: [["student", studentId]],
    success: t("guardianSaved"),
    toastError: false,
    onSuccess: () => setOpen(false),
  });
  const remove = useApiMutation(() => api.delete(`/students/${studentId}/guardians/${g.id}`), {
    invalidate: [["student", studentId], ["students"]],
    success: tg("removed"),
  });
  const field = (key: keyof Guardian, label: string, type = "text") => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel htmlFor={`${g.id}-${key}`}>{label}</FieldLabel>
      <Input id={`${g.id}-${key}`} type={type} value={(form[key] as string) ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-invalid={!!errors[key]} />
      <FieldError>{errors[key]}</FieldError>
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{g.name}</CardTitle>
        <CardAction className="flex items-center gap-1">
          {canEdit && canRemove && (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={tg("remove")}>
                  <Trash2 />
                </Button>
              }
              title={tg("removeTitle", { name: g.name })}
              description={tg("removeBody")}
              confirmLabel={tg("remove")}
              destructive
              onConfirm={() => remove.mutateAsync(undefined)}
            />
          )}
          {canEdit && (
            <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && (setForm(g), setErrors({})))}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <UserCog /> {t("editGuardian")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("editGuardian")}</DialogTitle>
                  <DialogDescription>{g.name}</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  {field("name", tc("name"))}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("phone", tc("phone"), "tel")}
                    {field("email", tc("email"), "email")}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("nic", t("fields.nic"))}
                    {field("occupation", t("fields.occupation"))}
                  </div>
                  {field("address", t("fields.address"))}
                </FieldGroup>
                <DialogFooter>
                  <Button
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutateAsync(undefined).catch((e) => {
                        if (e instanceof ApiError && e.fields) setErrors(e.fields);
                      })
                    }
                  >
                    {save.isPending && <Spinner />} {tc("save")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <DetailList
          className="sm:grid-cols-1"
          items={[
            { label: t("fields.relationship"), value: ts(`relationship.${g.relationship}`) },
            { label: tc("phone"), value: <a href={`tel:${g.phone.replace(/\s/g, "")}`} className="hover:underline">{g.phone}</a> },
            { label: tc("email"), value: g.email },
            { label: t("fields.occupation"), value: g.occupation },
            { label: t("portalAccess"), value: g.userId ? t("portalActive") : t("portalNone") },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function StatusDialog({ student }: { student: StudentDetail }) {
  const t = useTranslations("students.status");
  const tp = useTranslations("students.profile");
  const ts = useTranslations("status.student");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StudentStatus>(student.status === "active" ? "left" : "active");
  const [date, setDate] = useState(toISODate(new Date()));
  const [reason, setReason] = useState("");
  const save = useApiMutation(() => api.post(`/students/${student.id}/status`, { status, date, reason }), {
    invalidate: [["student", student.id], ["students"], ["dashboard"]],
    success: t("done"),
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{tp("changeStatus")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("status")}</FieldLabel>
            <Select value={status} onValueChange={(v) => setStatus(v as StudentStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["active", "left", "graduated", "expelled"] as const).map((s) => (
                  <SelectItem key={s} value={s} disabled={s === student.status}>
                    {ts(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {status !== "active" && (
            <>
              <Field>
                <FieldLabel htmlFor="sdate">{t("date")}</FieldLabel>
                <DatePicker id="sdate" value={date} max={toISODate(new Date())} onChange={setDate} />
              </Field>
              <Field>
                <FieldLabel htmlFor="sreason">{t("reason")}</FieldLabel>
                <Input id="sreason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            {save.isPending && <Spinner />} {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
