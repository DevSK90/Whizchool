import type { GradeLevel, StaffDashboard } from "@whizchool/shared/types";
import { hasFullScope } from "../auth/scope";
import { fromIsoDate, lastSchoolDay, schoolToday, toIsoDate } from "../dates";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { currentYearId } from "../school";
import { reportStatuses } from "../services/results";
import { toApplicationListItem } from "./admissions";
import { feeTotals } from "./fees";

const LEVEL_LABEL: Record<GradeLevel, string> = { primary: "Primary (1–5)", junior: "Junior (6–9)", ol: "O/L (10–11)", al: "A/L (12–13)" };
const TREND_DAYS = 15;

const percent = (present: number, total: number) => (total ? Math.round((present / total) * 1000) / 10 : 0);

export const dashboardRoutes = [
  defineRoute({
    method: "GET",
    path: "/dashboard",
    access: { permission: "dashboard.view" },
    summary: "The staff home page: head counts, attendance, admissions, fees and report cards waiting, as far as the caller's permissions reach",
    handler: async ({ auth }): Promise<StaffDashboard> => {
      const can = (key: Parameters<typeof hasFullScope>[1]) => auth.session.permissions.includes(key);
      const today = schoolToday();
      const schoolDay = lastSchoolDay(today);
      const yearId = await currentYearId();
      const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: yearId }, select: { startDate: true } });
      const canAdmissions = can("admissions.view");
      const canReports = can("reportCards.view");

      const [classes, students, newStudents, staffCount, grades, trendRows, pendingApplications, recent, fees, exam] = await Promise.all([
        prisma.classSection.findMany({ where: { yearId }, select: { id: true, name: true, grade: { select: { number: true } } } }),
        prisma.student.groupBy({ by: ["gradeId"], where: { status: "active" }, _count: { _all: true } }),
        prisma.student.count({ where: { status: "active", joinedDate: { gte: year.startDate } } }),
        prisma.staff.count({ where: { status: "active" } }),
        prisma.grade.findMany({ select: { id: true, level: true } }),
        // School-wide attendance on the last few days registers were marked: each register's counts, then each day's.
        prisma.$queryRaw<{ date: Date; present: number; total: number; classes: number }[]>`
          WITH "days" AS (
            SELECT DISTINCT d."date" FROM "AttendanceDay" d JOIN "Class" c ON c."id" = d."classId"
            WHERE c."yearId" = ${yearId} AND d."date" <= ${fromIsoDate(today)} ORDER BY d."date" DESC LIMIT ${TREND_DAYS}
          ), "registers" AS (
            SELECT d."date", count(*) FILTER (WHERE r."status" IN ('present', 'late')) AS "present", count(*) AS "total"
            FROM "AttendanceDay" d JOIN "Class" c ON c."id" = d."classId" JOIN "AttendanceRecord" r ON r."dayId" = d."id"
            WHERE c."yearId" = ${yearId} AND d."date" IN (SELECT "date" FROM "days")
            GROUP BY d."id", d."date"
          )
          SELECT "date", sum("present")::int AS "present", sum("total")::int AS "total", count(*)::int AS "classes"
          FROM "registers" GROUP BY "date" ORDER BY "date"`,
        canAdmissions ? prisma.application.count({ where: { stage: { in: ["new", "interview"] } } }) : 0,
        canAdmissions ? prisma.application.findMany({ orderBy: { submittedAt: "desc" }, take: 5, include: { applyingGrade: { select: { name: true } } } }) : [],
        can("fees.view") ? feeTotals(today) : undefined,
        canReports
          ? prisma.exam.findFirst({ where: { yearId, status: { not: "scheduled" } }, orderBy: [{ term: { number: "desc" } }, { startDate: "desc" }], select: { id: true, name: true } })
          : null,
      ]);

      // Report cards still to be released for the current term test, for the classes the caller looks after.
      let pendingReportCards: StaffDashboard["pendingReportCards"] = [];
      if (exam) {
        const mine = hasFullScope(auth, "reportCards.view") ? classes : classes.filter((c) => auth.session.classIds.includes(c.id));
        const statuses = await reportStatuses(prisma, exam.id, mine.map((c) => c.id));
        pendingReportCards = mine
          .sort((a, b) => a.grade.number - b.grade.number || a.name.localeCompare(b.name))
          .map((c) => ({ examId: exam.id, examName: exam.name, classId: c.id, className: c.name, status: statuses.get(c.id)!.status }))
          .filter((r) => r.status !== "released");
      }

      const levelOf = new Map(grades.map((g) => [g.id, g.level]));
      const todayRow = trendRows.find((r) => toIsoDate(r.date) === schoolDay);
      return {
        activeStudents: students.reduce((s, g) => s + g._count._all, 0),
        newStudentsThisYear: newStudents,
        staffCount,
        attendanceToday: { rate: todayRow ? percent(todayRow.present, todayRow.total) : 0, marked: todayRow?.classes ?? 0, totalClasses: classes.length },
        pendingApplications,
        fees: fees ? { collectedThisMonth: fees.collectedThisMonth, outstanding: fees.outstanding } : { collectedThisMonth: 0, outstanding: 0 },
        attendanceTrend: trendRows.map((r) => ({ date: toIsoDate(r.date), rate: percent(r.present, r.total) })),
        feesMonthly: fees?.monthly ?? [],
        pendingReportCards,
        recentApplications: recent.map(toApplicationListItem),
        enrollmentByLevel: (["primary", "junior", "ol", "al"] as GradeLevel[]).map((level) => ({
          level,
          label: LEVEL_LABEL[level],
          count: students.filter((g) => levelOf.get(g.gradeId) === level).reduce((s, g) => s + g._count._all, 0),
        })),
      };
    },
  }),
];
