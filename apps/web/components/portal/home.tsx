"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  Pin,
  UserRound,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatTime } from "@whizchool/shared/timetable";
import type { AttendanceStatus, Exam, Notice, PortalChild, Term } from "@whizchool/shared/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchoolClock } from "@/components/timetable/timetable-board";
import { useStudentTimetable } from "@/lib/api/hooks";
import { formatDate, formatMoney, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A report card counts as new for this many days after it's released. */
const NEW_REPORT_DAYS = 14;
/** Fees due within this many days are flagged. */
const DUE_SOON_DAYS = 7;

const shortDate = (iso: string) => format(parseISO(iso), "d MMM");
const firstName = (fullName: string) => fullName.split(" ")[0];

// ---------- needs attention ----------

type Tone = "danger" | "warning" | "info";
interface AttentionItem {
  key: string;
  tone: Tone;
  icon: LucideIcon;
  text: string;
  action: string;
  href: string;
}

const TONE: Record<Tone, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground dark:text-warning",
  info: "bg-primary/10 text-primary",
};

export function NeedsAttention({ items: children, today, schoolDay }: { items: PortalChild[]; today: string; schoolDay: boolean }) {
  const t = useTranslations("portal.home.attention");
  const items: AttentionItem[] = [];
  for (const c of children) {
    const name = firstName(c.fullName);
    const base = `/portal/children/${c.id}`;
    if (c.overdue > 0)
      items.push({ key: `${c.id}-overdue`, tone: "danger", icon: Wallet, text: t("overdue", { name, amount: formatMoney(c.overdue) }), action: t("pay"), href: `${base}?tab=fees` });
    else if (c.nextDue && differenceInCalendarDays(parseISO(c.nextDue.dueDate), parseISO(today)) <= DUE_SOON_DAYS)
      items.push({
        key: `${c.id}-due`,
        tone: "warning",
        icon: Wallet,
        text: t("dueSoon", { name, amount: formatMoney(c.nextDue.amount), date: shortDate(c.nextDue.dueDate) }),
        action: t("pay"),
        href: `${base}?tab=fees`,
      });
    if (schoolDay && (c.todayAttendance === "absent" || c.todayAttendance === "late"))
      items.push({
        key: `${c.id}-attendance`,
        tone: c.todayAttendance === "absent" ? "danger" : "warning",
        icon: c.todayAttendance === "absent" ? UserX : Clock,
        text: t(c.todayAttendance, { name }),
        action: t("attendance"),
        href: `${base}?tab=attendance`,
      });
    if (c.latestExamId && c.latestReleasedAt && differenceInCalendarDays(parseISO(today), parseISO(c.latestReleasedAt)) <= NEW_REPORT_DAYS)
      items.push({
        key: `${c.id}-report`,
        tone: "info",
        icon: FileText,
        text: t("report", { name, exam: c.latestExamName ?? "" }),
        action: t("viewReport"),
        href: `${base}/report/${c.latestExamId}`,
      });
  }

  if (!items.length)
    return (
      <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        {t("allClear")}
      </p>
    );
  return (
    <section aria-labelledby="attention-title" className="rounded-xl border bg-card">
      <h2 id="attention-title" className="border-b px-4 py-3 text-sm font-semibold">
        {t("title")} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular">{items.length}</span>
      </h2>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", TONE[item.tone])}>
              <item.icon className="size-4" aria-hidden />
            </span>
            <p className="min-w-0 flex-1 text-sm font-medium">{item.text}</p>
            <Button size="sm" variant={item.tone === "danger" ? "default" : "outline"} asChild>
              <Link href={item.href}>
                {item.action} <ArrowRight />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- a child ----------

const TODAY_STYLE: Record<AttendanceStatus, string> = {
  present: "bg-success/10 text-success",
  late: "bg-warning/15 text-warning-foreground dark:text-warning",
  excused: "bg-muted text-muted-foreground",
  absent: "bg-destructive/10 text-destructive",
};

export function ChildCard({ child: c, today, schoolDay }: { child: PortalChild; today: string; schoolDay: boolean }) {
  const t = useTranslations("portal.home.child");
  const base = `/portal/children/${c.id}`;
  const todayBadge = (className: string) =>
    schoolDay && (
      <span
        className={cn(
          "inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
          c.todayAttendance ? TODAY_STYLE[c.todayAttendance] : "bg-muted text-muted-foreground",
          className,
        )}
      >
        {t(`today.${c.todayAttendance ?? "notTaken"}`)}
      </span>
    );
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-12 shrink-0">
            {c.photoUrl && <AvatarImage src={c.photoUrl} alt="" className="object-cover" />}
            <AvatarFallback className="bg-primary/10 font-medium text-primary">{initials(c.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="truncate text-lg">{c.fullName}</CardTitle>
            <CardDescription className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span>
                {c.className} · {t("admissionNo", { no: c.admissionNo })}
              </span>
              {c.classTeacherName && (
                <span className="flex gap-1">
                  <UserRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{t("classTeacher", { name: c.classTeacherName })}</span>
                </span>
              )}
            </CardDescription>
            {/* On phones the badge sits under the name, so the name keeps the width. */}
            {todayBadge("mt-1.5 sm:hidden")}
          </div>
        </div>
        {todayBadge("hidden shrink-0 sm:inline-flex")}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat icon={CalendarCheck} label={t("attendance")} href={`${base}?tab=attendance`}>
            <p className="text-2xl font-semibold tabular">{c.attendanceRate.toFixed(0)}%</p>
            <Progress value={c.attendanceRate} className="mt-2 h-1.5" aria-label={t("attendance")} />
            <p className="mt-2 text-xs text-muted-foreground">{t("absentDays", { count: c.absentDays })}</p>
          </Stat>
          <Stat icon={GraduationCap} label={t("latest")} href={c.latestExamId ? `${base}/report/${c.latestExamId}` : `${base}?tab=results`}>
            {c.latestAverage !== undefined ? (
              <>
                <p className="text-2xl font-semibold tabular">
                  {c.latestAverage.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">{t("average")}</span>
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{c.latestExamName}</p>
                {c.latestRank && c.classSize && <p className="text-xs font-medium">{t("rank", { rank: c.latestRank, size: c.classSize })}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noResults")}</p>
            )}
          </Stat>
          <Stat icon={Wallet} label={t("fees")} href={`${base}?tab=fees`}>
            {c.balance > 0 ? (
              <>
                <p className="text-2xl font-semibold tabular">{formatMoney(c.balance)}</p>
                {c.overdue > 0 && <p className="mt-1 text-xs font-medium text-destructive">{t("overdue", { amount: formatMoney(c.overdue) })}</p>}
                {c.nextDue && <p className="mt-1 text-xs text-muted-foreground">{t("nextDue", { amount: formatMoney(c.nextDue.amount), date: shortDate(c.nextDue.dueDate) })}</p>}
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-lg font-semibold text-success">
                <CheckCircle2 className="size-5" aria-hidden /> {t("allPaid")}
              </p>
            )}
          </Stat>
        </div>

        <TodayClasses studentId={c.id} today={today} href={`${base}?tab=timetable`} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="sm:flex-1" asChild>
            <Link href={base}>
              {t("view")} <ChevronRight />
            </Link>
          </Button>
          {c.balance > 0 && (
            <Button className="sm:flex-1" asChild>
              <Link href={`${base}?tab=fees`}>
                <Wallet /> {t("pay")}
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, href, children }: { icon: LucideIcon; label: string; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group rounded-xl border bg-muted/30 p-4 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
        <ChevronRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </p>
      {children}
    </Link>
  );
}

/**
 * The school day's lessons from the published timetable, with the current one picked out. Once today's
 * lessons are over, and at weekends, it shows the next school day's instead.
 */
function TodayClasses({ studentId, today, href }: { studentId: string; today: string; href: string }) {
  const t = useTranslations("portal.home.child");
  const clock = useSchoolClock();
  const { data, isPending } = useStudentTimetable(studentId);
  if (isPending || !clock) return <Skeleton className="h-16 w-full" />;
  // Nothing published yet: the timetable tab says so.
  if (!data?.blocks.length) return null;
  const lessonsOn = (day: number) => data.blocks.filter((b) => b.day === day && b.kind !== "interval").sort((a, b) => a.start - b.start);
  const weekday = parseISO(today).getDay();
  const todayLeft = weekday >= 1 && weekday <= 5 && lessonsOn(weekday).some((b) => clock.minutes < b.end);
  // Days ahead to the school day shown: today, or the next weekday.
  const ahead = todayLeft ? 0 : weekday === 5 ? 3 : weekday === 6 ? 2 : 1;
  const lessons = lessonsOn(todayLeft ? weekday : ((weekday + ahead - 1) % 7) + 1);
  const minutes = todayLeft ? clock.minutes : -1;
  const current = lessons.find((b) => minutes >= b.start && minutes < b.end);
  const next = lessons.find((b) => b.start >= minutes);
  const title = ahead === 0 ? t("todayClasses") : ahead === 1 ? t("tomorrowClasses") : t("dayClasses", { day: format(addDays(parseISO(today), ahead), "EEEE") });
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CalendarClock className="size-3.5" aria-hidden /> {title}
        </h3>
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
          {t("timetable")}
        </Link>
      </div>
      {lessons.length ? (
        <ol className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
          {lessons.map((b) => {
            const done = minutes >= b.end;
            const now = b === current;
            return (
              <li
                key={b.id}
                className={cn(
                  "min-w-28 shrink-0 rounded-lg border px-3 py-2",
                  now && "border-primary bg-primary/10 ring-1 ring-primary",
                  done && "opacity-55",
                )}
                aria-current={now ? "time" : undefined}
              >
                <p className="text-[11px] text-muted-foreground tabular">
                  {formatTime(b.start)}
                  {now && <span className="ml-1.5 font-semibold text-primary">{t("now")}</span>}
                  {todayLeft && !now && b === next && !current && <span className="ml-1.5 font-semibold text-primary">{t("next")}</span>}
                </p>
                <p className="truncate text-sm font-medium">{b.subjectName ?? b.label}</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">{t("noClassesToday")}</p>
      )}
    </section>
  );
}

// ---------- coming up ----------

export function ComingUp({ terms, exams, kids, today }: { terms: Term[]; exams: Exam[]; kids: PortalChild[]; today: string }) {
  const t = useTranslations("portal.home.comingUp");
  const days = (iso: string) => differenceInCalendarDays(parseISO(iso), parseISO(today));
  const term = terms.find((x) => x.startDate <= today && today <= x.endDate);
  const nextTerm = [...terms].sort((a, b) => a.startDate.localeCompare(b.startDate)).find((x) => x.startDate > today);
  const released = new Set(kids.map((c) => c.latestExamId));
  const rows: { key: string; icon: LucideIcon; title: string; detail?: string; progress?: number }[] = [];

  if (term) {
    const length = differenceInCalendarDays(parseISO(term.endDate), parseISO(term.startDate)) || 1;
    rows.push({
      key: "term",
      icon: CalendarCheck,
      title: t("term", { term: term.name, date: shortDate(term.endDate) }),
      detail: t("termDays", { count: days(term.endDate) }),
      progress: Math.round((days(term.startDate) * -100) / length),
    });
  } else if (nextTerm) {
    rows.push({ key: "term", icon: CalendarCheck, title: t("reopens", { term: nextTerm.name, date: formatDate(nextTerm.startDate) }), detail: t("inDays", { count: days(nextTerm.startDate) }) });
  }
  const sorted = [...exams].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const e of sorted) {
    if (e.startDate <= today && today <= e.endDate) rows.push({ key: e.id, icon: GraduationCap, title: t("examNow", { exam: e.name }), detail: t("until", { date: shortDate(e.endDate) }) });
    else if (e.endDate < today && e.status !== "released" && !released.has(e.id)) rows.push({ key: e.id, icon: FileText, title: t("preparing", { exam: e.name }) });
  }
  const upcoming = sorted.find((e) => e.startDate > today);
  if (upcoming) rows.push({ key: upcoming.id, icon: GraduationCap, title: t("examSoon", { exam: upcoming.name, date: shortDate(upcoming.startDate) }), detail: t("inDays", { count: days(upcoming.startDate) }) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <ul className="space-y-4">
            {rows.map((r) => (
              <li key={r.key} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <r.icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  {r.detail && <p className="text-xs text-muted-foreground">{r.detail}</p>}
                  {r.progress !== undefined && <Progress value={Math.min(100, Math.max(0, r.progress))} className="mt-2 h-1.5" aria-label={r.title} />}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("nothing")}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- notices ----------

export function LatestNotices({ notices }: { notices: Notice[] | undefined }) {
  const t = useTranslations("portal.home");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("notices")}</CardTitle>
        <CardAction className="self-center">
          <Link href="/portal/notices" className="text-sm font-medium text-primary hover:underline">
            {t("allNotices")}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {notices === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : notices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noNotices")}</p>
        ) : (
          <ul className="-mx-2 space-y-1">
            {notices.slice(0, 3).map((n) => (
              <li key={n.id}>
                <Link href={`/portal/notices#notice-${n.id}`} className="block rounded-lg px-2 py-2.5 hover:bg-muted/60">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {n.pinned && <Pin className="size-3.5 shrink-0 text-primary" aria-label={t("pinned")} />}
                    <span className="truncate">{n.title}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.publishedAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
