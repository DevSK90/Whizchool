import type { Route } from "../router";
import { applicantMessage, canTextPhone, matchesApplicantContact, noticeForMove, type ApplicantNotice, type ApplicantNoticeDetails } from "@whizchool/shared/admissions";
import { normalizeLocalPhone } from "@whizchool/shared/phone";
import type { Application, ApplicationInput, ApplicationListItem, ApplicationStage } from "@whizchool/shared/types";
import { audit, fail, fileRef, isoNow, matches, paginate, requirePerm, sortRows, todayISO, type Ctx } from "../helpers";
import { nextId, nextNumber, type DB } from "../db";
import { createStudent } from "./students";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(db: DB, input: ApplicationInput, emailRequired = true) {
  const f: Record<string, string> = {};
  if (!db.grades.get(input?.applyingGradeId)) f.applyingGradeId = "Choose a grade";
  const s = input?.student;
  if (!s?.firstName?.trim()) f["student.firstName"] = "Required";
  if (!s?.lastName?.trim()) f["student.lastName"] = "Required";
  if (!s?.dob) f["student.dob"] = "Required";
  if (!s?.address?.trim()) f["student.address"] = "Required";
  const g = input?.guardian;
  if (!g?.name?.trim()) f["guardian.name"] = "Required";
  if (!normalizeLocalPhone(g?.phone ?? "")) f["guardian.phone"] = "Enter a Sri Lankan number, e.g. 077 123 4567";
  if (g?.email ? !EMAIL.test(g.email) : emailRequired) f["guardian.email"] = "Enter a valid email";
  if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
}

function toListItem(db: DB, a: Application): ApplicationListItem {
  return {
    id: a.id, refNo: a.refNo, studentName: `${a.student.firstName} ${a.student.lastName}`,
    gradeName: db.grades.get(a.applyingGradeId)?.name ?? "—", guardianName: a.guardian.name,
    guardianPhone: a.guardian.phone, stage: a.stage, submittedAt: a.submittedAt, interviewAt: a.interviewAt, enrollmentDate: a.enrollmentDate,
  };
}

const TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  new: ["interview", "accepted", "rejected", "withdrawn"],
  interview: ["interview", "accepted", "rejected", "withdrawn"],
  accepted: ["accepted", "withdrawn"],
  rejected: [],
  enrolled: [],
  withdrawn: [],
};

function transition(ctx: Ctx, a: Application, to: ApplicationStage, note?: string) {
  if (!TRANSITIONS[a.stage].includes(to)) fail(409, "invalid_transition", `Cannot move an application from ${a.stage} to ${to}.`);
  a.stage = to;
  a.timeline.push({ stage: to, at: isoNow(ctx), by: ctx.session!.name, note: note || undefined });
}

/** Logs a message to the parent on each channel they can receive. Delivery is simulated in the demo. */
function notify(ctx: Ctx, a: Application, notice: ApplicantNotice, details: Partial<ApplicantNoticeDetails>, channels: ("sms" | "email")[] = ["sms", "email"]) {
  const db = ctx.db;
  const studentName = `${a.student.firstName} ${a.student.lastName}`;
  const { subject, body } = applicantMessage(notice, { schoolName: db.school.name, refNo: a.refNo, studentName, ...details });
  const send = (channel: "sms" | "email") =>
    db.messages.insert({
      id: nextId(db, "msg"), channel, kind: "system", audience: { type: "applicant", ids: [a.id], label: `Parent of ${studentName} (${a.refNo})` },
      subject: channel === "email" ? subject : undefined, body,
      recipients: 1, delivered: 1, failed: 0, status: "sent", createdAt: isoNow(ctx), createdBy: ctx.session?.name ?? "Online form",
    });
  let sent = 0;
  if (channels.includes("sms") && canTextPhone(a.guardian.phone)) (send("sms"), sent++);
  if (channels.includes("email") && a.guardian.email) (send("email"), sent++);
  return sent;
}

function newApplication(ctx: Ctx, input: ApplicationInput, by: string, note?: string): Application {
  const a: Application = {
    ...input,
    guardian: { ...input.guardian, phone: normalizeLocalPhone(input.guardian.phone)!, email: input.guardian.email || undefined },
    documents: input.documents ?? [],
    id: nextId(ctx.db, "app"),
    refNo: `APP-${ctx.now.getFullYear()}-${String(nextNumber(ctx.db, "appNo", 326)).padStart(4, "0")}`,
    stage: "new",
    submittedAt: isoNow(ctx),
    timeline: [{ stage: "new", at: isoNow(ctx), by, note }],
  };
  return ctx.db.applications.insert(a);
}

const withFileLinks = (db: DB, a: Application) => ({ ...a, gradeName: db.grades.get(a.applyingGradeId)?.name, documents: a.documents.map((d) => ({ ...d, url: fileRef(db, d.fileId)?.url })) });

export const admissionRoutes: Route[] = [
  {
    method: "POST",
    path: "/applications",
    public: true,
    handler: (ctx) => {
      const input = ctx.body as ApplicationInput;
      validate(ctx.db, input);
      const a = newApplication(ctx, input, "Online form");
      notify(ctx, a, "received", { statusUrl: "/apply/status?ref=" + a.refNo }, ["sms"]);
      return { refNo: a.refNo, email: a.guardian.email };
    },
  },
  {
    method: "POST",
    path: "/applications/walk-in",
    handler: (ctx) => {
      const session = requirePerm(ctx, "admissions.create");
      const input = ctx.body as ApplicationInput;
      validate(ctx.db, input, false);
      const a = newApplication(ctx, input, session.name, "Entered at the school office");
      const sent = notify(ctx, a, "received", { statusUrl: "/apply/status?ref=" + a.refNo });
      audit(ctx, "application.walk_in", "Application", `Entered ${a.refNo} at the office`, a.id);
      return { id: a.id, refNo: a.refNo, phone: a.guardian.phone, email: a.guardian.email, notified: sent > 0 };
    },
  },
  {
    method: "GET",
    path: "/applications/status",
    public: true,
    handler: (ctx) => {
      const ref = (ctx.query.refNo ?? "").trim().toUpperCase();
      const a = ctx.db.applications.rows.find((x) => x.refNo === ref && matchesApplicantContact(ctx.query.contact ?? "", x.guardian));
      if (!a) fail(404, "not_found", "We couldn't find an application with that reference number and contact details.");
      return {
        refNo: a!.refNo, studentName: `${a!.student.firstName} ${a!.student.lastName}`,
        gradeName: ctx.db.grades.get(a!.applyingGradeId)?.name, stage: a!.stage, submittedAt: a!.submittedAt,
        interviewAt: a!.interviewAt, enrollmentDate: a!.enrollmentDate, timeline: a!.timeline.map(({ stage, at }) => ({ stage, at })),
      };
    },
  },
  {
    method: "GET",
    path: "/applications/counts",
    handler: (ctx) => {
      requirePerm(ctx, "admissions.view");
      const counts: Record<string, number> = { all: ctx.db.applications.size };
      for (const a of ctx.db.applications.rows) counts[a.stage] = (counts[a.stage] ?? 0) + 1;
      return counts;
    },
  },
  {
    method: "GET",
    path: "/applications",
    handler: (ctx) => {
      requirePerm(ctx, "admissions.view");
      const { stage, search, gradeId, sort = "-submittedAt" } = ctx.query;
      const rows = ctx.db.applications.rows
        .filter((a) => (!stage || stage === "all" || a.stage === stage) && (!gradeId || a.applyingGradeId === gradeId))
        .filter((a) => matches(search, a.refNo, a.student.firstName + " " + a.student.lastName, a.guardian.name, a.guardian.phone))
        .map((a) => toListItem(ctx.db, a));
      return paginate(
        sortRows(rows, sort, {
          submittedAt: (r) => r.submittedAt,
          name: (r) => r.studentName,
          grade: (r) => r.gradeName,
          interviewAt: (r) => r.interviewAt ?? "",
        }),
        ctx.query,
      );
    },
  },
  {
    method: "GET",
    path: "/applications/:id",
    handler: (ctx) => {
      requirePerm(ctx, "admissions.view");
      const a = ctx.db.applications.get(ctx.params.id) ?? fail(404, "not_found", "Application not found.");
      return withFileLinks(ctx.db, a);
    },
  },
  {
    method: "POST",
    path: "/applications/:id/transition",
    handler: (ctx) => {
      const { to, note, interviewAt, enrollmentDate } = ctx.body ?? {};
      requirePerm(ctx, to === "accepted" || to === "rejected" ? "admissions.approve" : "admissions.edit");
      const a = ctx.db.applications.get(ctx.params.id) ?? fail(404, "not_found", "Application not found.");
      if (!TRANSITIONS[a.stage].includes(to)) fail(409, "invalid_transition", `Cannot move an application from ${a.stage} to ${to}.`);
      if (to === "interview") {
        if (!interviewAt) fail(422, "validation", "Choose an interview date and time.", { interviewAt: "Required" });
        a.interviewAt = interviewAt;
      }
      if (to === "accepted") {
        if (!enrollmentDate) fail(422, "validation", "Choose the enrolment date.", { enrollmentDate: "Required" });
        if (enrollmentDate < todayISO(ctx)) fail(422, "validation", "The enrolment date can't be in the past.", { enrollmentDate: "Can't be in the past" });
        a.enrollmentDate = enrollmentDate;
      }
      const notice = noticeForMove(a.stage, to);
      transition(ctx, a, to, note || (to === "accepted" ? `Enrolment date ${enrollmentDate}` : undefined));
      audit(ctx, `application.${to}`, "Application", `Moved ${a.refNo} to ${to}`, a.id);
      if (notice) notify(ctx, a, notice, { interviewAt: a.interviewAt, enrollmentDate: a.enrollmentDate });
      return withFileLinks(ctx.db, a);
    },
  },
  {
    method: "POST",
    path: "/applications/:id/documents",
    handler: (ctx) => {
      requirePerm(ctx, "admissions.edit");
      const a = ctx.db.applications.get(ctx.params.id) ?? fail(404, "not_found", "Application not found.");
      if (!["new", "interview", "accepted"].includes(a.stage)) fail(409, "invalid_transition", "This application is closed.");
      if (a.documents.length >= 6) fail(422, "validation", "An application can hold 6 documents.");
      const { name, size, kind, fileId } = ctx.body ?? {};
      const attached = ctx.db.applications.rows.some((x) => x.documents.some((d) => d.fileId === fileId)) || ctx.db.studentDocuments.rows.some((d) => d.fileId === fileId);
      if (!fileId || !ctx.db.files.get(fileId) || attached) fail(422, "validation", "One of the documents couldn't be found. Please upload it again.");
      a.documents.push({ name, size, kind, fileId });
      audit(ctx, "application.document", "Application", `Added ${name} to ${a.refNo}`, a.id);
      return withFileLinks(ctx.db, a);
    },
  },
  {
    method: "POST",
    path: "/applications/:id/enroll",
    handler: (ctx) => {
      requirePerm(ctx, "admissions.approve");
      const db = ctx.db;
      const a = db.applications.get(ctx.params.id) ?? fail(404, "not_found", "Application not found.");
      if (a.stage !== "accepted") fail(409, "invalid_transition", "Only accepted applications can be enrolled.");
      if (a.enrollmentDate && todayISO(ctx) < a.enrollmentDate) {
        fail(409, "too_early", `${a.student.firstName} ${a.student.lastName} can be enrolled from ${a.enrollmentDate}. Change the enrolment date if they've come early.`);
      }
      const cls = db.classes.get(ctx.body?.classId);
      if (!cls || cls.gradeId !== a.applyingGradeId) fail(422, "validation", "Choose a class in the applied grade.", { classId: "Required" });
      const { student, inviteLink } = createStudent(ctx, {
        firstName: a.student.firstName, lastName: a.student.lastName, gender: a.student.gender, dob: a.student.dob,
        classId: cls!.id, address: a.student.address, religion: a.student.religion,
        medical: a.student.medicalNotes ? { conditions: a.student.medicalNotes } : undefined,
        electiveSubjectIds: ctx.body?.electiveSubjectIds,
        guardian: { name: a.guardian.name, relationship: a.guardian.relationship, phone: a.guardian.phone, email: a.guardian.email, nic: a.guardian.nic, occupation: a.guardian.occupation, address: a.student.address },
        inviteParent: ctx.body?.inviteParent !== false,
      });
      a.stage = "enrolled";
      a.enrolledStudentId = student.id;
      for (const d of a.documents) {
        if (!d.fileId || !db.files.get(d.fileId)) continue;
        db.studentDocuments.insert({
          id: nextId(db, "sdoc"), studentId: student.id, fileId: d.fileId, kind: d.kind, uploadedAt: a.submittedAt, uploadedBy: a.guardian.name,
        });
      }
      // A photo sent with the application is the student's first profile photo (a PDF isn't usable as one).
      const photo = a.documents.find((d) => d.kind === "photo" && d.fileId && db.files.get(d.fileId)?.mimeType.startsWith("image/"));
      if (photo) student.photoFileId = photo.fileId;
      a.timeline.push({ stage: "enrolled", at: isoNow(ctx), by: ctx.session!.name, note: `Enrolled in ${cls!.name} (admission no. ${student.admissionNo})` });
      notify(ctx, a, "enrolled", { admissionNo: student.admissionNo, className: cls!.name });
      return { studentId: student.id, admissionNo: student.admissionNo, inviteLink };
    },
  },
];
