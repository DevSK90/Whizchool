// The deterministic demo school (the same data the in-browser demo API serves), loaded into Postgres.
// Used by `npm run db:seed` and by the test-only reset route; never runs in production.
import { createHash } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { createSeed } from "@whizchool/demo/seed";
import type { Db } from "../db";
import { snapshotClass } from "../services/results";

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const at = (iso: string) => new Date(iso);
const opt = <T, R>(v: T | undefined | null, f: (v: T) => R) => (v === undefined || v === null ? null : f(v));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** createMany in chunks, keeping each statement well under Postgres' bind-parameter limit. */
async function insert<T>(model: { createMany(args: { data: T[] }): Promise<unknown> }, rows: T[], size = 2000) {
  for (let i = 0; i < rows.length; i += size) await model.createMany({ data: rows.slice(i, i + size) });
}

async function wipe(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

/** Wipes every table and loads the demo school. Returns a one-line summary. */
export async function seedDemoSchool(db: Db) {
  const started = Date.now();
  const demo = createSeed();
  await wipe(db);

  // ── Reference data ──
  await insert(db.grade, demo.grades.rows);
  await insert(db.stream, demo.streams.rows);
  await insert(
    db.academicYear,
    demo.years.rows.map((y) => ({ ...y, startDate: day(y.startDate), endDate: day(y.endDate) })),
  );
  await insert(
    db.term,
    demo.terms.rows.map((t) => ({ ...t, startDate: day(t.startDate), endDate: day(t.endDate) })),
  );
  await insert(
    db.subject,
    demo.subjects.rows.map(({ streamIds: _, basket, ...s }) => ({ ...s, basket: basket ?? null })),
  );
  await insert(
    db.subjectStream,
    demo.subjects.rows.flatMap((s) => (s.streamIds ?? []).map((streamId) => ({ subjectId: s.id, streamId }))),
  );
  await insert(db.gradeBand, demo.gradeBands);
  await insert(db.role, demo.roles.rows.map(({ userCount: _, ...r }) => r));
  await insert(db.feeType, demo.feeTypes.rows.map((f) => ({ ...f, description: f.description ?? null })));
  await insert(
    db.discount,
    demo.discounts.rows.map((d) => ({ ...d, feeTypeId: d.feeTypeId ?? null, description: d.description ?? null })),
  );

  // ── People ──
  // Every demo account uses the same password, so hash it once.
  const sharedHash = await hash("demo1234");
  await insert(
    db.user,
    demo.users.rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email.toLowerCase(),
      phone: u.phone ?? null,
      kind: u.kind,
      status: u.status,
      passwordHash: u.status === "invited" ? null : u.password === "demo1234" ? sharedHash : null,
      invitedAt: opt(u.invitedAt, at),
      lastLoginAt: opt(u.lastLoginAt, at),
    })),
  );
  // Users whose password differs from the shared one (none today) get their own hash.
  for (const u of demo.users.rows.filter((u) => u.status !== "invited" && u.password !== "demo1234")) {
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hash(u.password) } });
  }
  await insert(db.userRole, demo.users.rows.flatMap((u) => u.roleIds.map((roleId) => ({ userId: u.id, roleId }))));
  await insert(db.staff, demo.staff.rows.map((s) => ({ ...s, userId: s.userId ?? null })));
  await insert(
    db.guardian,
    demo.guardians.rows.map((g) => ({
      ...g,
      email: g.email ?? null,
      nic: g.nic ?? null,
      occupation: g.occupation ?? null,
      address: g.address ?? null,
      userId: g.userId ?? null,
    })),
  );

  // ── School structure ──
  const { currentYearId, logoUrl: _logo, ...school } = demo.school;
  await db.school.create({ data: { ...school, website: school.website ?? null, currentYearId } });
  await insert(
    db.classSection,
    demo.classes.rows.map((c) => ({ ...c, streamId: c.streamId ?? null, classTeacherId: c.classTeacherId ?? null, room: c.room ?? null })),
  );
  await insert(db.classSubject, demo.classSubjects.rows.map((cs) => ({ ...cs, teacherId: cs.teacherId ?? null })));

  // ── Students ──
  await insert(
    db.student,
    demo.students.rows.map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      firstName: s.firstName,
      lastName: s.lastName,
      nameWithInitials: s.nameWithInitials,
      gender: s.gender,
      dob: day(s.dob),
      classId: s.classId,
      gradeId: s.gradeId,
      status: s.status,
      joinedDate: day(s.joinedDate),
      leftDate: opt(s.leftDate, day),
      leftReason: s.leftReason ?? null,
      address: s.address,
      religion: s.religion ?? null,
      bloodGroup: s.medical?.bloodGroup ?? null,
      allergies: s.medical?.allergies ?? null,
      conditions: s.medical?.conditions ?? null,
    })),
  );
  await insert(
    db.studentGuardian,
    demo.students.rows.flatMap((s) => s.guardianIds.map((guardianId, position) => ({ studentId: s.id, guardianId, position, isPrimary: position === 0 }))),
  );
  await insert(
    db.studentSubject,
    demo.students.rows.flatMap((s) => s.electiveSubjectIds.map((subjectId) => ({ studentId: s.id, subjectId }))),
  );
  await insert(
    db.studentDiscount,
    demo.students.rows.flatMap((s) => s.discountIds.map((discountId) => ({ studentId: s.id, discountId }))),
  );
  await insert(db.enrollment, demo.enrollments.rows);

  // ── Admissions ──
  await insert(
    db.application,
    demo.applications.rows.map((a) => ({
      id: a.id,
      refNo: a.refNo,
      stage: a.stage,
      applyingGradeId: a.applyingGradeId,
      student: a.student,
      guardian: a.guardian,
      studentName: `${a.student.firstName} ${a.student.lastName}`,
      guardianEmail: a.guardian.email.toLowerCase(),
      guardianPhone: a.guardian.phone,
      submittedAt: at(a.submittedAt),
      interviewAt: opt(a.interviewAt, at),
      enrolledStudentId: a.enrolledStudentId ?? null,
    })),
  );
  await insert(
    db.applicationDocument,
    demo.applications.rows.flatMap((a) => a.documents.map((d) => ({ applicationId: a.id, kind: d.kind, name: d.name, size: d.size, fileId: null }))),
  );
  await insert(
    db.applicationEvent,
    demo.applications.rows.flatMap((a) => a.timeline.map((e) => ({ applicationId: a.id, stage: e.stage, at: at(e.at), by: e.by, note: e.note ?? null }))),
  );

  // ── Attendance: the demo stores only exceptions; the database keeps one row per student per day ──
  const roster = new Map<string, typeof demo.students.rows>();
  for (const s of demo.students.rows) {
    if (s.status !== "active") continue;
    roster.set(s.classId, [...(roster.get(s.classId) ?? []), s]);
  }
  const attendanceDays: { id: string; classId: string; date: Date; markedBy: string; markedAt: Date }[] = [];
  const attendanceRecords: { dayId: string; studentId: string; date: Date; status: "present" | "absent" | "late" | "excused" }[] = [];
  for (const [key, register] of demo.attendance) {
    const [classId, date] = key.split("|");
    const id = `att_${classId}_${date}`;
    attendanceDays.push({ id, classId, date: day(date), markedBy: register.markedBy, markedAt: at(register.markedAt) });
    for (const s of roster.get(classId) ?? []) {
      attendanceRecords.push({ dayId: id, studentId: s.id, date: day(date), status: register.exceptions[s.id] ?? "present" });
    }
  }
  await insert(db.attendanceDay, attendanceDays);
  await insert(db.attendanceRecord, attendanceRecords, 5000);

  // ── Exams and results ──
  await insert(
    db.exam,
    demo.exams.rows.map(({ termName: _, ...e }) => ({ ...e, startDate: day(e.startDate), endDate: day(e.endDate) })),
  );
  await insert(
    db.mark,
    [...demo.marks].map(([key, value]) => {
      const [examId, studentId, subjectId] = key.split("|");
      return { examId, studentId, subjectId, value: value === "AB" ? null : value, absent: value === "AB" };
    }),
    5000,
  );
  const examEnd = new Map(demo.exams.rows.map((e) => [e.id, day(e.endDate)]));
  const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  await insert(
    db.markSheet,
    [...demo.submittedSheets].map((key) => {
      const [examId, classId, subjectId] = key.split("|");
      return { examId, classId, subjectId, submittedAt: plusDays(examEnd.get(examId)!, 7) };
    }),
  );
  await insert(
    db.classReport,
    [...demo.reportStatus].map(([key, status]) => {
      const [examId, classId] = key.split("|");
      const approvedAt = plusDays(examEnd.get(examId)!, 14);
      return { examId, classId, status, approvedAt, releasedAt: status === "released" ? plusDays(approvedAt, 3) : null };
    }),
  );
  await insert(
    db.reportCard,
    [...demo.remarks].map(([key, r]) => {
      const [examId, studentId] = key.split("|");
      return { examId, studentId, classTeacherRemark: r.classTeacher ?? null, principalRemark: r.principal ?? null };
    }),
  );
  // Approved and released report cards carry their frozen results, as approval would have left them.
  for (const key of demo.reportStatus.keys()) {
    const [examId, classId] = key.split("|");
    await snapshotClass(db, examId!, classId!);
  }

  // ── Fees ──
  await insert(db.feeStructure, demo.feeStructures.rows);
  await insert(
    db.invoice,
    demo.invoices.rows.map((i) => ({
      id: i.id,
      number: i.number,
      studentId: i.studentId,
      period: i.period ?? null,
      monthlyKey: i.period ? `${i.studentId}|${i.period}` : null,
      issueDate: day(i.issueDate),
      dueDate: day(i.dueDate),
      total: i.total,
      paid: i.paid,
      status: i.status,
    })),
  );
  await insert(
    db.invoiceLine,
    demo.invoices.rows.flatMap((i) => i.lines.map(({ id: _, ...l }) => ({ ...l, invoiceId: i.id }))),
    5000,
  );
  await insert(
    db.payment,
    demo.payments.rows.map(({ allocations: _, ...p }) => ({ ...p, reference: p.reference ?? null, paidAt: at(p.paidAt) })),
  );
  await insert(
    db.paymentAllocation,
    demo.payments.rows.flatMap((p) => p.allocations.map((a) => ({ paymentId: p.id, invoiceId: a.invoiceId, amount: a.amount }))),
    5000,
  );

  // ── Communication and platform ──
  await insert(
    db.message,
    demo.messages.rows.map((m) => ({
      id: m.id,
      channel: m.channel,
      kind: m.kind,
      audienceType: m.audience.type,
      audienceIds: m.audience.ids ?? [],
      audienceLabel: m.audience.label,
      subject: m.subject ?? null,
      body: m.body,
      status: m.status,
      recipients: m.recipients,
      delivered: m.delivered,
      failed: m.failed,
      createdAt: at(m.createdAt),
      createdBy: m.createdBy,
    })),
  );
  await insert(db.notice, demo.notices.rows.map((n) => ({ ...n, publishedAt: at(n.publishedAt) })));
  await insert(
    db.auditLog,
    demo.audit.rows.map((a) => ({ ...a, at: at(a.at), entityId: a.entityId ?? null })),
  );
  await insert(
    db.counter,
    Object.entries(demo.counters).map(([key, value]) => ({ key, value })),
  );
  // Demo invite/reset links (e.g. /invite/demo-invite-token) keep working; only hashes are stored.
  await insert(
    db.authToken,
    [...demo.tokens].map(([token, t]) => ({ tokenHash: sha256(token), userId: t.userId, kind: t.kind, expiresAt: plusDays(new Date(), 365) })),
  );

  return (
    `Seeded ${demo.students.size} students, ${demo.users.size} users, ${attendanceRecords.length} attendance records, ` +
      `${demo.marks.size} marks, ${demo.invoices.size} invoices, ${demo.payments.size} payments in ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
}
