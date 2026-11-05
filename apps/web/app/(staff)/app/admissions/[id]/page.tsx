"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { CalendarClock, CalendarDays, Check, FileText, Plus, UserRoundCheck, X, Undo2 } from "lucide-react";
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
import { useApiMutation, useApplication, useClass, useClasses } from "@/lib/api/hooks";
import type { Application, ApplicationStage } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";
import { formatDate, formatDateTime, toISODate } from "@/lib/format";
import { DatePicker, TimeSelect } from "@/components/shared/date-picker";
import { SubjectChoices } from "@/components/students/subject-choices";
import { canTextPhone } from "@whizchool/shared/admissions";
import { checkFile, uploadFile } from "@/lib/uploads";

const INVALIDATE = [["applications"], ["application"], ["dashboard"]];

export default function ApplicationDetailPage({ params }: PageProps<"/app/admissions/[id]">) {
  const { id } = use(params);
  const t = useTranslations("admissions");
  const ts = useTranslations("status");
  const can = useCan();
  const { data: a, error, refetch, isPending } = useApplication(id);
  const transition = useApiMutation(
    (body: { to: ApplicationStage; note?: string; interviewAt?: string; enrollmentDate?: string }) => api.post(`/applications/${id}/transition`, body),
    { invalidate: INVALIDATE, success: (_, v) => t("actions.moved", { stage: ts(`application.${v.to}`) }) },
  );

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const name = `${a.student.firstName} ${a.student.lastName}`;
  const canEdit = can("admissions.edit");
  const canApprove = can("admissions.approve");
  const open = a.stage === "new" || a.stage === "interview";
  const today = toISODate(new Date());
  const tooEarly = a.stage === "accepted" && !!a.enrollmentDate && today < a.enrollmentDate;
  const unreachable = ["new", "interview", "accepted"].includes(a.stage) && !a.guardian.email && !canTextPhone(a.guardian.phone);

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
                <EnrollmentDateDialog
                  trigger={<Button><Check /> {t("actions.accept")}</Button>}
                  title={t("actions.acceptTitle")}
                  body={t("actions.acceptBody")}
                  confirm={t("actions.accept")}
                  withNote
                  onSubmit={(b) => transition.mutateAsync({ to: "accepted", ...b })}
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
            {a.stage === "accepted" && canApprove && (
              <EnrollmentDateDialog
                trigger={<Button variant="outline"><CalendarDays /> {t("actions.changeDate")}</Button>}
                title={t("actions.changeDate")}
                body={t("actions.changeDateBody")}
                confirm={t("actions.changeDateSave")}
                initial={a.enrollmentDate}
                onSubmit={(b) => transition.mutateAsync({ to: "accepted", ...b })}
              />
            )}
            {(a.stage === "accepted" || a.stage === "enrolled") && canApprove && <EnrollDialog app={a} showTrigger={a.stage === "accepted"} tooEarly={tooEarly} />}
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

      {a.stage === "accepted" && a.enrollmentDate && (
        <Alert className="mb-6">
          <CalendarDays />
          <AlertTitle>{t("detail.enrollmentDate")}: {formatDate(a.enrollmentDate)}</AlertTitle>
          <AlertDescription>{tooEarly ? t("detail.enrollFrom") : t("detail.enrollOpen")}</AlertDescription>
        </Alert>
      )}

      {unreachable && (
        <Alert className="mb-6">
          <AlertDescription>{t("detail.unreachable")}</AlertDescription>
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
                  { label: t("detail.fields.email"), value: a.guardian.email && <a href={`mailto:${a.guardian.email}`} className="hover:underline">{a.guardian.email}</a> },
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
                      {d.url ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={d.url} target="_blank" rel="noopener noreferrer">
                            {Math.round(d.size / 1024)} KB
                          </a>
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => toast.info(t("detail.previewDemo"))}>
                          {Math.round(d.size / 1024)} KB
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (open || a.stage === "accepted") && a.documents.length < 6 && <AddDocument app={a} />}
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

/** Accepting and changing the date are the same choice: which day the student comes to enrol. */
function EnrollmentDateDialog({
  trigger,
  title,
  body,
  confirm,
  initial,
  withNote,
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  body: string;
  confirm: string;
  initial?: string;
  withNote?: boolean;
  onSubmit: (b: { enrollmentDate: string; note?: string }) => Promise<unknown>;
}) {
  const t = useTranslations("admissions.actions");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initial ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!date) return setErr(tc("required"));
            setBusy(true);
            try {
              await onSubmit({ enrollmentDate: date, note: note || undefined });
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
              <FieldLabel htmlFor="enrollmentDate">{t("enrollmentDate")}</FieldLabel>
              <DatePicker id="enrollmentDate" value={date} min={toISODate(new Date())} invalid={!!err} onChange={setDate} />
              <FieldError>{err}</FieldError>
            </Field>
            {withNote && (
              <Field>
                <FieldLabel htmlFor="enote">{t("note")}</FieldLabel>
                <Textarea id="enote" rows={2} value={note} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />} {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A document the parent brought after applying. */
function AddDocument({ app }: { app: Application }) {
  const t = useTranslations("admissions.detail");
  const ta = useTranslations("apply.documents");
  const [kind, setKind] = useState<"birth_certificate" | "photo" | "report">(app.documents.some((d) => d.kind === "birth_certificate") ? "report" : "birth_certificate");
  const [busy, setBusy] = useState(false);
  const add = useApiMutation((file: { name: string; size: number; fileId: string }) => api.post(`/applications/${app.id}/documents`, { ...file, kind }), { invalidate: INVALIDATE, success: t("documentAdded") });
  async function pick(file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file, "application-document");
    if (problem) return void toast.error(ta(problem, { name: file.name }));
    setBusy(true);
    try {
      const ref = await uploadFile(file, "application-document");
      await add.mutateAsync({ name: file.name, size: file.size, fileId: ref.id });
    } catch (e) {
      if (!add.isError) toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
        <SelectTrigger className="w-48" aria-label={t("documentKind")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["birth_certificate", "photo", "report"] as const).map((k) => (
            <SelectItem key={k} value={k}>
              {ta(k)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" asChild disabled={busy}>
        <label className="cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
          {busy ? <Spinner /> : <Plus />} {t("addDocument")}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </Button>
    </div>
  );
}

function InterviewDialog({ app, onSubmit }: { app: Application; onSubmit: (b: { interviewAt: string; note?: string }) => Promise<unknown> }) {
  const t = useTranslations("admissions.actions");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(app.interviewAt ? format(new Date(app.interviewAt), "yyyy-MM-dd'T'HH:mm") : "");
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
function EnrollDialog({ app, showTrigger, tooEarly }: { app: Application & { gradeName?: string }; showTrigger: boolean; tooEarly: boolean }) {
  const t = useTranslations("admissions.enroll");
  const ta = useTranslations("admissions.actions");
  const tc = useTranslations("common");
  const classes = useClasses();
  const options = classes.data?.filter((c) => c.gradeId === app.applyingGradeId) ?? [];
  const [classId, setClassId] = useState("");
  const [invite, setInvite] = useState(true);
  const [choices, setChoices] = useState<string[]>([]);
  const { data: cls } = useClass(classId);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ studentId: string; admissionNo: string; inviteLink?: string } | null>(null);
  const enroll = useApiMutation(
    () => api.post<{ studentId: string; admissionNo: string; inviteLink?: string }>(`/applications/${app.id}/enroll`, { classId, inviteParent: invite && !!app.guardian.email, electiveSubjectIds: choices }),
    { invalidate: [...INVALIDATE, ["students"], ["classes"]], onSuccess: (r) => setResult(r) },
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button disabled={tooEarly}>
            <UserRoundCheck /> {ta("enroll")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-3xl">
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
                <Select
                  value={classId}
                  onValueChange={(v) => {
                    setClassId(v);
                    setChoices([]);
                  }}
                >
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
              <SubjectChoices cls={cls} value={choices} onChange={setChoices} />
              {cls?.subjects.some((s) => s.optionGroup) && <p className="text-xs text-muted-foreground">{t("choicesLater")}</p>}
              {app.guardian.email && (
                <Field orientation="horizontal">
                  <Checkbox id="invite" checked={invite} onCheckedChange={(c) => setInvite(c === true)} />
                  <FieldLabel htmlFor="invite" className="font-normal">
                    {t("invite")}
                  </FieldLabel>
                </Field>
              )}
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
