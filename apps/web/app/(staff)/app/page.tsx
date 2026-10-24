"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarCheck, CheckCircle2, ClipboardList, GraduationCap, UserPlus, Wallet, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CollectionBarChart, RateTrendChart } from "@/components/charts/charts";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAttendanceSummary, useDashboard, useExamProgress, useExams, useSchool } from "@/lib/api/hooks";
import { useCan, useSession } from "@/lib/auth";
import { formatDate, formatMoney, formatNumber, formatPeriod } from "@/lib/format";

function greetingKey(d: Date) {
  const h = d.getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const user = useSession()!;
  const can = useCan();
  const { data: school } = useSchool();
  const { data, error, refetch, isPending } = useDashboard();
  const isTeacher = user.classIds.length > 0 || user.classSubjectIds.length > 0;

  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const firstName = user.name.replace(/^(Mr|Mrs|Ms|Dr)\.\s*/, "").split(" ")[0];
  const month = formatPeriod(new Date().toISOString().slice(0, 7));
  const attendanceDate = data.attendanceTrend.at(-1)?.date;

  return (
    <>
      <PageHeader title={t(`greeting.${greetingKey(new Date())}`, { name: firstName })} description={t("subtitle", { school: school?.name ?? "" })} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("stats.students")}
          value={formatNumber(data.activeStudents)}
          hint={t("stats.studentsHint", { count: data.newStudentsThisYear })}
          icon={GraduationCap}
          href={can("students.view") ? "/app/students" : undefined}
        />
        <StatCard
          label={t("stats.attendance")}
          value={`${data.attendanceToday.rate.toFixed(1)}%`}
          hint={t("stats.attendanceHint", {
            marked: data.attendanceToday.marked,
            total: data.attendanceToday.totalClasses,
            date: attendanceDate ? formatDate(attendanceDate) : "",
          })}
          icon={CalendarCheck}
          href={can("attendance.view") ? "/app/attendance" : undefined}
        />
        {can("fees.view") ? (
          <>
            <StatCard label={t("stats.collected")} value={formatMoney(data.fees.collectedThisMonth)} hint={t("stats.collectedHint", { month })} icon={Wallet} href="/app/fees" />
            <StatCard label={t("stats.outstanding")} value={formatMoney(data.fees.outstanding)} hint={t("stats.outstandingHint")} icon={AlertCircle} href="/app/fees/defaulters" />
          </>
        ) : (
          can("admissions.view") && (
            <StatCard label={t("stats.applications")} value={data.pendingApplications} hint={t("stats.applicationsHint")} icon={UserPlus} href="/app/admissions" />
          )
        )}
      </div>

      {isTeacher && <TeacherTasks />}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {can("fees.view") && data.feesMonthly.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("fees.title")}</CardTitle>
              <CardDescription>{t("fees.description")}</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/app/fees">{t("fees.view")}</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <CollectionBarChart data={data.feesMonthly} label={t("fees.title")} />
            </CardContent>
          </Card>
        )}
        <Card className={can("fees.view") ? "" : "lg:col-span-2"}>
          <CardHeader>
            <CardTitle>{t("attendanceTrend.title")}</CardTitle>
            <CardDescription>{t("attendanceTrend.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <RateTrendChart data={data.attendanceTrend} label={t("attendanceTrend.title")} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("enrollment.title")}</CardTitle>
            <CardDescription>{t("enrollment.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.enrollmentByLevel.map((l) => (
              <div key={l.level} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>{l.label}</span>
                  <span className="font-medium tabular">{l.count}</span>
                </div>
                <Progress value={(l.count / Math.max(1, data.activeStudents)) * 100} aria-label={l.label} />
              </div>
            ))}
          </CardContent>
        </Card>

        {can("reportCards.view") && (
          <Card className={can("admissions.view") ? "" : "lg:col-span-2"}>
            <CardHeader>
              <CardTitle>{t("reports.title")}</CardTitle>
              {data.pendingReportCards[0] && <CardDescription>{t("reports.description", { exam: data.pendingReportCards[0].examName })}</CardDescription>}
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/app/report-cards">{tn("reportCards")}</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.pendingReportCards.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-success" /> {t("reports.empty")}
                </p>
              ) : (
                <ul className="max-h-72 divide-y overflow-y-auto">
                  {data.pendingReportCards.slice(0, 30).map((r) => (
                    <li key={r.classId} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/app/report-cards/${r.examId}/class/${r.classId}`} className="font-medium hover:underline">
                        {r.className}
                      </Link>
                      <StatusBadge kind="reportCard" status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {can("admissions.view") && (
          <Card>
            <CardHeader>
              <CardTitle>{t("applications.title")}</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/app/admissions">{tn("admissions")}</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.recentApplications.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("applications.empty")}</p>
              ) : (
                <ul className="divide-y">
                  {data.recentApplications.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/app/admissions/${a.id}`} className="min-w-0">
                        <p className="truncate text-sm font-medium hover:underline">{a.studentName}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.gradeName} · {formatDate(a.submittedAt)}
                        </p>
                      </Link>
                      <StatusBadge kind="application" status={a.stage} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function TeacherTasks() {
  const t = useTranslations("dashboard.tasks");
  const user = useSession()!;
  const can = useCan();
  const format = useFormatter();
  const attendance = useAttendanceSummary();
  const exams = useExams();
  const openExam = exams.data?.find((e) => e.status === "marks_entry");
  const progress = useExamProgress(can("marks.create") && openExam ? openExam.id : "");
  const myClasses = attendance.data?.classes.filter((c) => user.classIds.includes(c.classId)) ?? [];
  const pendingSheets = progress.data?.sheets.filter((s) => !s.submitted) ?? [];

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        {openExam && <CardDescription>{openExam.name}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {myClasses.map((c) => (
            <li key={c.classId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                {c.marked ? <CheckCircle2 className="size-4 text-success" /> : <CalendarCheck className="size-4 text-warning" />}
                {c.marked ? t("attendanceDone", { className: c.className }) : t("attendanceTodo", { className: c.className })}
              </span>
              {!c.marked && (
                <Button size="sm" asChild>
                  <Link href={`/app/attendance/${c.classId}`}>{t("markNow")}</Link>
                </Button>
              )}
            </li>
          ))}
          {pendingSheets.map((s) => (
            <li key={`${s.classId}-${s.subjectId}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <ClipboardList className="size-4 text-warning" />
                {t("marksTodo", { subject: s.subjectName, className: s.className, entered: format.number(s.entered), total: s.total })}
              </span>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/app/exams/${progress.data!.exam.id}/marks?classId=${s.classId}&subjectId=${s.subjectId}`}>{t("enterMarks")}</Link>
              </Button>
            </li>
          ))}
          {progress.data && pendingSheets.length === 0 && user.classSubjectIds.length > 0 && (
            <li className="flex items-center gap-2 py-2.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" /> {t("marksDone")}
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
