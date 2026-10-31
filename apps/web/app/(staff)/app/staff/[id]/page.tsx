"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarDays, KeyRound, Pencil, Undo2, UserMinus } from "lucide-react";
import type { StaffDetail } from "@whizchool/shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { DetailList } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { LoginRoles } from "@/components/staff/staff-form";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useStaffMember } from "@/lib/api/hooks";
import { useCan, useSession } from "@/lib/auth";
import { formatDate, toISODate } from "@/lib/format";

const invalidateFor = (id: string) => [["staff"], ["staffMember", id], ["users"], ["subjects"]];

export default function StaffProfilePage({ params }: PageProps<"/app/staff/[id]">) {
  const { id } = use(params);
  const t = useTranslations("staff");
  const tf = useTranslations("staff.form");
  const tp = useTranslations("staff.profile");
  const ts = useTranslations("status");
  const can = useCan();
  const user = useSession();
  const { data: s, error, refetch, isPending } = useStaffMember(id);
  const [dialog, setDialog] = useState<"leave" | "return" | "login" | null>(null);
  const back = useApiMutation(() => api.post(`/staff/${id}/return`), { invalidate: invalidateFor(id), success: tp("returned") });

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const active = s.status === "active";
  const canTimetable = can("timetable.view") && user?.roles.some((r) => r.scope === "all");
  const classes = new Map<string, { className: string; leads: boolean; subjects: string[] }>();
  for (const item of s.teaching) {
    const row = classes.get(item.classId) ?? { className: item.className, leads: false, subjects: [] };
    if (item.subjectName) row.subjects.push(item.subjectName);
    else row.leads = true;
    classes.set(item.classId, row);
  }

  return (
    <>
      <PageHeader
        back={{ href: "/app/staff", label: t("title") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.name}
            <StatusBadge kind="staff" status={s.status} />
          </span>
        }
        description={`${s.empNo} · ${s.designation} · ${t(`types.${s.staffType}`)}`}
        actions={
          <>
            {s.staffType === "academic" && canTimetable && (
              <Button variant="outline" asChild>
                <Link href={`/app/timetables?tab=teachers&staff=${s.id}`}>
                  <CalendarDays /> {tp("timetable")}
                </Link>
              </Button>
            )}
            {can("users.create") && active && !s.userId && (
              <Button variant="outline" onClick={() => setDialog("login")}>
                <KeyRound /> {tp("giveLogin")}
              </Button>
            )}
            {can("staff.edit") && (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/app/staff/${s.id}/edit`}>
                    <Pencil /> {tp("edit")}
                  </Link>
                </Button>
                {active ? (
                  <Button variant="outline" onClick={() => setDialog("leave")}>
                    <UserMinus /> {tp("markLeft")}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setDialog("return")}>
                    <Undo2 /> {tp("markReturned")}
                  </Button>
                )}
              </>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{tf("personal")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: tf("phone"), value: <a href={`tel:${s.phone.replace(/\s/g, "")}`} className="hover:underline">{s.phone}</a> },
                { label: tf("email"), value: s.email && <a href={`mailto:${s.email}`} className="hover:underline">{s.email}</a> },
                { label: tf("gender"), value: s.gender && ts(`gender.${s.gender}`) },
                { label: tf("dob"), value: s.dob && formatDate(s.dob) },
                { label: tf("nic"), value: s.nic },
                { label: tf("address"), value: s.address },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tf("employment")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: tf("designation"), value: s.designation },
                { label: tf("type"), value: t(`types.${s.staffType}`) },
                { label: tf("joinedOn"), value: s.joinedOn && formatDate(s.joinedOn) },
                { label: tp("leftOn"), value: s.leftOn && formatDate(s.leftOn) },
                { label: tp("leaveReason"), value: s.leaveReason },
                { label: tf("qualifications"), value: s.qualifications && <span className="whitespace-pre-line">{s.qualifications}</span> },
                { label: tf("notes"), value: s.notes && <span className="whitespace-pre-line">{s.notes}</span> },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tf("emergency")}</CardTitle>
          </CardHeader>
          <CardContent>
            {s.emergencyName || s.emergencyPhone ? (
              <DetailList
                items={[
                  { label: tf("emergencyName"), value: s.emergencyName },
                  { label: tf("emergencyPhone"), value: s.emergencyPhone && <a href={`tel:${s.emergencyPhone.replace(/\s/g, "")}`} className="hover:underline">{s.emergencyPhone}</a> },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{tp("noEmergency")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tf("login")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {s.loginStatus ? (
              <>
                <p>{tp(`loginStatus.${s.loginStatus}`)}</p>
                {can("users.view") && s.email && (
                  <Link href={`/app/users?search=${encodeURIComponent(s.email)}`} className="text-primary hover:underline">
                    {tp("manageLogin")}
                  </Link>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{tp("noLogin")}</p>
            )}
          </CardContent>
        </Card>
        {(!!classes.size || !!s.subjects.length || s.staffType === "academic") && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{tp("teaching")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!!s.subjects.length && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-sm text-muted-foreground">{tp("teachingLists")}</span>
                  {s.subjects.map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              {classes.size ? <TeachingList classes={classes} /> : <p className="text-sm text-muted-foreground">{tp("noTeaching")}</p>}
            </CardContent>
          </Card>
        )}
      </div>
      <LeaveDialog staff={s} open={dialog === "leave"} onOpenChange={(o) => setDialog(o ? "leave" : null)} classes={classes} />
      <LoginDialog staff={s} open={dialog === "login"} onOpenChange={(o) => setDialog(o ? "login" : null)} />
      <ConfirmDialog
        open={dialog === "return"}
        onOpenChange={(o) => setDialog(o ? "return" : null)}
        title={tp("returnTitle", { name: s.name })}
        description={tp("returnDescription")}
        confirmLabel={tp("markReturned")}
        onConfirm={() => back.mutateAsync(undefined).catch(() => undefined)}
      />
    </>
  );
}

function TeachingList({ classes }: { classes: Map<string, { className: string; leads: boolean; subjects: string[] }> }) {
  const tp = useTranslations("staff.profile");
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {[...classes].map(([id, c]) => (
        <li key={id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
          <Link href={`/app/classes/${id}`} className="font-medium hover:underline">
            {c.className}
          </Link>
          <span className="text-muted-foreground">{[...(c.leads ? [tp("classTeacher")] : []), ...c.subjects].join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

function LeaveDialog({
  staff,
  open,
  onOpenChange,
  classes,
}: {
  staff: StaffDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: Map<string, { className: string; leads: boolean; subjects: string[] }>;
}) {
  const tp = useTranslations("staff.profile");
  const tc = useTranslations("common");
  const today = toISODate(new Date());
  const [leftOn, setLeftOn] = useState(today);
  const [reason, setReason] = useState("");
  const [dateError, setDateError] = useState<string>();
  const leave = useApiMutation(() => api.post(`/staff/${staff.id}/leave`, { leftOn, reason: reason || undefined }), {
    invalidate: invalidateFor(staff.id),
    success: tp("leftDone", { name: staff.name }),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tp("leaveTitle", { name: staff.name })}</DialogTitle>
          <DialogDescription>{classes.size ? tp("leaveBlocked") : tp("leaveDescription")}</DialogDescription>
        </DialogHeader>
        {classes.size ? (
          <TeachingList classes={classes} />
        ) : (
          <FieldGroup>
            <Field data-invalid={!!dateError}>
              <FieldLabel htmlFor="leftOn">{tp("leftOn")}</FieldLabel>
              <DatePicker id="leftOn" value={leftOn} onChange={setLeftOn} invalid={!!dateError} />
              <FieldError>{dateError}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="leaveReason">{tp("leaveReason")}</FieldLabel>
              <Input id="leaveReason" placeholder={tp("leaveReasonPlaceholder")} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </FieldGroup>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {classes.size ? tc("close") : tc("cancel")}
          </Button>
          {!classes.size && (
            <Button variant="destructive" disabled={leave.isPending} onClick={() => leave.mutateAsync(undefined).catch((e: unknown) => setDateError(e instanceof ApiError ? e.fields?.leftOn : undefined))}>
              {leave.isPending && <Spinner />}
              {tp("markLeft")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoginDialog({ staff, open, onOpenChange }: { staff: StaffDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const tp = useTranslations("staff.profile");
  const tc = useTranslations("common");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const invite = useApiMutation(() => api.post(`/staff/${staff.id}/invite`, { roleIds }), {
    invalidate: invalidateFor(staff.id),
    success: tp("loginSent", { email: staff.email ?? "" }),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tp("giveLoginTitle", { name: staff.name })}</DialogTitle>
          <DialogDescription>{staff.email ? tp("giveLoginDescription", { email: staff.email }) : tp("giveLoginNoEmail")}</DialogDescription>
        </DialogHeader>
        {!!staff.email && <LoginRoles value={roleIds} onChange={setRoleIds} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          {!!staff.email && (
            <Button disabled={!roleIds.length || invite.isPending} onClick={() => invite.mutate(undefined)}>
              {invite.isPending && <Spinner />}
              {tp("sendInvite")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
