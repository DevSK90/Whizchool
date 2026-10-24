import type { Route } from "../router";
import type { GradeLevel, PortalChild, StaffDashboard } from "../../types";
import {
  canSeeStudent,
  className,
  currentClasses,
  fail,
  fileRef,
  fullName,
  hasFullScope,
  lastSchoolDay,
  requireAuth,
  requirePerm,
  studentBalance,
  todayISO,
} from "../helpers";
import { classRoster, reportStatus } from "../results";
import { feesSummary } from "./fees";
import { studentAttendance, studentResults } from "./students";

const LEVEL_LABEL: Record<GradeLevel, string> = { primary: "Primary (1–5)", junior: "Junior (6–9)", ol: "O/L (10–11)", al: "A/L (12–13)" };

export const dashboardRoutes: Route[] = [
  {
    method: "GET",
    path: "/dashboard",
    handler: (ctx): StaffDashboard => {
      const s = requirePerm(ctx, "dashboard.view");
      const db = ctx.db;
      const today = todayISO(ctx);
      const schoolDay = lastSchoolDay(today);
      const classes = currentClasses(db);
      const active = db.students.rows.filter((x) => x.status === "active");

      // attendance rate per school day for the last 15 marked days
      const byDay = new Map<string, { present: number; total: number }>();
      for (const [key, day] of db.attendance) {
        const [classId, date] = key.split("|");
        if (date > today) continue;
        const total = classRoster(db, classId).length;
        const away = Object.values(day.exceptions).filter((x) => x === "absent" || x === "excused").length;
        const agg = byDay.get(date) ?? { present: 0, total: 0 };
        agg.present += total - away;
        agg.total += total;
        byDay.set(date, agg);
      }
      const trend = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-15)
        .map(([date, v]) => ({ date, rate: Math.round((v.present / v.total) * 1000) / 10 }));
      const todayAgg = byDay.get(schoolDay);
      const markedToday = classes.filter((c) => db.attendance.has(`${c.id}|${schoolDay}`)).length;

      const fees = s.permissions.includes("fees.view") ? feesSummary(db, today) : undefined;
      const currentExam = [...db.exams.rows].filter((e) => e.yearId === db.school.currentYearId && e.status !== "scheduled").pop();
      const canReports = s.permissions.includes("reportCards.view");
      const fullReports = hasFullScope(s, "reportCards.view", db);
      const pendingReportCards =
        currentExam && canReports
          ? classes
              .filter((c) => fullReports || s.classIds.includes(c.id))
              .map((c) => ({ examId: currentExam.id, examName: currentExam.name, classId: c.id, className: c.name, status: reportStatus(db, currentExam.id, c.id) }))
              .filter((r) => r.status !== "released")
          : [];
      const canAdmissions = s.permissions.includes("admissions.view");

      return {
        activeStudents: active.length,
        newStudentsThisYear: active.filter((x) => x.joinedDate >= db.years.get(db.school.currentYearId)!.startDate).length,
        staffCount: db.staff.rows.filter((x) => x.status === "active").length,
        attendanceToday: {
          rate: todayAgg ? Math.round((todayAgg.present / todayAgg.total) * 1000) / 10 : 0,
          marked: markedToday,
          totalClasses: classes.length,
        },
        pendingApplications: canAdmissions ? db.applications.rows.filter((a) => a.stage === "new" || a.stage === "interview").length : 0,
        fees: fees ? { collectedThisMonth: fees.collectedThisMonth, outstanding: fees.outstanding } : { collectedThisMonth: 0, outstanding: 0 },
        attendanceTrend: trend,
        feesMonthly: fees ? fees.monthly : [],
        pendingReportCards,
        recentApplications: canAdmissions
          ? [...db.applications.rows]
              .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
              .slice(0, 5)
              .map((a) => ({
                id: a.id, refNo: a.refNo, studentName: `${a.student.firstName} ${a.student.lastName}`, gradeName: db.grades.get(a.applyingGradeId)!.name,
                guardianName: a.guardian.name, guardianPhone: a.guardian.phone, stage: a.stage, submittedAt: a.submittedAt, interviewAt: a.interviewAt,
              }))
          : [],
        enrollmentByLevel: (["primary", "junior", "ol", "al"] as GradeLevel[]).map((level) => ({
          level,
          label: LEVEL_LABEL[level],
          count: active.filter((x) => db.grades.get(x.gradeId)!.level === level).length,
        })),
      };
    },
  },
  {
    method: "GET",
    path: "/portal/children",
    handler: (ctx): PortalChild[] => {
      const s = requireAuth(ctx);
      if (s.kind !== "parent") fail(403, "forbidden", "Parent portal only.");
      const db = ctx.db;
      const today = todayISO(ctx);
      return s.studentIds
        .filter((id) => canSeeStudent(ctx, id))
        .map((id) => {
          const st = db.students.get(id)!;
          const results = studentResults(db, id, true).exams.filter((e) => e.released && e.average !== undefined);
          const latest = results[results.length - 1];
          return {
            id,
            fullName: fullName(st),
            photoUrl: fileRef(db, st.photoFileId)?.url,
            admissionNo: st.admissionNo,
            className: className(db, st.classId),
            attendanceRate: studentAttendance(db, id, today).rate,
            latestAverage: latest?.average,
            latestExamName: latest?.exam.name,
            latestRank: latest?.rank,
            classSize: latest?.classSize,
            balance: studentBalance(db, id),
            overdue: db.invoices.rows.filter((i) => i.studentId === id && i.balance > 0 && i.status !== "void" && i.dueDate < today).reduce((a, i) => a + i.balance, 0),
          };
        });
    },
  },
];
