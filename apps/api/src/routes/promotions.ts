import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { PromotionAction, PromotionPreview, PromotionRow } from "@whizchool/shared/types";
import { audit } from "../audit";
import { schoolToday, toIsoDate } from "../dates";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { currentYearId } from "../school";
import { fullName } from "../students";

const ACTIONS = ["promote", "repeat", "leave", "graduate"] as const;
const TOP_GRADE = 13;
/** Grade 11 → 12 means choosing an A/L stream, so it has no default class. */
const STREAM_CHOICE_GRADE = 11;

/**
 * Next year's classes don't exist until promotions are confirmed, so the plan refers to them as
 * "next_<grade><section>" (e.g. next_10a), mirroring this year's classes.
 */
const targetId = (grade: number, className: string) => `next_${grade}${(className.split("-")[1] ?? className).toLowerCase()}`;

/** "2026" → "2027". */
function nextYearName(name: string) {
  if (!/^\d{4}$/.test(name)) throw new ApiError(409, "not_configured", `Can't work out the year after "${name}".`);
  return String(Number(name) + 1);
}

/** The same calendar day a year later (29 Feb becomes 28 Feb). */
function nextYearDate(d: Date) {
  const [y, m, day] = toIsoDate(d).split("-").map(Number);
  const date = new Date(Date.UTC(y! + 1, m! - 1, day));
  return date.getUTCMonth() === m! - 1 ? date : new Date(Date.UTC(y! + 1, m! - 1, day! - 1));
}

async function planContext() {
  const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: await currentYearId() } });
  const classes = await prisma.classSection.findMany({
    where: { yearId: year.id },
    include: { grade: true, subjects: { select: { subjectId: true, teacherId: true } } },
  });
  const targets = new Map(classes.map((c) => [targetId(c.grade.number, c.name), c]));
  const students = await prisma.student.findMany({
    where: { classId: { in: classes.map((c) => c.id) }, status: "active" },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, classId: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const run = await prisma.promotionRun.findUnique({ where: { fromYearId: year.id }, include: { toYear: true } });
  return { year, classes, targets, students, run };
}

/** What happens to a student by default: up a grade into the same section; Grade 13 graduates. */
function defaultPlan(grade: number, className: string): { action: PromotionAction; toClassId?: string } {
  if (grade === TOP_GRADE) return { action: "graduate" };
  if (grade === STREAM_CHOICE_GRADE) return { action: "promote" };
  return { action: "promote", toClassId: targetId(grade + 1, className) };
}

export const promotionRoutes = [
  defineRoute({
    method: "GET",
    path: "/promotions/preview",
    access: { permission: "promotions.view" },
    summary: "Proposed year-end moves for every active student (or the confirmed plan, which can still be revised)",
    handler: async (): Promise<PromotionPreview> => {
      const { year, classes, targets, students, run } = await planContext();
      const byClass = new Map(classes.map((c) => [c.id, c]));
      // Averages from each student's most recent approved term test this year.
      const cards = await prisma.reportCard.findMany({
        where: { studentId: { in: students.map((s) => s.id) }, exam: { yearId: year.id }, classId: { not: null } },
        select: { studentId: true, average: true, exam: { select: { startDate: true } } },
        orderBy: { exam: { startDate: "asc" } },
      });
      const averages = new Map(cards.map((c) => [c.studentId, Number(c.average)]));

      const planned = new Map<string, { action: PromotionAction; toClassId?: string }>();
      if (run) {
        const enrolments = await prisma.enrollment.findMany({ where: { yearId: run.toYearId }, include: { class: { include: { grade: true } } } });
        const from = new Map(students.map((s) => [s.id, byClass.get(s.classId)!.grade.number]));
        for (const e of enrolments) {
          if (!from.has(e.studentId)) continue;
          planned.set(e.studentId, { action: e.class.grade.number === from.get(e.studentId) ? "repeat" : "promote", toClassId: targetId(e.class.grade.number, e.class.name) });
        }
        for (const [studentId, action] of Object.entries(run.decisions as Record<string, "leave" | "graduate">)) planned.set(studentId, { action });
      }
      const rows = students
        .map((s): PromotionRow => {
          const c = byClass.get(s.classId)!;
          const plan = planned.get(s.id) ?? defaultPlan(c.grade.number, c.name);
          const toClassId = plan.toClassId && targets.has(plan.toClassId) ? plan.toClassId : undefined;
          return {
            studentId: s.id,
            admissionNo: s.admissionNo,
            fullName: fullName(s),
            fromClassId: c.id,
            fromClassName: c.name,
            ...(averages.has(s.id) ? { average: averages.get(s.id) } : {}),
            action: plan.action,
            ...(toClassId ? { toClassId } : {}),
          };
        })
        .sort((a, b) => byClass.get(a.fromClassId)!.grade.number - byClass.get(b.fromClassId)!.grade.number || a.fromClassName.localeCompare(b.fromClassName));
      const unplanned = run ? students.filter((s) => !planned.has(s.id)).length : 0;
      return {
        fromYear: { id: year.id, name: year.name, startDate: toIsoDate(year.startDate), endDate: toIsoDate(year.endDate), status: year.status },
        toYearName: run?.toYear.name ?? nextYearName(year.name),
        rows,
        targetClasses: [...targets]
          .map(([id, c]) => ({ id, name: c.name, gradeNumber: c.grade.number }))
          .sort((a, b) => a.gradeNumber - b.gradeNumber || a.name.localeCompare(b.name)),
        ...(run
          ? {
              completed: {
                at: run.at.toISOString(),
                promoted: run.promoted,
                repeated: run.repeated,
                left: run.left,
                graduated: run.graduated,
                toYearId: run.toYearId,
                unplanned,
                startsFrom: toIsoDate(year.endDate),
                canStart: schoolToday() >= toIsoDate(year.endDate) && unplanned === 0,
              },
            }
          : {}),
      };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/promotions/confirm",
    access: { permission: "promotions.approve" },
    summary: "Save the year-end plan: creates next year (with this year's classes, subjects and terms a year on) and its enrolments",
    body: z.object({
      rows: z.array(z.object({ studentId: z.string().max(100), action: z.enum(ACTIONS), toClassId: z.string().max(100).nullish() })).max(10_000),
    }),
    handler: async ({ auth, body }) => {
      const { year, classes, targets, students, run } = await planContext();
      const nextName = run?.toYear.name ?? nextYearName(year.name);
      const byClass = new Map(classes.map((c) => [c.id, c]));
      const byId = new Map(students.map((s) => [s.id, s]));
      const seen = new Set<string>();
      let needTarget = 0;
      const problems: string[] = [];
      for (const r of body.rows) {
        const s = byId.get(r.studentId);
        if (!s || seen.has(r.studentId)) {
          problems.push("The plan lists a student twice or one who isn't an active student this year.");
          break;
        }
        seen.add(r.studentId);
        const grade = byClass.get(s.classId)!.grade.number;
        if (r.action === "graduate" && grade !== TOP_GRADE) problems.push(`${fullName(s)}: only Grade ${TOP_GRADE} students can graduate.`);
        if (r.action === "promote" && grade === TOP_GRADE) problems.push(`${fullName(s)}: Grade ${TOP_GRADE} students graduate or leave.`);
        if (r.action === "promote" || r.action === "repeat") {
          const target = r.toClassId ? targets.get(r.toClassId) : undefined;
          if (!target) needTarget++;
          else if (target.grade.number !== (r.action === "repeat" ? grade : grade + 1)) {
            problems.push(`${fullName(s)}: ${r.action === "repeat" ? "repeats in" : "moves up to"} the wrong grade (${target.name}).`);
          }
        }
      }
      if (problems.length) throw new ApiError(422, "validation", problems.slice(0, 3).join(" "));
      if (needTarget) throw new ApiError(422, "validation", `${needTarget} student${needTarget === 1 ? "" : "s"} still need a target class.`);
      const missing = students.length - seen.size;
      if (missing) throw new ApiError(422, "validation", `${missing} student${missing === 1 ? " isn't" : "s aren't"} in the plan. Reload the page and try again.`);

      const count = (a: PromotionAction) => body.rows.filter((r) => r.action === a).length;
      const summary = { promoted: count("promote"), repeated: count("repeat"), left: count("leave"), graduated: count("graduate") };
      await prisma.$transaction(
        async (tx) => {
          let next = await tx.academicYear.findUnique({ where: { name: nextName } });
          if (next && next.status !== "upcoming") throw new ApiError(409, "already_done", `The ${nextName} school year has already started.`);
          next ??= await tx.academicYear.create({
            data: { name: nextName, startDate: nextYearDate(year.startDate), endDate: nextYearDate(year.endDate), status: "upcoming" },
          });
          if (!(await tx.term.count({ where: { yearId: next.id } }))) {
            const terms = await tx.term.findMany({ where: { yearId: year.id } });
            await tx.term.createMany({
              data: terms.map((t) => ({ yearId: next!.id, number: t.number, name: t.name, startDate: nextYearDate(t.startDate), endDate: nextYearDate(t.endDate) })),
            });
          }
          // Next year mirrors this year's classes (teachers and subjects included); staff adjust them in Classes.
          const existing = new Map((await tx.classSection.findMany({ where: { yearId: next.id } })).map((c) => [c.name, c.id]));
          const classFor = new Map<string, string>();
          for (const [id, c] of targets) {
            let newId = existing.get(c.name);
            if (!newId) {
              const created = await tx.classSection.create({
                data: {
                  yearId: next.id,
                  gradeId: c.gradeId,
                  section: c.section,
                  name: c.name,
                  streamId: c.streamId,
                  classTeacherId: c.classTeacherId,
                  room: c.room,
                  subjects: { create: c.subjects.map((cs) => ({ subjectId: cs.subjectId, teacherId: cs.teacherId })) },
                },
              });
              newId = created.id;
            }
            classFor.set(id, newId);
          }
          await tx.enrollment.deleteMany({ where: { yearId: next.id, studentId: { in: [...seen] } } });
          await tx.enrollment.createMany({
            data: body.rows
              .filter((r) => r.action === "promote" || r.action === "repeat")
              .map((r) => ({ studentId: r.studentId, yearId: next!.id, classId: classFor.get(r.toClassId!)! })),
          });
          const decisions = Object.fromEntries(body.rows.filter((r) => r.action === "leave" || r.action === "graduate").map((r) => [r.studentId, r.action]));
          const data = { toYearId: next.id, ...summary, decisions, at: new Date(), byId: auth.session.id };
          await tx.promotionRun.upsert({ where: { fromYearId: year.id }, update: data, create: { fromYearId: year.id, ...data } });
          await audit(tx, auth, {
            action: "promotions.confirm",
            entity: "Promotions",
            summary: `${run ? "Revised" : "Confirmed"} ${nextName} promotions: ${summary.promoted} promoted, ${summary.repeated} repeating, ${summary.graduated} graduating, ${summary.left} leaving`,
          });
        },
        { timeout: 60_000 },
      );
      return { at: new Date().toISOString(), ...summary };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/promotions/start",
    access: { permission: "promotions.approve" },
    summary: "Start next school year: students move into their new classes, leavers and graduates are marked, next year becomes current",
    handler: async ({ auth }) => {
      const { year, students, run } = await planContext();
      if (!run) throw new ApiError(409, "invalid_transition", "Confirm the promotions first.");
      const ends = toIsoDate(year.endDate);
      if (schoolToday() < ends) throw new ApiError(409, "too_early", `The ${year.name} school year runs until ${ends}. Start ${run.toYear.name} after that.`);
      const decisions = run.decisions as Record<string, "leave" | "graduate">;
      const enrolled = new Set(
        (await prisma.enrollment.findMany({ where: { yearId: run.toYearId, studentId: { in: students.map((s) => s.id) } }, select: { studentId: true } })).map((e) => e.studentId),
      );
      const unplanned = students.filter((s) => !enrolled.has(s.id) && !decisions[s.id]).length;
      if (unplanned) {
        throw new ApiError(409, "unplanned", `${unplanned} student${unplanned === 1 ? " was" : "s were"} admitted after the promotions were confirmed. Review the promotions and confirm them again.`);
      }
      const ids = (a: "leave" | "graduate") => Object.keys(decisions).filter((id) => decisions[id] === a);
      const result = await prisma.$transaction(
        async (tx) => {
          const moved = await tx.$executeRaw`
            UPDATE "Student" s SET "classId" = e."classId", "gradeId" = c."gradeId"
            FROM "Enrollment" e JOIN "Class" c ON c."id" = e."classId"
            WHERE e."studentId" = s."id" AND e."yearId" = ${run.toYearId} AND s."status" = 'active'`;
          const leaving = { leftDate: year.endDate, leftReason: `End of the ${year.name} school year` };
          const left = await tx.student.updateMany({ where: { id: { in: ids("leave") }, status: "active" }, data: { status: "left", ...leaving } });
          const graduated = await tx.student.updateMany({ where: { id: { in: ids("graduate") }, status: "active" }, data: { status: "graduated", ...leaving } });
          await tx.academicYear.update({ where: { id: year.id }, data: { status: "closed" } });
          await tx.academicYear.update({ where: { id: run.toYearId }, data: { status: "active" } });
          await tx.school.update({ where: { id: "school" }, data: { currentYearId: run.toYearId } });
          await tx.promotionRun.update({ where: { id: run.id }, data: { startedAt: new Date() } });
          await audit(tx, auth, {
            action: "year.start",
            entity: "Academic year",
            entityId: run.toYearId,
            summary: `Started the ${run.toYear.name} school year: ${moved} students in their new classes, ${graduated.count} graduated, ${left.count} left`,
          });
          return { year: run.toYear.name, moved, left: left.count, graduated: graduated.count };
        },
        { timeout: 60_000 },
      );
      return result;
    },
  }),
];
