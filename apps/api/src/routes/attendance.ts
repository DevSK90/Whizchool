import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { AttendanceDaySummary, AttendanceSheet, AttendanceStatus } from "@whizchool/shared/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth/context";
import { hasFullScope } from "../auth/scope";
import { fromIsoDate, isoDate, isWeekend, lastSchoolDay, schoolToday, toIsoDate } from "../dates";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { enqueue } from "../jobs";
import { settleMessage } from "../jobs/deliver";
import { currentYearId } from "../school";
import { createMessage } from "../services/messages";
import { fullName } from "../students";

type Perm = "attendance.view" | "attendance.create";

/** Full-scope staff see every class; class teachers only their own. */
function canUseClass(auth: AuthContext, classId: string, perm: Perm) {
  return hasFullScope(auth, perm) || auth.session.classIds.includes(classId);
}

async function loadClass(auth: AuthContext, classId: string, perm: Perm) {
  const cls = await prisma.classSection.findUnique({ where: { id: classId }, include: { year: true } });
  if (!cls) throw new ApiError(404, "not_found", "Class not found.");
  if (!canUseClass(auth, cls.id, perm)) throw new ApiError(403, "forbidden", "You can only take attendance for your own class.");
  return cls;
}

/** The class register: active students, alphabetical. */
const roster = (classId: string) =>
  prisma.student.findMany({
    where: { classId, status: "active" },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, guardians: { orderBy: { position: "asc" }, take: 1, select: { guardian: { select: { id: true, phone: true } } } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

const STATUSES = ["present", "absent", "late", "excused"] as const;

/** "Dear parent, Kavindu Perera was marked absent today (25 Oct)…" — kept in plain GSM characters, so one SMS part. */
function absenceText(studentName: string, date: string, school: string) {
  const day = fromIsoDate(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `Dear parent, ${studentName} was marked absent today (${day}). Please contact the class teacher if this is unexpected. - ${school}`;
}

export const attendanceRoutes = [
  defineRoute({
    method: "GET",
    path: "/attendance/summary",
    access: { permission: "attendance.view" },
    summary: "Which classes have marked attendance on a day, with counts",
    query: z.object({ date: isoDate().optional() }),
    handler: async ({ auth, query }): Promise<AttendanceDaySummary> => {
      const date = query.date ?? lastSchoolDay(schoolToday());
      const yearId = await currentYearId();
      const classes = await prisma.classSection.findMany({
        where: { yearId, ...(hasFullScope(auth, "attendance.view") ? {} : { id: { in: auth.session.classIds } }) },
        include: { grade: { select: { number: true } }, classTeacher: { select: { name: true } }, _count: { select: { students: { where: { status: "active" } } } } },
      });
      const days = await prisma.attendanceDay.findMany({
        where: { classId: { in: classes.map((c) => c.id) }, date: fromIsoDate(date) },
        include: { records: { select: { status: true } } },
      });
      const byClass = new Map(days.map((d) => [d.classId, d]));
      return {
        date,
        classes: classes
          .sort((a, b) => a.grade.number - b.grade.number || a.name.localeCompare(b.name))
          .map((c) => {
            const day = byClass.get(c.id);
            const count = (s: AttendanceStatus) => day?.records.filter((r) => r.status === s).length ?? 0;
            return {
              classId: c.id,
              className: c.name,
              ...(c.classTeacher ? { classTeacherName: c.classTeacher.name } : {}),
              marked: !!day,
              absent: count("absent") + count("excused"),
              late: count("late"),
              present: day ? count("present") + count("late") : 0,
              total: c._count.students,
            };
          }),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/attendance",
    access: { permission: "attendance.view" },
    summary: "One class's register for a day (unmarked students default to present)",
    query: z.object({ classId: z.string().max(100), date: isoDate().optional() }),
    handler: async ({ auth, query }): Promise<AttendanceSheet> => {
      const cls = await loadClass(auth, query.classId, "attendance.view");
      const date = query.date ?? lastSchoolDay(schoolToday());
      const [students, day] = await Promise.all([
        roster(cls.id),
        prisma.attendanceDay.findUnique({ where: { classId_date: { classId: cls.id, date: fromIsoDate(date) } }, include: { records: true } }),
      ]);
      const marked = new Map(day?.records.map((r) => [r.studentId, r.status]));
      return {
        classId: cls.id,
        className: cls.name,
        date,
        marked: !!day,
        ...(day ? { markedBy: day.markedBy, markedAt: day.markedAt.toISOString() } : {}),
        records: students.map((s) => ({ studentId: s.id, admissionNo: s.admissionNo, fullName: fullName(s), status: marked.get(s.id) ?? "present" })),
      };
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/attendance",
    access: { permission: "attendance.create" },
    summary: "Save a class's register; parents of students newly absent today get an SMS",
    body: z.object({
      classId: z.string().max(100),
      date: isoDate(),
      records: z.array(z.object({ studentId: z.string().max(100), status: z.enum(STATUSES) })).max(200),
    }),
    handler: async ({ auth, body }) => {
      const cls = await loadClass(auth, body.classId, "attendance.create");
      const today = schoolToday();
      if (body.date > today) throw new ApiError(422, "validation", "Attendance can't be marked for a future date.");
      if (isWeekend(body.date)) throw new ApiError(422, "validation", "Attendance can't be marked on weekends.");
      if (body.date < toIsoDate(cls.year.startDate) || body.date > toIsoDate(cls.year.endDate)) {
        throw new ApiError(422, "validation", `That date is outside the ${cls.year.name} academic year.`);
      }
      const students = await roster(cls.id);
      const onRoll = new Map(students.map((s) => [s.id, s]));
      const sent = new Map(body.records.map((r) => [r.studentId, r.status]));
      if ([...sent.keys()].some((id) => !onRoll.has(id))) throw new ApiError(422, "validation", "A record is for a student who isn't in this class.");
      // Students left out of the request are present.
      const statuses = students.map((s) => ({ studentId: s.id, status: sent.get(s.id) ?? ("present" as const) }));
      const date = fromIsoDate(body.date);
      const relatesTo = `attendance:${cls.id}:${body.date}`;
      const school = await prisma.school.findUniqueOrThrow({ where: { id: "school" }, select: { name: true } });

      const result = await prisma.$transaction(async (tx) => {
        const previous = await tx.attendanceDay.findUnique({ where: { classId_date: { classId: cls.id, date } }, include: { records: true } });
        const day = await tx.attendanceDay.upsert({
          where: { classId_date: { classId: cls.id, date } },
          create: { classId: cls.id, date, markedById: auth.session.id, markedBy: auth.session.name, markedAt: new Date() },
          update: { markedById: auth.session.id, markedBy: auth.session.name, markedAt: new Date() },
        });
        await tx.attendanceRecord.deleteMany({ where: { dayId: day.id } });
        await tx.attendanceRecord.createMany({ data: statuses.map((s) => ({ dayId: day.id, studentId: s.studentId, date, status: s.status })) });

        const absentNow = new Set(statuses.filter((s) => s.status === "absent").map((s) => s.studentId));
        // An absence corrected before its SMS went out: withdraw the SMS.
        const cancelled = await tx.messageDelivery.updateMany({
          where: { status: "queued", studentId: { notIn: [...absentNow] }, message: { relatesTo } },
          data: { status: "cancelled" },
        });
        let smsQueued = 0;
        let messageId: string | null = null;
        // Alerts only for today's register, and only once per student per day.
        if (body.date === today && absentNow.size) {
          const alerted = new Set(
            (await tx.messageDelivery.findMany({ where: { message: { relatesTo }, status: { not: "cancelled" } }, select: { studentId: true } })).map((d) => d.studentId),
          );
          const recipients = [...absentNow]
            .filter((id) => !alerted.has(id))
            .flatMap((id) => {
              const s = onRoll.get(id)!;
              const g = s.guardians[0]?.guardian;
              return g ? [{ to: g.phone, studentId: s.id, guardianId: g.id, body: absenceText(fullName(s), body.date, school.name) }] : [];
            });
          if (recipients.length) {
            const message = await createMessage(tx, {
              channel: "sms",
              kind: "absence_alert",
              audience: { type: "class", ids: [cls.id], label: `Parents of absent students – ${cls.name}` },
              body: absenceText("{student}", body.date, school.name),
              createdById: null,
              createdBy: "System",
              relatesTo,
              recipients,
            });
            smsQueued = recipients.length;
            messageId = message.id;
          }
        }
        await audit(tx, auth, {
          action: previous ? "attendance.update" : "attendance.mark",
          entity: "Attendance",
          entityId: day.id,
          summary: `${previous ? "Updated" : "Marked"} attendance for ${cls.name} on ${body.date}${smsQueued ? ` (${smsQueued} absence SMS)` : ""}${cancelled.count ? ` (${cancelled.count} SMS withdrawn)` : ""}`,
        });
        return { smsQueued, messageId, cancelled: cancelled.count };
      });
      if (result.messageId) await enqueue("messages.deliver", { messageId: result.messageId });
      if (result.cancelled) {
        for (const m of await prisma.message.findMany({ where: { relatesTo }, select: { id: true } })) await settleMessage(m.id);
      }
      const count = (s: AttendanceStatus) => statuses.filter((r) => r.status === s).length;
      return { absent: count("absent"), late: count("late"), excused: count("excused"), total: students.length, smsQueued: result.smsQueued };
    },
  }),
];
