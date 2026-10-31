"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarCheck, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTable } from "@/components/shared/data-table";
import { FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { useApiMutation, useClass, useStaff } from "@/lib/api/hooks";
import type { ClassDetail } from "@whizchool/shared/types";
import { useCan, useSession } from "@/lib/auth";
import { formatMoney } from "@/lib/format";

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
              { key: "guardian", header: ts("guardian"), hideBelow: "md", cell: (s) => <span className="text-muted-foreground">{s.guardianPhone}</span> },
              ...(can("fees.view")
                ? [{ key: "bal", header: ts("balance"), className: "text-right tabular", headClassName: "text-right", cell: (s: ClassDetail["students"][number]) => (s.balance > 0 ? formatMoney(s.balance) : "—") }]
                : []),
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
            options={(staff.data ?? []).filter((s) => s.designation.startsWith("Teacher")).map((s) => ({ value: s.id, label: s.name }))}
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
  const staff = useStaff();
  const assign = useApiMutation((v: { id: string; teacherId: string }) => api.put(`/class-subjects/${v.id}`, { teacherId: v.teacherId }), {
    invalidate: [["class", c.id]],
    success: t("teacherSaved"),
  });
  const teachers = (staff.data ?? []).filter((s) => s.designation.startsWith("Teacher")).map((s) => ({ value: s.id, label: s.name }));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{t("subject")}</TableHead>
          <TableHead className="pr-6">{t("teacher")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {c.subjects.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="pl-6 align-middle text-sm">{s.subjectName}</TableCell>
            <TableCell className="pr-6">
              {editable ? (
                <FilterSelect
                  ariaLabel={`${t("teacher")} – ${s.subjectName}`}
                  value={s.teacherId ?? ""}
                  onChange={(v) => assign.mutate({ id: s.id, teacherId: v })}
                  allLabel={t("unassigned")}
                  options={teachers}
                  className="h-8 sm:w-full"
                />
              ) : (
                <span className="text-sm">{s.teacherName ?? t("unassigned")}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
