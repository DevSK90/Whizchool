import type { Route } from "../router";
import type {
  ExamProgress,
  MarkSheet,
  MarkValue,
  PromotionAction,
  PromotionPreview,
  PromotionRow,
  ReportCard,
  ReportCardClassView,
} from "@whizchool/shared/types";
import { gradeFor } from "@whizchool/shared/grading";
import {
  audit,
  canSeeStudent,
  currentClasses,
  fail,
  fullName,
  hasFullScope,
  isoNow,
  requireAuth,
  requirePerm,
  todayISO,
  type Ctx,
} from "../helpers";
import { nextId, type DB } from "../db";
import {
  classResults,
  classRoster,
  gradeCounts,
  marksComplete,
  markOf,
  reportStatus,
  studentClassSubjects,
  termAttendance,
} from "../results";

function getExam(db: DB, id: string) {
  return db.exams.get(id) ?? fail(404, "not_found", "Exam not found.");
}

function teachesSheet(ctx: Ctx, classId: string, subjectId: string) {
  return ctx.session!.classSubjectIds.some((id) => {
    const cs = ctx.db.classSubjects.get(id);
    return cs?.classId === classId && cs.subjectId === subjectId;
  });
}

function sheetKey(examId: string, classId: string, subjectId: string) {
  return `${examId}|${classId}|${subjectId}`;
}

function sheetRoster(db: DB, classId: string, subjectId: string) {
  return classRoster(db, classId).filter((s) => studentClassSubjects(db, s).some((cs) => cs.subjectId === subjectId));
}

function assertClassTeacherOrFull(ctx: Ctx, classId: string, perm: "reportCards.view" | "reportCards.edit") {
  const s = requirePerm(ctx, perm);
  if (!hasFullScope(s, perm, ctx.db) && !s.classIds.includes(classId)) {
    fail(403, "forbidden", "You can only access report cards for your own class.");
  }
}

function buildReportCard(db: DB, examId: string, studentId: string, today: string): ReportCard {
  const exam = getExam(db, examId);
  const student = db.students.get(studentId) ?? fail(404, "not_found", "Student not found.");
  const res = classResults(db, examId, student.classId);
  const row = res.rows.find((r) => r.student.id === studentId) ?? fail(404, "not_found", "No results for this student.");
  const remarks = db.remarks.get(`${examId}|${studentId}`);
  const cls = db.classes.get(student.classId)!;
  return {
    exam,
    school: { name: db.school.name, motto: db.school.motto, address: db.school.address, phone: db.school.phone, principalName: db.school.principalName },
    student: { id: student.id, admissionNo: student.admissionNo, fullName: fullName(student), classId: cls.id, className: cls.name, gradeName: db.grades.get(cls.gradeId)!.name },
    status: reportStatus(db, examId, student.classId),
    subjects: row.subjects.map((x) => ({
      subjectId: x.subjectId,
      name: db.subjects.get(x.subjectId)!.name,
      mark: x.mark,
      grade: gradeFor(x.mark, db.gradeBands),
      classAverage: res.subjectAverages[x.subjectId] ?? 0,
    })),
    total: row.total,
    average: row.average,
    rank: row.rank,
    classSize: res.classSize,
    attendance: termAttendance(db, studentId, db.terms.get(exam.termId)!, today),
    classTeacherRemark: remarks?.classTeacher,
    principalRemark: remarks?.principal,
    classTeacherName: db.staff.get(cls.classTeacherId)?.name,
  };
}

function refreshExamStatus(db: DB, examId: string) {
  const exam = db.exams.get(examId)!;
  const all = currentClasses(db).every((c) => reportStatus(db, examId, c.id) === "released");
  if (all) exam.status = "released";
  else if (exam.status === "released") exam.status = "review";
}

export const examRoutes: Route[] = [
  {
    method: "GET",
    path: "/exams",
    handler: (ctx) => {
      requireAuth(ctx);
      const yearId = ctx.query.yearId ?? ctx.db.school.currentYearId;
      return ctx.db.exams.rows.filter((e) => e.yearId === yearId);
    },
  },
  {
    method: "POST",
    path: "/exams",
    handler: (ctx) => {
      requirePerm(ctx, "settings.edit");
      const { termId, name, startDate, endDate } = ctx.body ?? {};
      const term = ctx.db.terms.get(termId) ?? fail(422, "validation", "Choose a term.", { termId: "Required" });
      if (!name?.trim()) fail(422, "validation", "Name is required.", { name: "Required" });
      if (!startDate || !endDate || startDate > endDate) fail(422, "validation", "Check the dates.", { endDate: "Must be after the start date" });
      if (startDate < term.startDate || endDate > term.endDate) {
        fail(422, "validation", "Please fix the highlighted fields.", { startDate: `Must be within ${term.name} (${term.startDate} to ${term.endDate})` });
      }
      if (ctx.db.exams.rows.some((e) => e.termId === termId)) fail(409, "duplicate", "This term already has a term test.");
      const exam = ctx.db.exams.insert({
        id: nextId(ctx.db, "exam"), yearId: term.yearId, termId, name: name.trim(), termName: term.name, status: "scheduled", startDate, endDate,
      });
      audit(ctx, "exam.create", "Exam", `Scheduled ${exam.name}`, exam.id);
      return exam;
    },
  },
  {
    method: "PUT",
    path: "/exams/:id/status",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const exam = getExam(ctx.db, ctx.params.id);
      const { status } = ctx.body ?? {};
      const allowed: Record<string, string[]> = { scheduled: ["marks_entry"], marks_entry: ["review"], review: ["marks_entry"] };
      if (!allowed[exam.status]?.includes(status)) fail(409, "invalid_transition", "That status change isn't allowed.");
      exam.status = status;
      audit(ctx, "exam.status", "Exam", `${exam.name}: ${status === "marks_entry" ? "opened marks entry" : status === "review" ? "closed marks entry" : status}`, exam.id);
      return exam;
    },
  },
  {
    method: "GET",
    path: "/exams/:id/progress",
    handler: (ctx): ExamProgress => {
      const s = requirePerm(ctx, "marks.view");
      const db = ctx.db;
      const exam = getExam(db, ctx.params.id);
      const full = hasFullScope(s, "marks.view", db);
      const visible = new Set(s.classSubjectIds);
      const classes = new Map(currentClasses(db).map((c) => [c.id, c]));
      const sheets = db.classSubjects.rows
        .filter((cs) => classes.has(cs.classId) && (full || visible.has(cs.id)))
        .map((cs) => {
          const cls = classes.get(cs.classId)!;
          const roster = sheetRoster(db, cs.classId, cs.subjectId);
          return {
            classId: cs.classId,
            className: cls.name,
            gradeNumber: db.grades.get(cls.gradeId)!.number,
            subjectId: cs.subjectId,
            subjectName: db.subjects.get(cs.subjectId)!.name,
            teacherName: db.staff.get(cs.teacherId)?.name,
            entered: roster.filter((st) => markOf(db, exam.id, st.id, cs.subjectId) !== null).length,
            total: roster.length,
            submitted: db.submittedSheets.has(sheetKey(exam.id, cs.classId, cs.subjectId)),
          };
        })
        .sort((a, b) => a.gradeNumber - b.gradeNumber || a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
      return { exam, sheets };
    },
  },
  {
    method: "GET",
    path: "/exams/:id/marks",
    handler: (ctx): MarkSheet => {
      const s = requirePerm(ctx, "marks.view");
      const db = ctx.db;
      const exam = getExam(db, ctx.params.id);
      const { classId, subjectId } = ctx.query;
      const cls = db.classes.get(classId) ?? fail(404, "not_found", "Class not found.");
      if (!db.classSubjects.rows.some((cs) => cs.classId === classId && cs.subjectId === subjectId)) fail(404, "not_found", "This class doesn't take that subject.");
      const full = hasFullScope(s, "marks.view", db);
      if (!full && !teachesSheet(ctx, classId, subjectId)) fail(403, "forbidden", "You can only open mark sheets for subjects you teach.");
      const submitted = db.submittedSheets.has(sheetKey(exam.id, classId, subjectId));
      const canEdit = s.permissions.includes("marks.edit") && (hasFullScope(s, "marks.edit", db) || teachesSheet(ctx, classId, subjectId));
      return {
        examId: exam.id,
        classId,
        className: cls.name,
        subjectId,
        subjectName: db.subjects.get(subjectId)!.name,
        submitted,
        editable: exam.status === "marks_entry" && !submitted && canEdit,
        rows: sheetRoster(db, classId, subjectId).map((st) => ({
          studentId: st.id,
          admissionNo: st.admissionNo,
          fullName: fullName(st),
          mark: markOf(db, exam.id, st.id, subjectId),
        })),
      };
    },
  },
  {
    method: "PUT",
    path: "/exams/:id/marks",
    handler: (ctx) => {
      const s = requirePerm(ctx, "marks.edit");
      const db = ctx.db;
      const exam = getExam(db, ctx.params.id);
      const { classId, subjectId, marks, submit } = ctx.body ?? {};
      if (exam.status !== "marks_entry") fail(409, "locked", "Marks entry is closed for this exam.");
      if (!hasFullScope(s, "marks.edit", db) && !teachesSheet(ctx, classId, subjectId)) fail(403, "forbidden", "You can only enter marks for subjects you teach.");
      const key = sheetKey(exam.id, classId, subjectId);
      if (db.submittedSheets.has(key)) fail(409, "locked", "This mark sheet has been submitted and is locked.");
      const roster = new Set(sheetRoster(db, classId, subjectId).map((x) => x.id));
      const fields: Record<string, string> = {};
      for (const { studentId, mark } of marks as { studentId: string; mark: MarkValue }[]) {
        if (!roster.has(studentId)) fields[studentId] = "Not on this mark sheet";
        else if (mark !== null && mark !== "AB" && !(Number.isInteger(mark) && mark >= 0 && mark <= 100)) fields[studentId] = "Enter 0–100 or AB";
      }
      if (Object.keys(fields).length) fail(422, "validation", "Some marks are invalid.", fields);
      for (const { studentId, mark } of marks as { studentId: string; mark: MarkValue }[]) {
        if (!roster.has(studentId)) continue;
        const k = `${exam.id}|${studentId}|${subjectId}`;
        if (mark === null) db.marks.delete(k);
        else db.marks.set(k, mark);
      }
      const subjectName = db.subjects.get(subjectId)?.name;
      const className = db.classes.get(classId)?.name;
      if (submit) {
        const missing = [...roster].filter((id) => markOf(db, exam.id, id, subjectId) === null).length;
        if (missing) fail(422, "incomplete", `${missing} student${missing === 1 ? "" : "s"} still need a mark (or AB) before you can submit.`);
        db.submittedSheets.add(key);
        audit(ctx, "marks.submit", "Mark sheet", `Submitted ${subjectName} marks for ${className} (${exam.termName})`);
      } else {
        audit(ctx, "marks.save", "Mark sheet", `Saved ${subjectName} marks for ${className} (${exam.termName})`);
      }
      return { submitted: !!submit, saved: marks.length };
    },
  },
  {
    method: "POST",
    path: "/exams/:id/marks/unlock",
    handler: (ctx) => {
      const s = requirePerm(ctx, "marks.edit");
      if (!hasFullScope(s, "marks.edit", ctx.db)) fail(403, "forbidden", "Only an administrator can unlock a submitted mark sheet.");
      const exam = getExam(ctx.db, ctx.params.id);
      const { classId, subjectId, reason } = ctx.body ?? {};
      if (reportStatus(ctx.db, exam.id, classId) === "released" || reportStatus(ctx.db, exam.id, classId) === "approved") {
        fail(409, "locked", "Report cards for this class are already approved. Revert approval first.");
      }
      ctx.db.submittedSheets.delete(sheetKey(exam.id, classId, subjectId));
      audit(ctx, "marks.unlock", "Mark sheet", `Unlocked ${ctx.db.subjects.get(subjectId)?.name} for ${ctx.db.classes.get(classId)?.name}${reason ? `: ${reason}` : ""}`);
      return { ok: true };
    },
  },

  // ---------- Report cards ----------
  {
    method: "GET",
    path: "/report-cards",
    handler: (ctx): ReportCardClassView => {
      const { examId, classId } = ctx.query;
      assertClassTeacherOrFull(ctx, classId, "reportCards.view");
      const db = ctx.db;
      const exam = getExam(db, examId);
      const cls = db.classes.get(classId) ?? fail(404, "not_found", "Class not found.");
      const res = classResults(db, examId, classId);
      const status = reportStatus(db, examId, classId);
      return {
        exam, classId, className: cls.name, status, marksComplete: marksComplete(db, examId, classId),
        rows: res.rows
          .map((r) => ({
            examId, studentId: r.student.id, admissionNo: r.student.admissionNo, fullName: fullName(r.student),
            total: r.total, average: r.average, rank: r.rank, classSize: res.classSize,
            grades: gradeCounts(db, r.subjects.map((x) => x.mark)), status,
            hasRemark: !!db.remarks.get(`${examId}|${r.student.id}`)?.classTeacher,
          }))
          .sort((a, b) => a.rank - b.rank),
      };
    },
  },
  {
    method: "GET",
    path: "/report-cards/overview",
    handler: (ctx) => {
      const s = requirePerm(ctx, "reportCards.view");
      const db = ctx.db;
      const exam = getExam(db, ctx.query.examId);
      const full = hasFullScope(s, "reportCards.view", db);
      return currentClasses(db)
        .filter((c) => full || s.classIds.includes(c.id))
        .map((c) => {
          const total = db.classSubjects.rows.filter((cs) => cs.classId === c.id).length;
          const submitted = db.classSubjects.rows.filter((cs) => cs.classId === c.id && db.submittedSheets.has(sheetKey(exam.id, c.id, cs.subjectId))).length;
          return {
            classId: c.id, className: c.name, gradeNumber: db.grades.get(c.gradeId)!.number,
            classTeacherName: db.staff.get(c.classTeacherId)?.name, status: reportStatus(db, exam.id, c.id),
            sheetsSubmitted: submitted, sheetsTotal: total, students: classRoster(db, c.id).length,
          };
        })
        .sort((a, b) => a.gradeNumber - b.gradeNumber || a.className.localeCompare(b.className));
    },
  },
  {
    method: "GET",
    path: "/report-cards/batch",
    handler: (ctx): ReportCard[] => {
      const { examId, classId } = ctx.query;
      assertClassTeacherOrFull(ctx, classId, "reportCards.view");
      const db = ctx.db;
      getExam(db, examId);
      const today = todayISO(ctx);
      return classResults(db, examId, classId)
        .rows.sort((a, b) => a.student.firstName.localeCompare(b.student.firstName))
        .map((r) => buildReportCard(db, examId, r.student.id, today));
    },
  },
  {
    method: "GET",
    path: "/report-cards/:examId/:studentId",
    handler: (ctx) => {
      const s = requireAuth(ctx);
      const db = ctx.db;
      const student = db.students.get(ctx.params.studentId) ?? fail(404, "not_found", "Student not found.");
      if (s.kind === "parent") {
        if (!canSeeStudent(ctx, student.id)) fail(403, "forbidden", "You can only view your own children's report cards.");
        if (reportStatus(db, ctx.params.examId, student.classId) !== "released") fail(404, "not_released", "This report card hasn't been released yet.");
      } else {
        assertClassTeacherOrFull(ctx, student.classId, "reportCards.view");
      }
      return buildReportCard(db, ctx.params.examId, student.id, todayISO(ctx));
    },
  },
  {
    method: "PUT",
    path: "/report-cards/:examId/:studentId/remarks",
    handler: (ctx) => {
      const db = ctx.db;
      const student = db.students.get(ctx.params.studentId) ?? fail(404, "not_found", "Student not found.");
      assertClassTeacherOrFull(ctx, student.classId, "reportCards.edit");
      const status = reportStatus(db, ctx.params.examId, student.classId);
      if (status === "approved" || status === "released") fail(409, "locked", "Remarks are locked after approval.");
      const key = `${ctx.params.examId}|${student.id}`;
      const current = db.remarks.get(key) ?? {};
      const { classTeacherRemark, principalRemark } = ctx.body ?? {};
      if (typeof classTeacherRemark === "string" && classTeacherRemark.length > 300) fail(422, "validation", "Keep remarks under 300 characters.", { classTeacherRemark: "Max 300 characters" });
      if (principalRemark !== undefined && !ctx.session!.permissions.includes("reportCards.approve")) fail(403, "forbidden", "Only the principal can add a principal's remark.");
      db.remarks.set(key, {
        classTeacher: classTeacherRemark ?? current.classTeacher,
        principal: principalRemark ?? current.principal,
      });
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "/report-cards/approve",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const db = ctx.db;
      const { examId, classId } = ctx.body ?? {};
      const status = reportStatus(db, examId, classId);
      if (status === "pending_marks") fail(409, "incomplete", "All mark sheets must be submitted before approval.");
      if (status !== "draft") fail(409, "invalid_transition", "Report cards are already approved.");
      const missing = classRoster(db, classId).filter((st) => !db.remarks.get(`${examId}|${st.id}`)?.classTeacher).length;
      if (missing && !ctx.body?.force) fail(409, "missing_remarks", `${missing} student${missing === 1 ? " has" : "s have"} no class-teacher remark yet.`);
      db.reportStatus.set(`${examId}|${classId}`, "approved");
      const exam = getExam(db, examId);
      audit(ctx, "reportCards.approve", "Report cards", `Approved ${exam.name} report cards for ${db.classes.get(classId)?.name}`);
      return { status: "approved" };
    },
  },
  {
    method: "POST",
    path: "/report-cards/release",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const db = ctx.db;
      const { examId, classId } = ctx.body ?? {};
      if (reportStatus(db, examId, classId) !== "approved") fail(409, "invalid_transition", "Approve the report cards before releasing them.");
      db.reportStatus.set(`${examId}|${classId}`, "released");
      refreshExamStatus(db, examId);
      const exam = getExam(db, examId);
      const parents = classRoster(db, classId).length;
      db.messages.insert({
        id: nextId(db, "msg"), channel: "email", kind: "system",
        audience: { type: "class", ids: [classId], label: `Parents of ${db.classes.get(classId)?.name}` },
        subject: `${exam.name} report card is available`,
        body: `The ${exam.name} report card for {student} is now available in the parent portal.`,
        recipients: parents, delivered: 0, failed: 0, status: "queued", createdAt: isoNow(ctx), createdBy: ctx.session!.name,
      });
      audit(ctx, "reportCards.release", "Report cards", `Released ${exam.name} report cards for ${db.classes.get(classId)?.name}`);
      return { status: "released", notified: parents };
    },
  },
  {
    method: "POST",
    path: "/report-cards/revert",
    handler: (ctx) => {
      requirePerm(ctx, "reportCards.approve");
      const db = ctx.db;
      const { examId, classId } = ctx.body ?? {};
      if (reportStatus(db, examId, classId) !== "approved") fail(409, "invalid_transition", "Only approved (unreleased) report cards can be reverted.");
      db.reportStatus.delete(`${examId}|${classId}`);
      audit(ctx, "reportCards.revert", "Report cards", `Reverted approval for ${db.classes.get(classId)?.name}`);
      return { status: "draft" };
    },
  },

  // ---------- Promotions ----------
  {
    method: "GET",
    path: "/promotions/preview",
    handler: (ctx): PromotionPreview => {
      requirePerm(ctx, "promotions.view");
      const db = ctx.db;
      const { year, targets, students, plan, gradeOf } = planContext(db);
      // Averages from each class's most recent approved term test this year.
      const averages = new Map<string, number>();
      for (const c of currentClasses(db)) {
        const exam = db.exams.rows.filter((e) => e.yearId === year.id && ["approved", "released"].includes(reportStatus(db, e.id, c.id))).pop();
        if (exam) for (const r of classResults(db, exam.id, c.id).rows) averages.set(r.student.id, r.average);
      }
      const planned = new Map<string, { action: PromotionAction; toClassId?: string }>();
      if (plan) {
        const onRoll = new Set(students.map((s) => s.id));
        for (const e of db.enrollments.rows.filter((x) => x.yearId === plan.toYearId && onRoll.has(x.studentId))) {
          const s = db.students.get(e.studentId)!;
          const to = db.classes.get(e.classId)!;
          const g = gradeOf(to.gradeId);
          planned.set(s.id, { action: g === gradeOf(s.gradeId) ? "repeat" : "promote", toClassId: targetId(g, to.name) });
        }
        for (const [id, action] of Object.entries(plan.decisions)) planned.set(id, { action });
      }
      const rows: PromotionRow[] = students.map((s) => {
        const c = db.classes.get(s.classId)!;
        const p = planned.get(s.id) ?? defaultPlan(gradeOf(c.gradeId), c.name);
        const toClassId = p.toClassId && targets.has(p.toClassId) ? p.toClassId : undefined;
        return {
          studentId: s.id, admissionNo: s.admissionNo, fullName: fullName(s), fromClassId: c.id, fromClassName: c.name,
          average: averages.get(s.id), action: p.action, toClassId,
        };
      });
      const unplanned = plan ? students.filter((s) => !planned.has(s.id)).length : 0;
      return {
        fromYear: year,
        toYearName: plan ? db.years.get(plan.toYearId)!.name : nextYearName(year.name),
        rows,
        targetClasses: [...targets]
          .map(([id, c]) => ({ id, name: c.name, gradeNumber: gradeOf(c.gradeId) }))
          .sort((a, b) => a.gradeNumber - b.gradeNumber || a.name.localeCompare(b.name)),
        completed: plan
          ? {
              at: plan.at, promoted: plan.promoted, repeated: plan.repeated, left: plan.left, graduated: plan.graduated,
              toYearId: plan.toYearId, unplanned, startsFrom: year.endDate, canStart: todayISO(ctx) >= year.endDate && unplanned === 0,
            }
          : undefined,
      };
    },
  },
  {
    method: "POST",
    path: "/promotions/confirm",
    handler: (ctx) => {
      requirePerm(ctx, "promotions.approve");
      const db = ctx.db;
      const { year, targets, students, plan, gradeOf } = planContext(db);
      const rows = (ctx.body?.rows ?? []) as PromotionRow[];
      const onRoll = new Map(students.map((s) => [s.id, s]));
      const seen = new Set<string>();
      const problems: string[] = [];
      let needTarget = 0;
      for (const r of rows) {
        const s = onRoll.get(r.studentId);
        if (!s || seen.has(r.studentId)) {
          problems.push("The plan lists a student twice or one who isn't an active student this year.");
          break;
        }
        seen.add(s.id);
        const g = gradeOf(s.gradeId);
        if (r.action === "graduate" && g !== 13) problems.push(`${fullName(s)}: only Grade 13 students can graduate.`);
        if (r.action === "promote" && g === 13) problems.push(`${fullName(s)}: Grade 13 students graduate or leave.`);
        if (r.action === "promote" || r.action === "repeat") {
          const target = r.toClassId ? targets.get(r.toClassId) : undefined;
          if (!target) needTarget++;
          else if (gradeOf(target.gradeId) !== (r.action === "repeat" ? g : g + 1)) {
            problems.push(`${fullName(s)}: ${r.action === "repeat" ? "repeats in" : "moves up to"} the wrong grade (${target.name}).`);
          }
        }
      }
      if (problems.length) fail(422, "validation", problems.slice(0, 3).join(" "));
      if (needTarget) fail(422, "validation", `${needTarget} student${needTarget === 1 ? "" : "s"} still need a target class.`);
      const missing = students.length - seen.size;
      if (missing) fail(422, "validation", `${missing} student${missing === 1 ? " isn't" : "s aren't"} in the plan. Reload the page and try again.`);

      const nextName = plan ? db.years.get(plan.toYearId)!.name : nextYearName(year.name);
      let next = db.years.rows.find((y) => y.name === nextName);
      if (next && next.status !== "upcoming") fail(409, "already_done", `The ${nextName} school year has already started.`);
      next ??= db.years.insert({ id: `year_${nextName}`, name: nextName, startDate: nextYearIso(year.startDate), endDate: nextYearIso(year.endDate), status: "upcoming" });
      const nextYear = next;
      if (!db.terms.rows.some((t) => t.yearId === nextYear.id)) {
        for (const t of db.terms.rows.filter((x) => x.yearId === year.id)) {
          db.terms.insert({ ...t, id: `term_${nextName}_${t.number}`, yearId: nextYear.id, startDate: nextYearIso(t.startDate), endDate: nextYearIso(t.endDate) });
        }
      }
      // Next year mirrors this year's classes, teachers and subjects included.
      const classFor = new Map<string, string>();
      for (const [id, c] of targets) {
        let cls = db.classes.rows.find((x) => x.yearId === nextYear.id && x.name === c.name);
        if (!cls) {
          cls = db.classes.insert({ ...c, id: `cls_${nextName}_${id.slice("next_".length)}`, yearId: nextYear.id });
          for (const cs of db.classSubjects.rows.filter((x) => x.classId === c.id)) {
            db.classSubjects.insert({ id: nextId(db, "cs"), classId: cls.id, subjectId: cs.subjectId, teacherId: cs.teacherId });
          }
        }
        classFor.set(id, cls.id);
      }
      for (const e of db.enrollments.rows.filter((x) => x.yearId === nextYear.id && seen.has(x.studentId))) db.enrollments.remove(e.id);
      for (const r of rows) {
        if (r.action === "promote" || r.action === "repeat") {
          db.enrollments.insert({ id: nextId(db, "enr"), studentId: r.studentId, yearId: nextYear.id, classId: classFor.get(r.toClassId!)! });
        }
      }
      const count = (a: PromotionAction) => rows.filter((r) => r.action === a).length;
      const summary = { at: isoNow(ctx), promoted: count("promote"), repeated: count("repeat"), left: count("leave"), graduated: count("graduate") };
      db.promotionPlan = {
        fromYearId: year.id,
        toYearId: nextYear.id,
        ...summary,
        decisions: Object.fromEntries(
          rows.filter((r) => r.action === "leave" || r.action === "graduate").map((r) => [r.studentId, r.action as "leave" | "graduate"]),
        ),
      };
      audit(ctx, "promotions.confirm", "Promotions", `${plan ? "Revised" : "Confirmed"} ${nextName} promotions: ${summary.promoted} promoted, ${summary.repeated} repeating, ${summary.graduated} graduating, ${summary.left} leaving`);
      return summary;
    },
  },
  {
    method: "POST",
    path: "/promotions/start",
    handler: (ctx) => {
      requirePerm(ctx, "promotions.approve");
      const db = ctx.db;
      const { year, students, plan } = planContext(db);
      if (!plan) return fail(409, "invalid_transition", "Confirm the promotions first.");
      const next = db.years.get(plan.toYearId)!;
      if (todayISO(ctx) < year.endDate) fail(409, "too_early", `The ${year.name} school year runs until ${year.endDate}. Start ${next.name} after that.`);
      const enrolments = new Map(db.enrollments.rows.filter((e) => e.yearId === next.id).map((e) => [e.studentId, e]));
      const unplanned = students.filter((s) => !enrolments.has(s.id) && !plan.decisions[s.id]).length;
      if (unplanned) {
        fail(409, "unplanned", `${unplanned} student${unplanned === 1 ? " was" : "s were"} admitted after the promotions were confirmed. Review the promotions and confirm them again.`);
      }
      let moved = 0;
      let left = 0;
      let graduated = 0;
      for (const s of students) {
        const e = enrolments.get(s.id);
        if (e) {
          s.classId = e.classId;
          s.gradeId = db.classes.get(e.classId)!.gradeId;
          moved++;
        } else {
          const graduating = plan.decisions[s.id] === "graduate";
          Object.assign(s, { status: graduating ? "graduated" : "left", leftDate: year.endDate, leftReason: `End of the ${year.name} school year` });
          if (graduating) graduated++;
          else left++;
        }
      }
      year.status = "closed";
      next.status = "active";
      db.school.currentYearId = next.id;
      db.promotionPlan = undefined;
      audit(ctx, "year.start", "Academic year", `Started the ${next.name} school year: ${moved} students in their new classes, ${graduated} graduated, ${left} left`, next.id);
      return { year: next.name, moved, left, graduated };
    },
  },
];

/** Next year's classes are referred to as "next_<grade><section>" until they exist (the web app builds the same ids). */
const targetId = (grade: number, className: string) => `next_${grade}${(className.split("-")[1] ?? className).toLowerCase()}`;
const nextYearName = (name: string) => String(Number(name) + 1);
const nextYearIso = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;

function defaultPlan(grade: number, className: string): { action: PromotionAction; toClassId?: string } {
  if (grade === 13) return { action: "graduate" };
  if (grade === 11) return { action: "promote" }; // the A/L stream must be chosen
  return { action: "promote", toClassId: targetId(grade + 1, className) };
}

function planContext(db: DB) {
  const year = db.years.get(db.school.currentYearId)!;
  const gradeOf = (gradeId: string) => db.grades.get(gradeId)!.number;
  const classes = [...currentClasses(db)].sort((a, b) => gradeOf(a.gradeId) - gradeOf(b.gradeId) || a.name.localeCompare(b.name));
  const targets = new Map(classes.map((c) => [targetId(gradeOf(c.gradeId), c.name), c]));
  const students = classes.flatMap((c) => classRoster(db, c.id));
  const plan = db.promotionPlan?.fromYearId === year.id ? db.promotionPlan : undefined;
  return { year, targets, students, plan, gradeOf };
}
