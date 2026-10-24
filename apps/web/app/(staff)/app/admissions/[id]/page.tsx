"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarClock, Check, FileText, UserRoundCheck, X, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApplicationTimeline } from "@/components/admissions/timeline";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DetailList } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { api, errorMessage } from "@/lib/api/client";
import { useApiMutation, useApplication, useClasses } from "@/lib/api/hooks";
import type { Application, ApplicationStage } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";
import { formatDate, formatDateTime, toISODate } from "@/lib/format";
import { DatePicker, TimeSelect } from "@/components/shared/date-picker";

const INVALIDATE = [["applications"], ["application"], ["dashboard"]];

export default function ApplicationDetailPage({ params }: PageProps<"/app/admissions/[id]">) {
  const { id } = use(params);
  const t = useTranslations("admissions");
  const ts = useTranslations("status");
  const can = useCan();
  const { data: a, error, refetch, isPending } = useApplication(id);
  const transition = useApiMutation(
    (body: { to: ApplicationStage; note?: string; interviewAt?: string }) => api.post(`/applications/${id}/transition`, body),
    { invalidate: INVALIDATE, success: (_, v) => t("actions.moved", { stage: ts(`application.${v.to}`) }) },
  );

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const name = `${a.student.firstName} ${a.student.lastName}`;
  const canEdit = can("admissions.edit");
  const canApprove = can("admissions.approve");
  const open = a.stage === "new" || a.stage === "interview";

  return (
    <>
      <PageHeader
        back={{ href: "/app/admissions", label: t("detail.back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name} <StatusBadge kind="application" status={a.stage} />
          </span>
        }
        description={`${a.refNo} · ${a.gradeName} · ${t("detail.submitted", { date: formatDate(a.submittedAt) })}`}
        actions={
          <>
            {open && canEdit && <InterviewDialog app={a} onSubmit={(body) => transition.mutateAsync({ to: "interview", ...body })} />}
            {open && canApprove && (
              <>
                <NoteConfirm
                  trigger={<Button><Check /> {t("actions.accept")}</Button>}
                  title={t("actions.acceptTitle")}
                  body={t("actions.acceptBody")}
                  confirm={t("actions.accept")}
                  onConfirm={(note) => transition.mutateAsync({ to: "accepted", note })}
                />
                <NoteConfirm
                  trigger={<Button variant="outline"><X /> {t("actions.reject")}</Button>}
                  title={t("actions.rejectTitle")}
                  body={t("actions.rejectBody")}
                  confirm={t("actions.reject")}
                  destructive
                  onConfirm={(note) => transition.mutateAsync({ to: "rejected", note })}
                />
              </>
            )}
            {(a.stage === "accepted" || a.stage === "enrolled") && canApprove && <EnrollDialog app={a} showTrigger={a.stage === "accepted"} />}
            {(open || a.stage === "accepted") && canEdit && (
              <NoteConfirm
                trigger={<Button variant="ghost"><Undo2 /> {t("actions.withdraw")}</Button>}
                title={t("actions.withdrawTitle")}
                body={t("actions.withdrawBody")}
                confirm={t("actions.withdraw")}
                onConfirm={(note) => transition.mutateAsync({ to: "withdrawn", note })}
              />
            )}
            {a.stage === "enrolled" && a.enrolledStudentId && (
              <Button asChild>
                <Link href={`/app/students/${a.enrolledStudentId}`}>
                  <UserRoundCheck /> {t("actions.viewStudent")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {a.stage === "interview" && a.interviewAt && (
        <Alert className="mb-6">
          <CalendarClock />
          <AlertTitle>{t("detail.interviewAt")}</AlertTitle>
          <AlertDescription>{formatDateTime(a.interviewAt)}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.student")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: t("detail.fields.name"), value: name },
                  { label: t("detail.fields.gender"), value: ts(`gender.${a.student.gender}`) },
                  { label: t("detail.fields.dob"), value: formatDate(a.student.dob) },
                  { label: t("detail.fields.religion"), value: a.student.religion },
                  { label: t("detail.fields.address"), value: a.student.address },
                  { label: t("detail.fields.previousSchool"), value: a.student.previousSchool },
                  { label: t("detail.fields.medical"), value: a.student.medicalNotes },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.guardian")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: t("detail.fields.name"), value: a.guardian.name },
                  { label: t("detail.fields.relationship"), value: ts(`relationship.${a.guardian.relationship}`) },
                  { label: t("detail.fields.phone"), value: <a href={`tel:${a.guardian.phone.replace(/\s/g, "")}`} className="hover:underline">{a.guardian.phone}</a> },
                  { label: t("detail.fields.email"), value: <a href={`mailto:${a.guardian.email}`} className="hover:underline">{a.guardian.email}</a> },
                  { label: t("detail.fields.nic"), value: a.guardian.nic },
                  { label: t("detail.fields.occupation"), value: a.guardian.occupation },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.documents")}</CardTitle>
            </CardHeader>
            <CardContent>
              {a.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("detail.noDocuments")}</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {a.documents.map((d) => (
                    <li key={d.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{d.name}</span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => toast.info(t("detail.previewDemo"))}>
                        {Math.round(d.size / 1024)} KB
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("detail.timeline")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ApplicationTimeline items={a.timeline} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function NoteConfirm({
  trigger,
  title,
  body,
  confirm,
  destructive,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  body: string;
  confirm: string;
  destructive?: boolean;
  onConfirm: (note: string) => Promise<unknown>;
}) {
  const t = useTranslations("admissions.actions");
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog trigger={trigger} title={title} description={body} confirmLabel={confirm} destructive={destructive} onConfirm={() => onConfirm(note)}>
      <Field>
        <FieldLabel htmlFor="note">{t("note")}</FieldLabel>
        <Textarea id="note" rows={2} value={note} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

function InterviewDialog({ app, onSubmit }: { app: Application; onSubmit: (b: { interviewAt: string; note?: string }) => Promise<unknown> }) {
  const t = useTranslations("admissions.actions");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(app.interviewAt ? app.interviewAt.slice(0, 16) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarClock /> {app.stage === "interview" ? t("reschedule") : t("schedule")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("scheduleTitle")}</DialogTitle>
          <DialogDescription>{t("scheduleBody")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!when) return setErr(tc("required"));
            setBusy(true);
            try {
              await onSubmit({ interviewAt: `${when}:00+05:30`, note: note || undefined });
              setOpen(false);
            } catch (er) {
              setErr(errorMessage(er));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            <Field data-invalid={!!err}>
              <FieldLabel htmlFor="when">{t("interviewAt")}</FieldLabel>
              <div className="grid grid-cols-[1fr_9rem] gap-2">
                <DatePicker id="when" value={when.slice(0, 10)} min={toISODate(new Date())} invalid={!!err} onChange={(d) => setWhen(`${d}T${when.slice(11, 16) || "09:00"}`)} />
                <TimeSelect value={when.slice(11, 16)} invalid={!!err} onChange={(tm) => setWhen(`${when.slice(0, 10) || toISODate(new Date())}T${tm}`)} />
              </div>
              <FieldError>{err}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="inote">{t("note")}</FieldLabel>
              <Textarea id="inote" rows={2} value={note} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />} {t("schedule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Stays mounted after enrolling (stage becomes "enrolled") so the result can be shown. */
function EnrollDialog({ app, showTrigger }: { app: Application & { gradeName?: string }; showTrigger: boolean }) {
  const t = useTranslations("admissions.enroll");
  const ta = useTranslations("admissions.actions");
  const tc = useTranslations("common");
  const classes = useClasses();
  const options = classes.data?.filter((c) => c.gradeId === app.applyingGradeId) ?? [];
  const [classId, setClassId] = useState("");
  const [invite, setInvite] = useState(true);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ studentId: string; admissionNo: string; inviteLink?: string } | null>(null);
  const enroll = useApiMutation(
    () => api.post<{ studentId: string; admissionNo: string; inviteLink?: string }>(`/applications/${app.id}/enroll`, { classId, inviteParent: invite }),
    { invalidate: [...INVALIDATE, ["students"], ["classes"]], onSuccess: (r) => setResult(r) },
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button>
            <UserRoundCheck /> {ta("enroll")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("doneTitle")}</DialogTitle>
              <DialogDescription>{t("doneBody", { admissionNo: result.admissionNo })}</DialogDescription>
            </DialogHeader>
            {result.inviteLink && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="mb-1 text-muted-foreground">{t("inviteLink")}</p>
                <Link href={result.inviteLink} className="break-all font-mono text-xs text-primary hover:underline">
                  {result.inviteLink}
                </Link>
              </div>
            )}
            <DialogFooter>
              <Button asChild>
                <Link href={`/app/students/${result.studentId}`}>{ta("viewStudent")}</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("title", { name: `${app.student.firstName} ${app.student.lastName}` })}</DialogTitle>
              <DialogDescription>{t("body")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel>{t("class")}</FieldLabel>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={tc("selectPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {tc("studentCount", { count: c.studentCount })}{c.streamName ? ` · ${c.streamName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="invite" checked={invite} onCheckedChange={(c) => setInvite(c === true)} />
                <FieldLabel htmlFor="invite" className="font-normal">
                  {t("invite")}
                </FieldLabel>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button disabled={!classId || enroll.isPending} onClick={() => enroll.mutate(undefined)}>
                {enroll.isPending && <Spinner />} {t("submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
