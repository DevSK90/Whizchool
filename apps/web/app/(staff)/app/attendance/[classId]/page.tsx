"use client";

import { use, useMemo } from "react";
import { useTranslations } from "next-intl";
import { CheckCheck, Info } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { useApiMutation, useAttendanceSheet } from "@/lib/api/hooks";
import type { AttendanceStatus } from "@whizchool/shared/types";
import { useCan, useSession } from "@/lib/auth";
import { formatDate, formatDateTime, toISODate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/hooks/use-url-state";
import { useResettableState } from "@/hooks/use-resettable-state";
import { DatePicker } from "@/components/shared/date-picker";

const STATUSES: AttendanceStatus[] = ["present", "absent", "late", "excused"];
const ACTIVE: Record<AttendanceStatus, string> = {
  present: "data-[state=on]:bg-success data-[state=on]:text-success-foreground",
  absent: "data-[state=on]:bg-destructive data-[state=on]:text-white",
  late: "data-[state=on]:bg-warning data-[state=on]:text-warning-foreground",
  excused: "data-[state=on]:bg-muted-foreground data-[state=on]:text-background",
};

export default function AttendanceSheetPage({ params }: PageProps<"/app/attendance/[classId]">) {
  const { classId } = use(params);
  const t = useTranslations("academics.attendance.sheet");
  const ts = useTranslations("status.attendance");
  const tc = useTranslations("common");
  const can = useCan();
  const user = useSession();
  const url = useUrlState<"date">();
  const date = url.get("date") || undefined;
  const { data, error, refetch, isPending } = useAttendanceSheet(classId, date);
  const [statuses, setStatuses] = useResettableState(data, (d) =>
    Object.fromEntries((d?.records ?? []).map((r) => [r.studentId, r.status])) as Record<string, AttendanceStatus>,
  );

  const editable = can("attendance.create") && (user?.roles.some((r) => r.scope === "all") || user?.classIds.includes(classId));
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0 };
    Object.values(statuses).forEach((s) => c[s]++);
    return c;
  }, [statuses]);
  const dirty = !!data && data.records.some((r) => statuses[r.studentId] !== r.status);

  const save = useApiMutation(
    () => api.put<{ smsQueued: number }>("/attendance", { classId, date: data!.date, records: Object.entries(statuses).map(([studentId, status]) => ({ studentId, status })) }),
    {
      invalidate: [["attendance"], ["dashboard"], ["messages"]],
      success: (r) => `${t("saved")} ${t("smsQueued", { count: r.smsQueued })}`,
    },
  );

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const day = new Date(`${data.date}T12:00:00`).getDay();
  const weekend = day === 0 || day === 6;

  return (
    <>
      <PageHeader
        back={{ href: `/app/attendance?date=${data.date}`, label: t("back") }}
        title={t("title", { className: data.className })}
        description={formatDate(data.date)}
        actions={
          <div title={dirty ? tc("unsaved") : undefined}>
            <DatePicker
              className="w-52"
              value={data.date}
              max={toISODate(new Date())}
              disabled={dirty}
              align="end"
              onChange={(v) => url.set({ date: v })}
            />
          </div>
        }
      />

      {weekend ? (
        <Alert className="mb-4">
          <Info />
          <AlertDescription>{t("weekend")}</AlertDescription>
        </Alert>
      ) : !editable ? (
        <Alert className="mb-4">
          <Info />
          <AlertDescription>{t("readOnly")}</AlertDescription>
        </Alert>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">
          {data.marked && data.markedBy && data.markedAt ? t("markedBy", { name: data.markedBy, time: formatDateTime(data.markedAt) }) : t("notYet")}
        </p>
      )}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-sm tabular">{t("counts", counts)}</p>
          {editable && !weekend && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatuses(Object.fromEntries(data.records.map((r) => [r.studentId, "present" as const])));
                toast.message(t("allPresent"));
              }}
            >
              <CheckCheck /> {t("allPresent")}
            </Button>
          )}
        </div>
        <CardContent className="p-0">
          <ul className="divide-y">
            {data.records.map((r, i) => (
              <li key={r.studentId} className={cn("flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between", statuses[r.studentId] === "absent" && "bg-destructive/5")}>
                <div className="flex items-center gap-3">
                  <span className="w-6 text-right text-xs text-muted-foreground tabular">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{r.fullName}</p>
                    <p className="text-xs text-muted-foreground tabular">{r.admissionNo}</p>
                  </div>
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={statuses[r.studentId]}
                  disabled={!editable || weekend}
                  onValueChange={(v) => v && setStatuses((s) => ({ ...s, [r.studentId]: v as AttendanceStatus }))}
                  aria-label={r.fullName}
                  className="self-start sm:self-auto"
                >
                  {STATUSES.map((s) => (
                    <ToggleGroupItem key={s} value={s} className={cn("px-2.5 text-xs", ACTIVE[s])}>
                      {ts(s)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {editable && !weekend && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {dirty && <span className="text-sm text-muted-foreground">{t("counts", counts)}</span>}
          <Button size="lg" onClick={() => save.mutate(undefined)} disabled={save.isPending || (!dirty && data.marked)}>
            {save.isPending && <Spinner />}
            {data.marked ? t("update") : t("save")}
          </Button>
        </div>
      )}
    </>
  );
}

