import type { Route } from "../router";
import type {
  AttendanceStatus,
  Guardian,
  Invoice,
  Student,
  StudentAttendance,
  StudentDetail,
  StudentResults,
} from "../../types";
import { gradeFor } from "@/lib/grading";
import {
  assertStudentAccess,
  audit,
  canSeeStudent,
  className,
  fail,
  fullName,
  hasFullScope,
  isoNow,
  matches,
  paginate,
  requireAuth,
  requirePerm,
  sortRows,
  studentBalance,
  todayISO,
  toInvoiceListItem,
  toStudentListItem,
  fileRef,
  type Ctx,
} from "../helpers";
import { nextId, nextNumber, type DB } from "../db";
import { classResults, reportStatus, studentClassSubjects } from "../results";

export interface NewStudentInput {
  firstName: string;
  lastName: string;
  gender: Student["gender"];
  dob: string;
  classId: string;
  address: string;
  religion?: string;
  medical?: Student["medical"];
  electiveSubjectIds?: string[];
  discountIds?: string[];
  guardian: Omit<Guardian, "id" | "userId">;
  inviteParent?: boolean;
}

function validateStudent(db: DB, input: Partial<NewStudentInput>) {
  const fields: Record<string, string> = {};
  if (!input.firstName?.trim()) fields.firstName = "Required";
  if (!input.lastName?.trim()) fields.lastName = "Required";
  if (input.gender !== "M" && input.gender !== "F") fields.gender = "Required";
  if (!input.dob) fields.dob = "Required";
  if (!db.classes.get(input.classId)) fields.classId = "Choose a class";
  if (!input.address?.trim()) fields.address = "Required";
  if (Object.keys(fields).length) fail(422, "validation", "Please fix the highlighted fields.", fields);
}

export function inviteUser(ctx: Ctx, user: { name: string; email: string; phone?: string; kind: "staff" | "parent"; roleIds: string[]; guardianId?: string; staffId?: string }) {
  const existing = ctx.db.users.rows.find((u) => u.email.toLowerCase() === user.email.toLowerCase());
  if (existing) fail(409, "duplicate", "A user with this email already exists.", { email: "Already registered" });
  const u = ctx.db.users.insert({ ...user, id: nextId(ctx.db, "usr"), status: "invited", invitedAt: isoNow(ctx), password: "" });
  const token = `inv-${u.id}`;
  ctx.db.tokens.set(token, { userId: u.id, kind: "invite" });
  ctx.db.messages.insert({
    id: nextId(ctx.db, "msg"), channel: "email", kind: "system",
    audience: { type: user.kind === "staff" ? "all_staff" : "all_parents", label: user.email },
    subject: `You're invited to ${ctx.db.school.name} on Whizchool`,
    body: `Hello ${user.name}, set your password using this link: /invite/${token}`,
    recipients: 1, delivered: 1, failed: 0, status: "sent", createdAt: isoNow(ctx), createdBy: ctx.session?.name ?? "System",
  });
  return { user: u, inviteLink: `/invite/${token}` };
}

/** Creates the student, guardian, enrollment and the first invoice (admission + current month). */
export function createStudent(ctx: Ctx, input: NewStudentInput) {
  const db = ctx.db;
  validateStudent(db, input);
  const g = input.guardian;
  if (!g?.name?.trim() || !g.phone?.trim()) {
    fail(422, "validation", "Guardian name and phone are required.", { "guardian.name": g?.name ? "" : "Required", "guardian.phone": g?.phone ? "" : "Required" });
  }
  const existingGuardian = g.email ? db.guardians.rows.find((x) => x.email?.toLowerCase() === g.email!.toLowerCase()) : undefined;
  const guardian = existingGuardian ?? db.guardians.insert({ ...g, id: nextId(db, "gdn") });
  const cls = db.classes.get(input.classId)!;
  const student: Student = {
    id: nextId(db, "stu"),
    admissionNo: String(nextNumber(db, "admissionNo", 10850 + db.students.size)),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    nameWithInitials: `${input.firstName.trim()[0]}. ${input.lastName.trim()}`,
    gender: input.gender,
    dob: input.dob,
    classId: cls.id,
    gradeId: cls.gradeId,
    status: "active",
    joinedDate: todayISO(ctx),
    address: input.address,
    religion: input.religion,
    medical: input.medical,
    guardianIds: [guardian.id],
    electiveSubjectIds: input.electiveSubjectIds ?? [],
    discountIds: input.discountIds ?? (existingGuardian ? ["disc_sibling"] : []),
  };
  db.students.insert(student);
  db.enrollments.insert({ id: nextId(db, "enr"), studentId: student.id, yearId: cls.yearId, classId: cls.id });

  // First invoice: admission + deposit + current month tuition
  const today = todayISO(ctx);
  const period = today.slice(0, 7);
  const fs = (feeTypeId: string) => db.feeStructures.rows.find((f) => f.gradeId === cls.gradeId && f.feeTypeId === feeTypeId)?.amount ?? 0;
  const tuition = fs("fee_tuition");
  const pct = student.discountIds.map((d) => db.discounts.get(d)).reduce((a, d) => a + (d?.kind === "percent" ? d.value : 0), 0);
  const lines = [
    { id: "l1", feeTypeId: "fee_admission", description: "Admission fee", amount: fs("fee_admission"), discount: 0 },
    { id: "l2", feeTypeId: "fee_deposit", description: "Refundable deposit", amount: fs("fee_deposit"), discount: 0 },
    { id: "l3", feeTypeId: "fee_tuition", description: `Tuition fee – ${period}`, amount: tuition, discount: Math.round((tuition * pct) / 100) },
  ];
  const total = lines.reduce((a, l) => a + l.amount - l.discount, 0);
  const due = new Date(ctx.now.getTime() + 14 * 86400000);
  db.invoices.insert({
    id: nextId(db, "inv"), number: `INV-${period.slice(0, 4)}-${String(nextNumber(db, "invoiceNo")).padStart(6, "0")}`,
    studentId: student.id, period, issueDate: today, dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`,
    lines, total, paid: 0, balance: total, status: "unpaid",
  });

  let inviteLink: string | undefined;
  if (input.inviteParent && guardian.email && !guardian.userId) {
    const res = inviteUser(ctx, { name: guardian.name, email: guardian.email, phone: guardian.phone, kind: "parent", roleIds: ["role_parent"], guardianId: guardian.id });
    guardian.userId = res.user.id;
    inviteLink = res.inviteLink;
  }
  audit(ctx, "student.create", "Student", `Enrolled ${fullName(student)} (${student.admissionNo}) in ${cls.name}`, student.id);
  return { student, inviteLink };
}

function visibleStudents(ctx: Ctx) {
  const s = requirePerm(ctx, "students.view");
  const db = ctx.db;
  if (hasFullScope(s, "students.view", db)) return db.students.rows;
  const classIds = new Set([...s.classIds, ...s.classSubjectIds.map((id) => db.classSubjects.get(id)?.classId)]);
  return db.students.rows.filter((st) => classIds.has(st.classId));
}

export function studentAttendance(db: DB, studentId: string, today: string): StudentAttendance {
  const student = db.students.get(studentId)!;
  const days: { date: string; status: AttendanceStatus }[] = [];
  for (const [key, day] of db.attendance) {
    const [classId, date] = key.split("|");
    if (classId !== student.classId || date > today) continue;
    days.push({ date, status: day.exceptions[studentId] ?? "present" });
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  const count = (st: AttendanceStatus) => days.filter((d) => d.status === st).length;
  const present = count("present");
  const late = count("late");
  return {
    rate: days.length ? Math.round(((present + late) / days.length) * 1000) / 10 : 100,
    present, absent: count("absent"), late, excused: count("excused"), days,
  };
}

export function studentResults(db: DB, studentId: string, releasedOnly: boolean): StudentResults {
  const student = db.students.get(studentId)!;
  const exams = db.exams.rows.filter((e) => e.yearId === db.school.currentYearId);
  return {
    exams: exams.map((exam) => {
      const released = reportStatus(db, exam.id, student.classId) === "released";
      if (!released && releasedOnly) return { exam, released };
      const res = classResults(db, exam.id, student.classId);
      const row = res.rows.find((r) => r.student.id === studentId);
      if (!row) return { exam, released };
      return {
        exam, released, average: row.average, rank: row.rank, classSize: res.classSize,
        subjects: row.subjects.map((x) => ({ name: db.subjects.get(x.subjectId)!.name, mark: x.mark, grade: gradeFor(x.mark, db.gradeBands) })),
      };
    }),
  };
}

export const studentRoutes: Route[] = [
  {
    method: "GET",
    path: "/students",
    handler: (ctx) => {
      const db = ctx.db;
      const { search, classId, gradeId, status = "active", sort } = ctx.query;
      let rows = visibleStudents(ctx).filter(
        (s) =>
          (status === "all" || s.status === status) &&
          (!classId || s.classId === classId) &&
          (!gradeId || s.gradeId === gradeId) &&
          matches(search, fullName(s), s.admissionNo, db.guardians.get(s.guardianIds[0])?.phone),
      );
      rows = [...rows].sort((a, b) => {
        const ga = db.grades.get(a.gradeId)!.number - db.grades.get(b.gradeId)!.number;
        return ga || className(db, a.classId).localeCompare(className(db, b.classId)) || fullName(a).localeCompare(fullName(b));
      });
      const items = rows.map((s) => toStudentListItem(db, s));
      return paginate(
        sortRows(items, sort, {
          name: (r) => r.fullName,
          admissionNo: (r) => r.admissionNo,
          class: (r) => r.className,
          balance: (r) => r.balance,
        }),
        ctx.query,
      );
    },
  },
  {
    method: "GET",
    path: "/students/:id",
    handler: (ctx): StudentDetail => {
      assertStudentAccess(ctx, ctx.params.id);
      const db = ctx.db;
      const s = db.students.get(ctx.params.id)!;
      const cls = db.classes.get(s.classId)!;
      const att = studentAttendance(db, s.id, todayISO(ctx));
      return {
        ...s,
        fullName: fullName(s),
        className: cls.name,
        gradeName: db.grades.get(s.gradeId)!.name,
        streamName: db.streams.get(cls.streamId)?.name,
        guardians: s.guardianIds.map((id) => db.guardians.get(id)!).filter(Boolean),
        subjects: studentClassSubjects(db, s).map((cs) => ({ id: cs.subjectId, name: db.subjects.get(cs.subjectId)!.name })),
        discounts: s.discountIds.map((id) => db.discounts.get(id)!).filter(Boolean),
        attendanceRate: att.rate,
        balance: studentBalance(db, s.id),
        history: db.enrollments.rows
          .filter((e) => e.studentId === s.id)
          .map((e) => ({ yearName: db.years.get(e.yearId)?.name ?? e.yearId.slice(5), className: className(db, e.classId) }))
          .sort((a, b) => b.yearName.localeCompare(a.yearName)),
        photoUrl: fileRef(db, s.photoFileId)?.url,
        documents: db.studentDocuments.rows
          .filter((d) => d.studentId === s.id)
          .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
          .map((d) => ({ id: d.id, kind: d.kind, uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy, file: fileRef(db, d.fileId)! })),
      };
    },
  },
  {
    method: "POST",
    path: "/students",
    handler: (ctx) => {
      requirePerm(ctx, "students.create");
      const { student, inviteLink } = createStudent(ctx, ctx.body);
      return { ...toStudentListItem(ctx.db, student), inviteLink };
    },
  },
  {
    method: "PUT",
    path: "/students/:id",
    handler: (ctx) => {
      requirePerm(ctx, "students.edit");
      const db = ctx.db;
      const s = db.students.get(ctx.params.id) ?? fail(404, "not_found", "Student not found.");
      validateStudent(db, { ...s, ...ctx.body, guardian: undefined });
      const { firstName, lastName, gender, dob, address, religion, medical, classId, electiveSubjectIds, discountIds } = ctx.body;
      const movedClass = classId !== s.classId;
      Object.assign(s, {
        firstName: firstName.trim(), lastName: lastName.trim(), gender, dob, address, religion, medical,
        electiveSubjectIds: electiveSubjectIds ?? s.electiveSubjectIds, discountIds: discountIds ?? s.discountIds,
      });
      if (movedClass) {
        const cls = db.classes.get(classId)!;
        s.classId = cls.id;
        s.gradeId = cls.gradeId;
        const enr = db.enrollments.rows.find((e) => e.studentId === s.id && e.yearId === cls.yearId);
        if (enr) enr.classId = cls.id;
      }
      audit(ctx, "student.update", "Student", `Updated ${fullName(s)}${movedClass ? ` (moved to ${className(db, classId)})` : ""}`, s.id);
      return toStudentListItem(db, s);
    },
  },
  {
    method: "POST",
    path: "/students/:id/status",
    handler: (ctx) => {
      requirePerm(ctx, "students.edit");
      const s = ctx.db.students.get(ctx.params.id) ?? fail(404, "not_found", "Student not found.");
      const { status, date, reason } = ctx.body ?? {};
      if (!["active", "left", "graduated", "expelled"].includes(status)) fail(422, "validation", "Invalid status.");
      if (status !== "active" && !date) fail(422, "validation", "Leaving date is required.", { date: "Required" });
      s.status = status;
      s.leftDate = status === "active" ? undefined : date;
      s.leftReason = status === "active" ? undefined : reason;
      audit(ctx, "student.status", "Student", `Marked ${fullName(s)} as ${status}`, s.id);
      return toStudentListItem(ctx.db, s);
    },
  },
  {
    method: "PUT",
    path: "/guardians/:id",
    handler: (ctx) => {
      requirePerm(ctx, "students.edit");
      const g = ctx.db.guardians.get(ctx.params.id) ?? fail(404, "not_found", "Guardian not found.");
      const { name, relationship, phone, email, nic, occupation, address } = ctx.body ?? {};
      if (!name?.trim() || !phone?.trim()) fail(422, "validation", "Name and phone are required.", { name: name ? "" : "Required", phone: phone ? "" : "Required" });
      Object.assign(g, { name, relationship, phone, email: email || undefined, nic, occupation, address });
      audit(ctx, "guardian.update", "Guardian", `Updated guardian ${g.name}`, g.id);
      return g;
    },
  },
  {
    method: "GET",
    path: "/students/:id/attendance",
    handler: (ctx) => {
      assertStudentAccess(ctx, ctx.params.id);
      return studentAttendance(ctx.db, ctx.params.id, todayISO(ctx));
    },
  },
  {
    method: "GET",
    path: "/students/:id/results",
    handler: (ctx) => {
      assertStudentAccess(ctx, ctx.params.id);
      return studentResults(ctx.db, ctx.params.id, ctx.session!.kind === "parent");
    },
  },
  {
    method: "GET",
    path: "/students/:id/invoices",
    handler: (ctx) => {
      assertStudentAccess(ctx, ctx.params.id);
      const s = requireAuth(ctx);
      if (s.kind === "staff" && !s.permissions.includes("fees.view")) fail(403, "forbidden", "You don't have access to fees.");
      const today = todayISO(ctx);
      return ctx.db.invoices.rows
        .filter((i: Invoice) => i.studentId === ctx.params.id && i.status !== "void")
        .map((i) => toInvoiceListItem(ctx.db, i, today))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    },
  },
  {
    method: "GET",
    path: "/students/:id/payments",
    handler: (ctx) => {
      assertStudentAccess(ctx, ctx.params.id);
      const s = requireAuth(ctx);
      if (s.kind === "staff" && !s.permissions.includes("payments.view")) fail(403, "forbidden", "You don't have access to payments.");
      return ctx.db.payments.rows
        .filter((p) => p.studentId === ctx.params.id)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    },
  },
];

export { canSeeStudent };
