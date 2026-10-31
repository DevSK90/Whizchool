"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarCheck, CalendarDays, X } from "lucide-react";
import { gradeLevelOf } from "@whizchool/shared/curriculum";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DataTable } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filters";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { useApiMutation, useClass, useStaff, useSubjects } from "@/lib/api/hooks";
import type { ClassDetail } from "@whizchool/shared/types";
import { useCan, useSession } from "@/lib/auth";

export default function ClassDetailPage({ params }: PageProps<"/app/classes/[id]">) {
  const { id } = use(params);
  const t = useTranslations("academics.classes");
  const tc = useTranslations("common");
  const ts = useTranslations("students.columns");
  const tt = useTranslations("academics.timetables");
  const router = useRouter();
  const can = useCan();
  const user = useSession();
  const { data: c, error, refetch, isPending } = useClass(id);
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const canAttend = can("attendance.create") && (user?.roles.some((r) => r.scope === "all") || user?.classIds.includes(id));

  return (
    <>
      <PageHeader
        back={{ href: "/app/classes", label: t("detail.back") }}
        title={`${c.name}${c.streamName ? ` · ${c.streamName}` : ""}`}
        description={`${c.gradeName} · ${t("students", { count: c.studentCount })}${c.classTeacherName ? ` · ${c.classTeacherName}` : ""}`}
        actions={
          <>
            {can("timetable.view") && (
              <Button variant="outline" asChild>
                <Link href={`/app/timetables/${id}`}>
                  <CalendarDays /> {tt("open")}
                </Link>
              </Button>
            )}
            {canAttend && (
              <Button asChild>
                <Link href={`/app/attendance/${id}`}>
                  <CalendarCheck /> {t("detail.takeAttendance")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          {can("classes.edit") && <ClassSettings c={c} />}
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.subjects")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <SubjectTeachers c={c} editable={can("classes.edit")} />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">{t("detail.roster")}</h2>
          <DataTable
            rows={c.students}
            rowKey={(s) => s.id}
            onRowClick={can("students.view") ? (s) => router.push(`/app/students/${s.id}`) : undefined}
            columns={[
              { key: "adm", header: ts("admissionNo"), cell: (s) => <span className="tabular text-muted-foreground">{s.admissionNo}</span> },
              { key: "name", header: ts("name"), cell: (s) => <span className="font-medium">{s.fullName}</span> },
              { key: "guardian", header: ts("guardian"), hideBelow: "md", cell: (s) => <span className="text-muted-foreground">{s.primaryGuardian}</span> },
              { key: "phone", header: ts("guardianPhone"), hideBelow: "md", cell: (s) => <span className="tabular text-muted-foreground">{s.guardianPhone}</span> },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">{tc("total")}: {c.students.length}</p>
        </div>
      </div>
    </>
  );
}

function ClassSettings({ c }: { c: ClassDetail }) {
  const t = useTranslations("academics.classes.detail");
  const tc = useTranslations("common");
  const staff = useStaff();
  const [teacher, setTeacher] = useState(c.classTeacherId ?? "");
  const [room, setRoom] = useState(c.room ?? "");
  const save = useApiMutation(() => api.put(`/classes/${c.id}`, { classTeacherId: teacher, room }), {
    invalidate: [["class", c.id], ["classes"]],
    success: t("saved"),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("edit")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel>{t("classTeacher")}</FieldLabel>
          <FilterSelect
            ariaLabel={t("classTeacher")}
            value={teacher}
            onChange={setTeacher}
            allLabel={tc("none")}
            options={(staff.data ?? []).filter((s) => s.staffType === "academic").map((s) => ({ value: s.id, label: s.name }))}
            className="sm:w-full"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="room">{t("room")}</FieldLabel>
          <Input id="room" value={room} onChange={(e) => setRoom(e.target.value)} />
        </Field>
        <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          {save.isPending && <Spinner />} {t("save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function SubjectTeachers({ c, editable }: { c: ClassDetail; editable: boolean }) {
  const t = useTranslations("academics.classes.detail");
  const tg = useTranslations("academics.optionGroups");
  const staff = useStaff();
  const catalogue = useSubjects();
  const refresh = [["class", c.id], ["timetable", c.id]];
  const assign = useApiMutation((v: { id: string; teacherId: string }) => api.put(`/class-subjects/${v.id}`, { teacherId: v.teacherId }), {
    invalidate: [["class", c.id]],
    success: t("teacherSaved"),
  });
  const add = useApiMutation((subjectId: string) => api.post(`/classes/${c.id}/subjects`, { subjectId }), { invalidate: refresh, success: t("subjectAdded") });
  const remove = useApiMutation((id: string) => api.delete(`/class-subjects/${id}`), { invalidate: refresh, success: t("subjectRemoved") });
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const allTeachers = (staff.data ?? []).filter((s) => s.staffType === "academic");
  const nameOf = new Map((staff.data ?? []).map((s) => [s.id, s.name]));
  /** The subject's teacher list, or every teacher while it has none; the current teacher always stays selectable. */
  const optionsFor = (s: ClassDetail["subjects"][number]) => {
    const listed = catalogue.data?.find((x) => x.id === s.subjectId)?.teacherIds ?? [];
    const ids = listed.length ? [...new Set([...listed, ...(s.teacherId ? [s.teacherId] : [])])] : allTeachers.map((x) => x.id);
    return ids.map((id) => ({ value: id, label: nameOf.get(id) ?? id }));
  };
  const level = gradeLevelOf(c.gradeNumber);
  const offered = new Set(c.subjects.map((s) => s.subjectId));
  const canAdd = (catalogue.data ?? []).filter((s) => s.levels.includes(level) && !offered.has(s.id) && (level !== "al" || s.streamIds?.includes(c.streamId ?? "")));
  return (
    <>
      <ul className="divide-y border-t">
        {c.subjects.map((s) => (
          <li key={s.id} className="px-6 py-2">
            <p className="text-sm">
              {s.subjectName}
              {s.optionGroup && <span className="ml-2 text-xs text-muted-foreground">{tg(s.optionGroup as "options")}</span>}
            </p>
            {editable ? (
              <div className="mt-1 flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <FilterSelect
                    ariaLabel={`${t("teacher")} – ${s.subjectName}`}
                    value={s.teacherId ?? ""}
                    onChange={(v) => assign.mutate({ id: s.id, teacherId: v })}
                    allLabel={t("unassigned")}
                    options={optionsFor(s)}
                    className="h-8 sm:w-full"
                  />
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t("removeSubject", { name: s.subjectName })} onClick={() => setRemoving({ id: s.id, name: s.subjectName })}>
                  <X />
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{s.teacherName ?? t("unassigned")}</p>
            )}
          </li>
        ))}
      </ul>
      {(c.pendingChoices > 0 || !!c.optionsRequired) && (
        <div className="space-y-1 px-6 pt-3 text-sm text-muted-foreground">
          {!!c.optionsRequired && <p>{t("pickOptions", { count: c.optionsRequired })}</p>}
          {c.pendingChoices > 0 && <p>{t("pendingChoices", { count: c.pendingChoices })}</p>}
        </div>
      )}
      {editable && !!canAdd.length && (
        <div className="px-6 pt-3">
          <FilterSelect
            ariaLabel={t("addSubject")}
            value=""
            onChange={(v) => v && add.mutate(v)}
            allLabel={t("addSubject")}
            options={canAdd.map((s) => ({ value: s.id, label: s.examNo ? `${s.name} (${s.examNo})` : s.name }))}
            className="h-8 sm:w-full"
          />
        </div>
      )}
      {editable && !!catalogue.data && !canAdd.length && <p className="px-6 pt-3 text-sm text-muted-foreground">{t("allSubjectsAdded")}</p>}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("removeTitle", { name: removing?.name ?? "" })}
        description={t("removeDescription")}
        confirmLabel={t("remove")}
        destructive
        onConfirm={() => remove.mutateAsync(removing!.id).catch(() => undefined)}
      />
    </>
  );
}
