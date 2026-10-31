"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Printer, Send } from "lucide-react";
import type { TimetablePublishResult } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/states";
import { Pill } from "@/components/shared/status-badge";
import { TimetableBoard } from "@/components/timetable/timetable-board";
import { api } from "@/lib/api/client";
import { useApiMutation, useStaff, useStaffTimetable, useTimetableOverview } from "@/lib/api/hooks";
import { useCan, useSession } from "@/lib/auth";
import { useUrlState } from "@/hooks/use-url-state";

export default function TimetablesPage() {
  const t = useTranslations("academics.timetables");
  const can = useCan();
  const user = useSession();
  const url = useUrlState<"tab" | "staff">({ tab: "classes" });
  const fullScope = user?.roles.some((r) => r.scope === "all");
  const tab = url.get("tab");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/app/timetables/me">
              <CalendarClock /> {t("mine")}
            </Link>
          </Button>
        }
      />
      {fullScope ? (
        <Tabs value={tab} onValueChange={(v) => url.set({ tab: v })}>
          <TabsList className="no-print mb-4">
            <TabsTrigger value="classes">{t("tabs.classes")}</TabsTrigger>
            <TabsTrigger value="teachers">{t("tabs.teachers")}</TabsTrigger>
          </TabsList>
          <TabsContent value="classes">{tab === "classes" && <ClassList editable={can("timetable.edit")} />}</TabsContent>
          <TabsContent value="teachers">{tab === "teachers" && <TeacherLookup staffId={url.get("staff")} onChange={(staff) => url.set({ staff })} />}</TabsContent>
        </Tabs>
      ) : (
        <ClassList editable={can("timetable.edit")} />
      )}
    </>
  );
}

function ClassList({ editable }: { editable: boolean }) {
  const t = useTranslations("academics.timetables");
  const router = useRouter();
  const { data, error, refetch, isPending } = useTimetableOverview();
  const [result, setResult] = useState<TimetablePublishResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const publishAll = useApiMutation(() => api.post<TimetablePublishResult>("/timetables/publish"), {
    invalidate: [["timetables"], ["timetable"]],
    onSuccess: setResult,
  });
  const waiting = data?.filter((r) => r.hasUnpublishedChanges && r.lessons > 0).length ?? 0;
  return (
    <>
      {editable && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("waiting", { count: waiting })}</p>
          <Button disabled={!waiting} onClick={() => setConfirm(true)}>
            <Send /> {t("publishAll")}
          </Button>
        </div>
      )}
      {result && (
        <div className="mb-4 rounded-lg border p-3 text-sm" role="status">
          <p className="font-medium">{t("publishedCount", { count: result.published.length })}</p>
          {!!result.blocked.length && (
            <>
              <p className="mt-2 font-medium">{t("blockedCount", { count: result.blocked.length })}</p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {result.blocked.map((b) => (
                  <li key={b.classId}>
                    <Link href={`/app/timetables/${b.classId}`} className="font-medium text-foreground hover:underline">
                      {b.className}
                    </Link>
                    : {b.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <DataTable
        rows={data}
        loading={isPending}
        error={error}
        onRetry={refetch}
        rowKey={(r) => r.classId}
        onRowClick={(r) => router.push(`/app/timetables/${r.classId}`)}
        columns={[
          { key: "class", header: t("columns.class"), cell: (r) => <span className="font-medium">{r.className}</span> },
          { key: "teacher", header: t("columns.teacher"), hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{r.classTeacherName ?? "—"}</span> },
          { key: "lessons", header: t("columns.lessons"), className: "tabular", cell: (r) => r.lessons },
          {
            key: "status",
            header: t("columns.status"),
            cell: (r) =>
              !r.publishedAt ? (
                <Pill tone="neutral">{t(r.lessons ? "status.draft" : "status.empty")}</Pill>
              ) : r.hasUnpublishedChanges ? (
                <Pill tone="warning">{t("status.changes")}</Pill>
              ) : (
                <Pill tone="success">{t("status.live")}</Pill>
              ),
          },
          { key: "clashes", header: t("columns.clashes"), hideBelow: "sm", className: "tabular", cell: (r) => (r.clashes ? <Pill tone="danger">{r.clashes}</Pill> : "—") },
        ]}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("publishAllTitle")}
        description={t("publishAllDescription", { count: waiting })}
        confirmLabel={t("publishAll")}
        onConfirm={() => publishAll.mutateAsync(undefined).catch(() => undefined)}
      />
    </>
  );
}

function TeacherLookup({ staffId, onChange }: { staffId?: string; onChange: (id: string) => void }) {
  const t = useTranslations("academics.timetables");
  const staff = useStaff();
  const week = useStaffTimetable(staffId);
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Select value={staffId ?? ""} onValueChange={onChange}>
          <SelectTrigger className="w-72" aria-label={t("chooseTeacher")}>
            <SelectValue placeholder={t("chooseTeacher")} />
          </SelectTrigger>
          <SelectContent>
            {staff.data
              ?.filter((s) => s.status === "active")
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {week.data && (
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> {t("print")}
          </Button>
        )}
      </div>
      {week.data && (week.data.blocks.length ? <TimetableBoard hours={week.data.hours} blocks={week.data.blocks} /> : <EmptyState title={t("teacherEmpty")} />)}
    </>
  );
}
