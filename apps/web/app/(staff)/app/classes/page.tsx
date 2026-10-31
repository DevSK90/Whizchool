"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { FilterSelect } from "@/components/shared/filters";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useClasses, useGrades, useSchool, useStaff, useStreams, useYears } from "@/lib/api/hooks";
import type { ClassSummary, GradeLevel } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";

const LEVELS: GradeLevel[] = ["primary", "junior", "ol", "al"];
const levelOf = (n: number): GradeLevel => (n <= 5 ? "primary" : n <= 9 ? "junior" : n <= 11 ? "ol" : "al");

export default function ClassesPage() {
  const t = useTranslations("academics.classes");
  const tl = useTranslations("status.level");
  const can = useCan();
  const { data: school } = useSchool();
  const years = useYears();
  const { data, error, refetch, isPending } = useClasses();
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const yearName = years.data?.find((y) => y.id === school?.currentYearId)?.name ?? "";

  return (
    <>
      <PageHeader title={t("title")} description={t("description", { year: yearName })} actions={can("classes.create") && <CreateClassDialog />} />
      <div className="space-y-8">
        {LEVELS.map((level) => {
          const rows = data.filter((c) => levelOf(c.gradeNumber) === level);
          if (!rows.length) return null;
          return (
            <section key={level}>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                {tl(level)} · {rows.reduce((a, c) => a + c.studentCount, 0)}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {rows.map((c) => (
                  <ClassCard key={c.id} c={c} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ClassCard({ c }: { c: ClassSummary }) {
  const t = useTranslations("academics.classes");
  return (
    <Link href={`/app/classes/${c.id}`} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      <Card className="gap-0 py-0 shadow-none transition-colors hover:border-primary/40">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">{c.name}</p>
              {c.streamName && <p className="text-xs text-muted-foreground">{c.streamName}</p>}
            </div>
            <span className="flex items-center gap-1 text-sm text-muted-foreground tabular">
              <Users className="size-4" /> {c.studentCount}
            </span>
          </div>
          <p className="truncate text-sm">{c.classTeacherName ?? <span className="text-muted-foreground">{t("noTeacher")}</span>}</p>
          {c.room && <p className="text-xs text-muted-foreground">{t("room", { room: c.room })}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

function CreateClassDialog() {
  const t = useTranslations("academics.classes.create");
  const tc = useTranslations("common");
  const grades = useGrades();
  const streams = useStreams();
  const staff = useStaff();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ gradeId: "", section: "", streamId: "", classTeacherId: "", room: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isAL = grades.data?.find((g) => g.id === form.gradeId)?.level === "al";
  const create = useApiMutation(() => api.post<ClassSummary>("/classes", form), {
    invalidate: [["classes"]],
    success: (c) => t("done", { name: c.name }),
    toastError: false,
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm({ gradeId: "", section: "", streamId: "", classTeacherId: "", room: "" });
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.gradeId}>
              <FieldLabel>{t("grade")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("grade")}
                value={form.gradeId}
                onChange={(v) => setForm({ ...form, gradeId: v })}
                options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
                allLabel={tc("selectPlaceholder")}
                className="sm:w-full"
              />
              <FieldError>{errors.gradeId}</FieldError>
            </Field>
            <Field data-invalid={!!errors.section}>
              <FieldLabel htmlFor="section">{t("section")}</FieldLabel>
              <Input id="section" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value.toUpperCase() })} aria-invalid={!!errors.section} />
              <FieldDescription>{t("sectionHint")}</FieldDescription>
              <FieldError>{errors.section}</FieldError>
            </Field>
          </div>
          {isAL && (
            <Field data-invalid={!!errors.streamId}>
              <FieldLabel>{t("stream")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("stream")}
                value={form.streamId}
                onChange={(v) => setForm({ ...form, streamId: v })}
                options={(streams.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
                allLabel={tc("none")}
                className="sm:w-full"
              />
              <FieldError>{errors.streamId}</FieldError>
            </Field>
          )}
          <Field data-invalid={!!errors.classTeacherId}>
            <FieldLabel>{t("classTeacher")}</FieldLabel>
            <FilterSelect
              ariaLabel={t("classTeacher")}
              value={form.classTeacherId}
              onChange={(v) => setForm({ ...form, classTeacherId: v })}
              options={(staff.data ?? []).filter((s) => s.staffType === "academic").map((s) => ({ value: s.id, label: s.name }))}
              allLabel={tc("none")}
              className="sm:w-full"
            />
            <FieldError>{errors.classTeacherId}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="room">{t("room")}</FieldLabel>
            <Input id="room" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            disabled={create.isPending}
            onClick={() =>
              create.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : { section: e.message }))
            }
          >
            {create.isPending && <Spinner />} {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
