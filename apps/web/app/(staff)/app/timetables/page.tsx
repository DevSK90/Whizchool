"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, ChevronDown, Printer, Send } from "lucide-react";
import type { TimetablePublishResult } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/states";
import { Pill } from "@/components/shared/status-badge";
import { TimetableBoard } from "@/components/timetable/timetable-board";
import { api } from "@/lib/api/client";
import { useApiMutation, useStaff, useStaffTimetable, useTimetableOverview } from "@/lib/api/hooks";
import { useCan, useSession } from "@/lib/auth";
import { useUrlState } from "@/hooks/use-url-state";

/** Ignores case, spaces and punctuation, so "10a" finds 10-A. */
const matches = (text: string | undefined, search: string) => {
  const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return plain(text ?? "").includes(plain(search));
};

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
  const url = useUrlState<"search">();
  const search = url.get("search");
  const rows = search ? data?.filter((r) => matches(r.className, search) || matches(r.classTeacherName, search)) : data;
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
      <FilterBar>
        <SearchInput value={search} onChange={(v) => url.set({ search: v })} placeholder={t("searchClasses")} />
      </FilterBar>
      <DataTable
        rows={rows}
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
  const tc = useTranslations("common");
  const week = useStaffTimetable(staffId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const active = staff.data?.filter((s) => s.staffType === "academic") ?? [];
  const shown = active.filter((s) => matches(s.name, search));
  const chosen = staff.data?.find((s) => s.id === staffId);
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={t("chooseTeacher")} className="w-full justify-between font-normal sm:w-72">
              {chosen ? chosen.name : <span className="text-muted-foreground">{t("chooseTeacher")}</span>}
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder={t("searchTeacher")} value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>{tc("noResults")}</CommandEmpty>
                <CommandGroup>
                  {shown.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.id}
                      data-checked={s.id === staffId}
                      onSelect={() => {
                        onChange(s.id);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      {s.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
