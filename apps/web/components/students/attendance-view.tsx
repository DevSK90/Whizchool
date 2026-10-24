"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useStudentAttendance } from "@/lib/api/hooks";
import { formatDate } from "@/lib/format";

export function StudentAttendanceView({ studentId }: { studentId: string }) {
  const t = useTranslations("students.attendance");
  const { data, error, refetch, isPending } = useStudentAttendance(studentId);
  if (isPending) return <Skeleton className="h-72 rounded-xl" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const tiles = [
    { label: t("rate"), value: `${data.rate.toFixed(1)}%` },
    { label: t("present"), value: data.present },
    { label: t("absent"), value: data.absent },
    { label: t("late"), value: data.late },
  ];
  const notable = data.days.filter((d) => d.status !== "present");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{x.label}</p>
            <p className="mt-1 text-xl font-semibold tabular">{x.value}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("recent")}</CardTitle>
          <CardDescription>{t("termNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Compact strip of the last 30 school days, then a list of non-present days */}
          <div className="mb-4 flex flex-wrap gap-1" aria-hidden>
            {data.days.slice(0, 30).reverse().map((d) => (
              <span
                key={d.date}
                title={`${formatDate(d.date)}`}
                className={
                  d.status === "present"
                    ? "size-4 rounded-sm bg-success/70"
                    : d.status === "late"
                      ? "size-4 rounded-sm bg-warning"
                      : d.status === "excused"
                        ? "size-4 rounded-sm bg-muted-foreground/40"
                        : "size-4 rounded-sm bg-destructive"
                }
              />
            ))}
          </div>
          <ul className="divide-y">
            {notable.slice(0, 12).map((d) => (
              <li key={d.date} className="flex items-center justify-between py-2 text-sm">
                <span>{formatDate(d.date)}</span>
                <StatusBadge kind="attendance" status={d.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
