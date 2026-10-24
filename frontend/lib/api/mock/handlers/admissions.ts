import type { Route } from "../router";
import type { Application, ApplicationInput, ApplicationListItem, ApplicationStage } from "../../types";
import { audit, fail, isoNow, matches, paginate, requirePerm, sortRows, type Ctx } from "../helpers";
import { nextId, nextNumber, type DB } from "../db";
import { createStudent } from "./students";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^0\d{2}\s?\d{3}\s?\d{4}$/;

function validate(db: DB, input: ApplicationInput) {
  const f: Record<string, string> = {};
  if (!db.grades.get(input?.applyingGradeId)) f.applyingGradeId = "Choose a grade";
  const s = input?.student;
  if (!s?.firstName?.trim()) f["student.firstName"] = "Required";
  if (!s?.lastName?.trim()) f["student.lastName"] = "Required";
  if (!s?.dob) f["student.dob"] = "Required";
  if (!s?.address?.trim()) f["student.address"] = "Required";
  const g = input?.guardian;
  if (!g?.name?.trim()) f["guardian.name"] = "Required";
  if (!PHONE.test(g?.phone ?? "")) f["guardian.phone"] = "Enter a valid phone number, e.g. 077 123 4567";
  if (!EMAIL.test(g?.email ?? "")) f["guardian.email"] = "Enter a valid email";
  if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
}

function toListItem(db: DB, a: Application): ApplicationListItem {
  return {
    id: a.id, refNo: a.refNo, studentName: `${a.student.firstName} ${a.student.lastName}`,
    gradeName: db.grades.get(a.applyingGradeId)?.name ?? "—", guardianName: a.guardian.name,
    guardianPhone: a.guardian.phone, stage: a.stage, submittedAt: a.submittedAt, interviewAt: a.interviewAt,
  };
}

const TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  new: ["interview", "accepted", "rejected", "withdrawn"],
  interview: ["accepted", "rejected", "withdrawn"],
  accepted: ["withdrawn"],
  rejected: [],
  enrolled: [],
  withdrawn: [],
};

function transition(ctx: Ctx, a: Application, to: ApplicationStage, note?: string) {
  if (!TRANSITIONS[a.stage].includes(to)) fail(409, "invalid_transition", `Cannot move an application from ${a.stage} to ${to}.`);
  a.stage = to;
  a.timeline.push({ stage: to, at: isoNow(ctx), by: ctx.session!.name, note: note || undefined });
}

export const admissionRoutes: Route[] = [
  {
    method: "POST",
    path: "/applications",
    public: true,
    handler: (ctx) => {
      const input = ctx.body as ApplicationInput;
      validate(ctx.db, input);
      const a: Application = {
        ...input,
        id: nextId(ctx.db, "app"),
        refNo: `APP-${ctx.now.getFullYear()}-${String(nextNumber(ctx.db, "appNo", 326)).padStart(4, "0")}`,
        stage: "new",
        submittedAt: isoNow(ctx),
        timeline: [{ stage: "new", at: isoNow(ctx), by: "Online form" }],
      };
      ctx.db.applications.insert(a);
      return { refNo: a.refNo, email: a.guardian.email };
    },
  },
  {
    method: "GET",
    path: "/applications/status",
    public: true,
    handler: (ctx) => {
      const ref = (ctx.query.refNo ?? "").trim().toUpperCase();
      const email = (ctx.query.email ?? "").trim().toLowerCase();
      const a = ctx.db.applications.rows.find((x) => x.refNo === ref && x.guardian.email.toLowerCase() === email);
      if (!a) fail(404, "not_found", "We couldn't find an application with that reference number and email.");
      return {
        refNo: a!.refNo, studentName: `${a!.student.firstName} ${a!.student.lastName}`,
        gradeName: ctx.db.grades.get(a!.applyingGradeId)?.name, stage: a!.stage, submittedAt: a!.submittedAt,
        interviewAt: a!.interviewAt, timeline: a!.timeline.map(({ stage, at }) => ({ stage, at })),
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
      return { ...a, gradeName: ctx.db.grades.get(a.applyingGradeId)?.name };
    },
  },
  {
    method: "POST",
    path: "/applications/:id/transition",
    handler: (ctx) => {
      const { to, note, interviewAt } = ctx.body ?? {};
      requirePerm(ctx, to === "accepted" || to === "rejected" ? "admissions.approve" : "admissions.edit");
      const a = ctx.db.applications.get(ctx.params.id) ?? fail(404, "not_found", "Application not found.");
      if (to === "interview") {
        if (!interviewAt) fail(422, "validation", "Choose an interview date and time.", { interviewAt: "Required" });
        a.interviewAt = interviewAt;
      }
      transition(ctx, a, to, note);
      audit(ctx, `application.${to}`, "Application", `Moved ${a.refNo} to ${to}`, a.id);
      return a;
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
      const cls = db.classes.get(ctx.body?.classId);
      if (!cls || cls.gradeId !== a.applyingGradeId) fail(422, "validation", "Choose a class in the applied grade.", { classId: "Required" });
      const { student, inviteLink } = createStudent(ctx, {
        firstName: a.student.firstName, lastName: a.student.lastName, gender: a.student.gender, dob: a.student.dob,
        classId: cls!.id, address: a.student.address, religion: a.student.religion,
        medical: a.student.medicalNotes ? { conditions: a.student.medicalNotes } : undefined,
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
      a.timeline.push({ stage: "enrolled", at: isoNow(ctx), by: ctx.session!.name, note: `Enrolled in ${cls!.name} (admission no. ${student.admissionNo})` });
      return { studentId: student.id, admissionNo: student.admissionNo, inviteLink };
    },
  },
];
