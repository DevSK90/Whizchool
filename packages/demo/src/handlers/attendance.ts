import type { Route } from "../router";
import type { AttendanceDaySummary, AttendanceSheet, AttendanceStatus } from "@whizchool/shared/types";
import {
  audit,
  currentClasses,
  fail,
  fullName,
  hasFullScope,
  isoNow,
  lastSchoolDay,
  requirePerm,
  todayISO,
  type Ctx,
} from "../helpers";
import { nextId } from "../db";
import { classRoster } from "../results";

const STATUSES: AttendanceStatus[] = ["present", "absent", "late", "excused"];

function assertClassAccess(ctx: Ctx, classId: string, perm: "attendance.view" | "attendance.create") {
  const s = requirePerm(ctx, perm);
  if (!ctx.db.classes.get(classId)) fail(404, "not_found", "Class not found.");
  if (!hasFullScope(s, perm, ctx.db) && !s.classIds.includes(classId)) {
    fail(403, "forbidden", "You can only take attendance for your own class.");
  }
}

function resolveDate(ctx: Ctx, date?: string) {
  return date || lastSchoolDay(todayISO(ctx));
}

export const attendanceRoutes: Route[] = [
  {
    method: "GET",
    path: "/attendance/summary",
    handler: (ctx): AttendanceDaySummary => {
      const s = requirePerm(ctx, "attendance.view");
      const db = ctx.db;
      const date = resolveDate(ctx, ctx.query.date);
      const full = hasFullScope(s, "attendance.view", db);
      const classes = currentClasses(db).filter((c) => full || s.classIds.includes(c.id));
      return {
        date,
        classes: classes
          .map((c) => {
            const day = db.attendance.get(`${c.id}|${date}`);
            const total = classRoster(db, c.id).length;
            const ex = Object.values(day?.exceptions ?? {});
            return {
              classId: c.id,
              className: c.name,
              classTeacherName: db.staff.get(c.classTeacherId)?.name,
              marked: !!day,
              absent: ex.filter((x) => x === "absent" || x === "excused").length,
              late: ex.filter((x) => x === "late").length,
              present: day ? total - ex.filter((x) => x === "absent" || x === "excused").length : 0,
              total,
              grade: db.grades.get(c.gradeId)!.number,
            };
          })
          .sort((a, b) => a.grade - b.grade || a.className.localeCompare(b.className))
          .map(({ grade: _grade, ...rest }) => rest),
      };
    },
  },
  {
    method: "GET",
    path: "/attendance",
    handler: (ctx): AttendanceSheet => {
      const { classId } = ctx.query;
      assertClassAccess(ctx, classId, "attendance.view");
      const db = ctx.db;
      const date = resolveDate(ctx, ctx.query.date);
      const day = db.attendance.get(`${classId}|${date}`);
      return {
        classId,
        className: db.classes.get(classId)!.name,
        date,
        marked: !!day,
        markedBy: day?.markedBy,
        markedAt: day?.markedAt,
        records: classRoster(db, classId).map((st) => ({
          studentId: st.id,
          admissionNo: st.admissionNo,
          fullName: fullName(st),
          status: day?.exceptions[st.id] ?? "present",
        })),
      };
    },
  },
  {
    method: "PUT",
    path: "/attendance",
    handler: (ctx) => {
      const { classId, date, records } = ctx.body ?? {};
      assertClassAccess(ctx, classId, "attendance.create");
      const db = ctx.db;
      if (!date || date > todayISO(ctx)) fail(422, "validation", "Attendance can't be marked for a future date.");
      const wd = new Date(`${date}T12:00:00`).getDay();
      if (wd === 0 || wd === 6) fail(422, "validation", "Attendance can't be marked on weekends.");
      const roster = new Set(classRoster(db, classId).map((s) => s.id));
      const exceptions: Record<string, AttendanceStatus> = {};
      for (const r of records as { studentId: string; status: AttendanceStatus }[]) {
        if (!roster.has(r.studentId) || !STATUSES.includes(r.status)) fail(422, "validation", "Invalid attendance record.");
        if (r.status !== "present") exceptions[r.studentId] = r.status;
      }
      const key = `${classId}|${date}`;
      const previous = db.attendance.get(key);
      db.attendance.set(key, { markedBy: ctx.session!.name, markedAt: isoNow(ctx), exceptions });

      // Only alert parents of students who are newly marked absent.
      const newlyAbsent = Object.entries(exceptions).filter(
        ([id, st]) => st === "absent" && previous?.exceptions[id] !== "absent",
      ).length;
      if (newlyAbsent > 0) {
        db.messages.insert({
          id: nextId(db, "msg"), channel: "sms", kind: "absence_alert",
          audience: { type: "class", ids: [classId], label: `Parents of absent students – ${db.classes.get(classId)!.name}` },
          body: `Dear parent, {student} was marked absent today (${date}). Please contact the class teacher if this is unexpected. – ${db.school.name}`,
          recipients: newlyAbsent, delivered: 0, failed: 0, status: "queued", createdAt: isoNow(ctx), createdBy: "System",
        });
      }
      audit(ctx, previous ? "attendance.update" : "attendance.mark", "Attendance", `${previous ? "Updated" : "Marked"} attendance for ${db.classes.get(classId)!.name} on ${date}`);
      const values = Object.values(exceptions);
      return {
        absent: values.filter((v) => v === "absent").length,
        late: values.filter((v) => v === "late").length,
        excused: values.filter((v) => v === "excused").length,
        total: roster.size,
        smsQueued: newlyAbsent,
      };
    },
  },
];
