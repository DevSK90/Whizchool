import { z } from "zod";
import { applicantMessage, canTextPhone, matchesApplicantContact, noticeForMove, type ApplicantNotice, type ApplicantNoticeDetails } from "@whizchool/shared/admissions";
import { ApiError } from "@whizchool/shared/api";
import { normalizeLocalPhone } from "@whizchool/shared/phone";
import type { Application, ApplicationInput, ApplicationListItem, ApplicationStage, ApplicationStatusView } from "@whizchool/shared/types";
import { audit } from "../audit";
import { config } from "../config";
import { nextNumber } from "../counters";
import { fromIsoDate, isoDate, schoolToday, toIsoDate } from "../dates";
import { prisma } from "../db";
import { sendEmail } from "../email/mailer";
import { applicationReceivedEmail, inviteEmail, inviteLinkPath } from "../email/templates";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, page, parseSort, skipTake } from "../http/list";
import { limits } from "../http/rate-limit";
import { defineRoute } from "../http/route";
import { enqueue } from "../jobs";
import { currentYearId, schoolName } from "../school";
import { createMessage } from "../services/messages";
import { createStudent } from "../services/students";
import { toFileRef } from "../storage";
import { emailField, phoneField } from "./students";

const STAGES = ["new", "interview", "accepted", "rejected", "enrolled", "withdrawn"] as const;

/** Which stages an application may move to next; enrolment has its own route. */
const TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  new: ["interview", "accepted", "rejected", "withdrawn"],
  // Staying put reschedules the interview or changes the enrolment date.
  interview: ["interview", "accepted", "rejected", "withdrawn"],
  accepted: ["accepted", "withdrawn"],
  rejected: [],
  enrolled: [],
  withdrawn: [],
};

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const documentBody = z.object({
  name: text(120),
  size: z.number().int().min(0),
  kind: z.enum(["birth_certificate", "report", "photo", "other"]),
  fileId: z.string().max(100).optional(),
});

const applicationBody = z.object({
  applyingGradeId: z.string().min(1, "Choose a grade").max(100),
  student: z.object({
    firstName: text(80).min(1, "Required"),
    lastName: text(80).min(1, "Required"),
    gender: z.enum(["M", "F"], { error: "Required" }),
    dob: isoDate("Enter a valid date of birth"),
    religion: optionalText(40),
    address: text(300).min(1, "Required"),
    previousSchool: optionalText(120),
    medicalNotes: optionalText(500),
  }),
  guardian: z.object({
    name: text(120).min(1, "Required"),
    relationship: z.enum(["Father", "Mother", "Guardian"], { error: "Required" }),
    phone: phoneField,
    email: emailField.refine((e) => !!e, "Enter a valid email"),
    nic: optionalText(20),
    occupation: optionalText(80),
  }),
  documents: z.array(documentBody).max(6).default([]),
});

/** The office's form: a parent at the school may have no email yet, and bring documents later. */
const walkInBody = applicationBody.extend({
  guardian: applicationBody.shape.guardian.extend({ email: emailField }),
});

const appInclude = {
  applyingGrade: { select: { name: true } },
  documents: { include: { file: true } },
  events: { orderBy: { at: "asc" } },
} satisfies Prisma.ApplicationInclude;

type AppRow = Prisma.ApplicationGetPayload<{ include: typeof appInclude }>;

function toApplication(a: AppRow): Application & { gradeName: string } {
  return {
    id: a.id,
    refNo: a.refNo,
    stage: a.stage,
    applyingGradeId: a.applyingGradeId,
    gradeName: a.applyingGrade.name,
    student: a.student as ApplicationInput["student"],
    guardian: a.guardian as ApplicationInput["guardian"],
    documents: a.documents.map((d) => ({
      name: d.name,
      size: d.size,
      kind: d.kind as ApplicationInput["documents"][number]["kind"],
      ...(d.fileId ? { fileId: d.fileId } : {}),
      ...(d.file ? { url: toFileRef(d.file).url } : {}),
    })),
    submittedAt: a.submittedAt.toISOString(),
    ...(a.interviewAt ? { interviewAt: a.interviewAt.toISOString() } : {}),
    ...(a.enrollmentDate ? { enrollmentDate: toIsoDate(a.enrollmentDate) } : {}),
    ...(a.enrolledStudentId ? { enrolledStudentId: a.enrolledStudentId } : {}),
    timeline: a.events.map((e) => ({ stage: e.stage, at: e.at.toISOString(), by: e.by, ...(e.note ? { note: e.note } : {}) })),
  };
}

export const toApplicationListItem = (a: Prisma.ApplicationGetPayload<{ include: { applyingGrade: { select: { name: true } } } }>): ApplicationListItem => ({
  id: a.id,
  refNo: a.refNo,
  studentName: a.studentName,
  gradeName: a.applyingGrade.name,
  guardianName: (a.guardian as { name: string }).name,
  guardianPhone: a.guardianPhone,
  stage: a.stage,
  submittedAt: a.submittedAt.toISOString(),
  ...(a.interviewAt ? { interviewAt: a.interviewAt.toISOString() } : {}),
  ...(a.enrollmentDate ? { enrollmentDate: toIsoDate(a.enrollmentDate) } : {}),
});

async function loadApplication(id: string) {
  const a = await prisma.application.findUnique({ where: { id }, include: appInclude });
  if (!a) throw new ApiError(404, "not_found", "Application not found.");
  return a;
}

/** "APP-2026-0326": numbered per year, continuing after the highest reference already issued. */
async function nextRefNo(tx: Prisma.TransactionClient, year: string) {
  const key = `applicationNo:${year}`;
  let start = 1;
  if (!(await tx.counter.findUnique({ where: { key } }))) {
    const last = await tx.application.findFirst({ where: { refNo: { startsWith: `APP-${year}-` } }, orderBy: { refNo: "desc" }, select: { refNo: true } });
    start = (last ? Number(last.refNo.slice(-4)) : 0) + 1;
  }
  return `APP-${year}-${String(await nextNumber(tx, key, start)).padStart(4, "0")}`;
}

/** Documents must be fresh uploads: application documents nobody has attached yet. */
async function checkDocuments(documents: { fileId?: string }[]) {
  const fileIds = documents.flatMap((d) => (d.fileId ? [d.fileId] : []));
  if (new Set(fileIds).size !== fileIds.length) throw new ApiError(422, "validation", "Each document must be a separate file.");
  if (!fileIds.length) return;
  const usable = await prisma.fileObject.count({
    where: { id: { in: fileIds }, purpose: "application_document", applicationDocuments: { none: {} }, studentDocuments: { none: {} } },
  });
  if (usable !== fileIds.length) throw new ApiError(422, "validation", "One of the documents couldn't be found. Please upload it again.");
}

type Contact = { id: string; refNo: string; studentName: string; guardian: unknown };

/**
 * Records a message to the parent on each channel they can receive. Call inside the transaction
 * that moves the application, and queue the returned ids once it commits.
 */
async function queueNotice(tx: Prisma.TransactionClient, a: Contact, notice: ApplicantNotice, details: Partial<ApplicantNoticeDetails>, by: { id?: string; name: string }, channels: ("sms" | "email")[] = ["sms", "email"]) {
  const guardian = a.guardian as { phone: string; email?: string | null };
  const school = await tx.school.findUniqueOrThrow({ where: { id: "school" }, select: { name: true } });
  const { subject, body } = applicantMessage(notice, { schoolName: school.name, refNo: a.refNo, studentName: a.studentName, ...details });
  const ids: string[] = [];
  const send = async (channel: "sms" | "email", to: string) => {
    const message = await createMessage(tx, {
      channel,
      kind: "system",
      audience: { type: "applicant", ids: [a.id], label: `Parent of ${a.studentName} (${a.refNo})` },
      subject: channel === "email" ? subject : null,
      body,
      createdById: by.id ?? null,
      createdBy: by.name,
      relatesTo: `application:${a.id}`,
      recipients: [{ to }],
    });
    ids.push(message.id);
  };
  if (channels.includes("sms") && canTextPhone(guardian.phone)) await send("sms", guardian.phone);
  if (channels.includes("email") && guardian.email) await send("email", guardian.email);
  return ids;
}

const deliverAll = async (messageIds: string[]) => {
  for (const messageId of messageIds) await enqueue("messages.deliver", { messageId });
};

/** Saves a new application and records the parent's first message; the online form's email goes separately, with its button. */
async function saveApplication(
  body: { applyingGradeId: string; student: ApplicationInput["student"]; guardian: Omit<ApplicationInput["guardian"], "email"> & { email?: string | null }; documents: { name: string; size: number; kind: string; fileId?: string }[] },
  today: string,
  sender: { id?: string; name: string },
  enteredBy: string,
  note?: string,
  channels: ("sms" | "email")[] = ["sms"],
) {
  const studentName = `${body.student.firstName} ${body.student.lastName}`;
  const guardian = { ...body.guardian, email: body.guardian.email || undefined };
  return prisma.$transaction(async (tx) => {
    const refNo = await nextRefNo(tx, today.slice(0, 4));
    const app = await tx.application.create({
      data: {
        refNo,
        applyingGradeId: body.applyingGradeId,
        student: body.student,
        guardian,
        studentName,
        guardianEmail: guardian.email ?? null,
        guardianPhone: body.guardian.phone,
        documents: { create: body.documents.map((d) => ({ name: d.name, size: d.size, kind: d.kind, fileId: d.fileId ?? null })) },
        events: { create: [{ stage: "new", by: enteredBy, note: note ?? null }] },
      },
    });
    return { app, messages: await queueNotice(tx, app, "received", { statusUrl: statusUrl(refNo) }, sender, channels) };
  });
}

const statusUrl = (refNo: string) => `${config.APP_URL}/apply/status?ref=${encodeURIComponent(refNo)}`;

export const admissionRoutes = [
  defineRoute({
    method: "POST",
    path: "/applications",
    access: "public",
    summary: "Submit an application (public form); emails the reference number",
    rateLimit: limits.apply,
    idempotent: true,
    body: applicationBody,
    handler: async ({ body }) => {
      const today = schoolToday();
      if (body.student.dob >= today) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { "student.dob": "Enter a valid date of birth" });
      const grade = await prisma.grade.findUnique({ where: { id: body.applyingGradeId } });
      if (!grade) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { applyingGradeId: "Choose a grade" });
      await checkDocuments(body.documents);
      const { app, messages } = await saveApplication(body, today, { name: "Online form" }, "Online form");
      // Through the queue, with retries: it carries no secrets, and a mail outage must not lose it.
      const email = applicationReceivedEmail({ name: body.guardian.name, email: body.guardian.email! }, await schoolName(), { refNo: app.refNo, studentName: app.studentName, gradeName: grade.name });
      await enqueue("email.send", { ...email });
      await deliverAll(messages);
      return { refNo: app.refNo, email: body.guardian.email! };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/applications/walk-in",
    access: { permission: "admissions.create" },
    summary: "Enter an application for a parent at the school: email and documents optional",
    idempotent: true,
    body: walkInBody,
    handler: async ({ auth, body }) => {
      const today = schoolToday();
      if (body.student.dob >= today) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { "student.dob": "Enter a valid date of birth" });
      const grade = await prisma.grade.findUnique({ where: { id: body.applyingGradeId }, select: { id: true, name: true } });
      if (!grade) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { applyingGradeId: "Choose a grade" });
      await checkDocuments(body.documents);
      const { app, messages } = await saveApplication(body, today, { id: auth.session.id, name: auth.session.name }, auth.session.name, "Entered at the school office", ["sms", "email"]);
      await audit(prisma, auth, { action: "application.walk_in", entity: "Application", entityId: app.id, summary: `Entered ${app.refNo} for ${app.studentName} at the office` });
      await deliverAll(messages);
      return { id: app.id, refNo: app.refNo, phone: body.guardian.phone, ...(body.guardian.email ? { email: body.guardian.email } : {}), notified: messages.length > 0 };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/applications/status",
    access: "public",
    summary: "Track an application by reference number and the guardian's email or phone number",
    rateLimit: limits.statusLookup,
    query: z.object({ refNo: z.string().trim().max(20).default(""), contact: z.string().trim().max(254).default("") }),
    handler: async ({ query }): Promise<ApplicationStatusView> => {
      const a = await prisma.application.findUnique({ where: { refNo: query.refNo.toUpperCase() }, include: appInclude });
      // The same answer for a wrong reference and wrong contact details.
      if (!a || !matchesApplicantContact(query.contact, { email: a.guardianEmail, phone: a.guardianPhone })) {
        throw new ApiError(404, "not_found", "We couldn't find an application with that reference number and contact details.");
      }
      return {
        refNo: a.refNo,
        studentName: a.studentName,
        gradeName: a.applyingGrade.name,
        stage: a.stage,
        submittedAt: a.submittedAt.toISOString(),
        ...(a.interviewAt ? { interviewAt: a.interviewAt.toISOString() } : {}),
        ...(a.enrollmentDate ? { enrollmentDate: toIsoDate(a.enrollmentDate) } : {}),
        timeline: a.events.map((e) => ({ stage: e.stage, at: e.at.toISOString() })),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/applications/counts",
    access: { permission: "admissions.view" },
    summary: "Number of applications per stage (sidebar badge, tabs)",
    handler: async () => {
      const groups = await prisma.application.groupBy({ by: ["stage"], _count: { _all: true } });
      const counts: Record<string, number> = { all: 0 };
      for (const g of groups) {
        counts[g.stage] = g._count._all;
        counts.all += g._count._all;
      }
      return counts;
    },
  }),
  defineRoute({
    method: "GET",
    path: "/applications",
    access: { permission: "admissions.view" },
    summary: "Applications by stage and grade, searchable",
    query: listQuery.extend({ stage: z.enum([...STAGES, "all"]).optional(), gradeId: z.string().max(100).optional() }),
    handler: async ({ query }) => {
      const where: Prisma.ApplicationWhereInput = {
        ...(query.stage && query.stage !== "all" ? { stage: query.stage } : {}),
        ...(query.gradeId ? { applyingGradeId: query.gradeId } : {}),
        ...(query.search
          ? {
              OR: [
                { refNo: { contains: query.search, mode: "insensitive" } },
                { studentName: { contains: query.search, mode: "insensitive" } },
                { guardian: { path: ["name"], string_contains: query.search, mode: "insensitive" } },
                { guardianPhone: { contains: query.search } },
              ],
            }
          : {}),
      };
      const { field, dir } = parseSort(query.sort ?? "-submittedAt", ["submittedAt", "name", "grade", "interviewAt"] as const, "submittedAt");
      const orderBy: Prisma.ApplicationOrderByWithRelationInput[] = [
        field === "name"
          ? { studentName: dir }
          : field === "grade"
            ? { applyingGrade: { number: dir } }
            : field === "interviewAt"
              ? { interviewAt: { sort: dir, nulls: "last" } }
              : { submittedAt: dir },
        { id: "asc" },
      ];
      const [rows, total] = await Promise.all([
        prisma.application.findMany({ where, orderBy, include: { applyingGrade: { select: { name: true } } }, ...skipTake(query) }),
        prisma.application.count({ where }),
      ]);
      return page(rows.map(toApplicationListItem), total, query);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/applications/:id",
    access: { permission: "admissions.view" },
    summary: "One application with documents and timeline",
    handler: async ({ params }) => toApplication(await loadApplication(params.id)),
  }),
  defineRoute({
    method: "POST",
    path: "/applications/:id/transition",
    access: { permission: "admissions.view" },
    summary: "Move an application along the pipeline (accept/reject need admissions.approve)",
    body: z.object({
      to: z.enum(STAGES, { error: "Choose a stage" }),
      note: z.string().trim().max(500).optional(),
      interviewAt: z.iso.datetime({ offset: true, error: "Choose an interview date and time" }).optional(),
      enrollmentDate: isoDate("Choose the enrolment date").optional(),
    }),
    handler: async ({ auth, params, body }) => {
      const needs = body.to === "accepted" || body.to === "rejected" ? "admissions.approve" : "admissions.edit";
      if (!auth.session.permissions.includes(needs)) throw new ApiError(403, "forbidden", "You don't have permission to do that.");
      const a = await loadApplication(params.id);
      if (!TRANSITIONS[a.stage].includes(body.to)) throw new ApiError(409, "invalid_transition", `Cannot move an application from ${a.stage} to ${body.to}.`);
      if (body.to === "interview" && !body.interviewAt) throw new ApiError(422, "validation", "Choose an interview date and time.", { interviewAt: "Required" });
      if (body.to === "accepted") {
        if (!body.enrollmentDate) throw new ApiError(422, "validation", "Choose the enrolment date.", { enrollmentDate: "Required" });
        if (body.enrollmentDate < schoolToday()) throw new ApiError(422, "validation", "The enrolment date can't be in the past.", { enrollmentDate: "Can't be in the past" });
      }
      const notice = noticeForMove(a.stage, body.to);
      const messages = await prisma.$transaction(async (tx) => {
        const updated = await tx.application.update({
          where: { id: a.id },
          data: {
            stage: body.to,
            ...(body.interviewAt ? { interviewAt: new Date(body.interviewAt) } : {}),
            ...(body.to === "accepted" ? { enrollmentDate: fromIsoDate(body.enrollmentDate!) } : {}),
          },
        });
        const note = body.note || (body.to === "accepted" ? `Enrolment date ${body.enrollmentDate}` : null);
        await tx.applicationEvent.create({ data: { applicationId: a.id, stage: body.to, by: auth.session.name, note } });
        await audit(tx, auth, { action: `application.${body.to}`, entity: "Application", entityId: a.id, summary: `Moved ${a.refNo} to ${body.to}` });
        if (!notice) return [];
        return queueNotice(tx, a, notice, { interviewAt: updated.interviewAt?.toISOString(), enrollmentDate: body.enrollmentDate }, { id: auth.session.id, name: auth.session.name });
      });
      await deliverAll(messages);
      return toApplication(await loadApplication(a.id));
    },
  }),
  defineRoute({
    method: "POST",
    path: "/applications/:id/documents",
    access: { permission: "admissions.edit" },
    summary: "Add a document a parent brought after applying",
    body: documentBody.extend({ fileId: z.string().min(1).max(100) }),
    handler: async ({ auth, params, body }) => {
      const a = await loadApplication(params.id);
      if (!["new", "interview", "accepted"].includes(a.stage)) throw new ApiError(409, "invalid_transition", "This application is closed.");
      if (a.documents.length >= 6) throw new ApiError(422, "validation", "An application can hold 6 documents.");
      await checkDocuments([body]);
      await prisma.$transaction(async (tx) => {
        await tx.applicationDocument.create({ data: { applicationId: a.id, name: body.name, size: body.size, kind: body.kind, fileId: body.fileId } });
        await audit(tx, auth, { action: "application.document", entity: "Application", entityId: a.id, summary: `Added ${body.name} to ${a.refNo}` });
      });
      return toApplication(await loadApplication(a.id));
    },
  }),
  defineRoute({
    method: "POST",
    path: "/applications/:id/enroll",
    access: { permission: "admissions.approve" },
    summary: "Enrol an accepted applicant: student, guardian, class, first invoice and their documents",
    idempotent: true,
    body: z.object({ classId: z.string().max(100), inviteParent: z.boolean().default(true), electiveSubjectIds: z.array(z.string().max(100)).max(20).optional() }),
    handler: async ({ auth, params, body }) => {
      const a = await loadApplication(params.id);
      if (a.stage !== "accepted") throw new ApiError(409, "invalid_transition", "Only accepted applications can be enrolled.");
      const today = schoolToday();
      if (a.enrollmentDate && today < toIsoDate(a.enrollmentDate)) {
        throw new ApiError(409, "too_early", `${a.studentName} can be enrolled from ${toIsoDate(a.enrollmentDate)}. Change the enrolment date if they've come early.`);
      }
      const cls = await prisma.classSection.findUnique({ where: { id: body.classId } });
      if (!cls || cls.gradeId !== a.applyingGradeId || cls.yearId !== (await currentYearId())) {
        throw new ApiError(422, "validation", "Choose a class in the applied grade.", { classId: "Choose a class" });
      }
      const s = a.student as ApplicationInput["student"];
      const g = a.guardian as ApplicationInput["guardian"];
      const result = await prisma.$transaction(
        async (tx) => {
          const created = await createStudent(
            tx,
            auth,
            {
              firstName: s.firstName,
              lastName: s.lastName,
              gender: s.gender,
              dob: s.dob,
              classId: cls.id,
              address: s.address,
              religion: s.religion,
              medical: s.medicalNotes ? { conditions: s.medicalNotes } : undefined,
              electiveSubjectIds: body.electiveSubjectIds,
              guardian: { name: g.name, relationship: g.relationship, phone: g.phone, email: g.email, nic: g.nic, occupation: g.occupation, address: s.address },
              inviteParent: body.inviteParent,
            },
            { firstInvoice: true, today },
          );
          // The applicant's uploads move onto the student's record.
          for (const d of a.documents) {
            if (!d.fileId) continue;
            await tx.studentDocument.create({
              data: { studentId: created.student.id, fileId: d.fileId, kind: d.kind as "birth_certificate", uploadedAt: a.submittedAt, uploadedBy: g.name },
            });
          }
          // A photo sent with the application is the student's first profile photo (a PDF isn't usable as one).
          const photo = a.documents.find((d) => d.kind === "photo" && d.file?.mimeType.startsWith("image/"));
          if (photo) await tx.student.update({ where: { id: created.student.id }, data: { photoFileId: photo.fileId } });
          await tx.application.update({ where: { id: a.id }, data: { stage: "enrolled", enrolledStudentId: created.student.id } });
          await tx.applicationEvent.create({
            data: { applicationId: a.id, stage: "enrolled", by: auth.session.name, note: `Enrolled in ${created.className} (admission no. ${created.student.admissionNo})` },
          });
          const messages = await queueNotice(tx, a, "enrolled", { admissionNo: created.student.admissionNo, className: created.className }, { id: auth.session.id, name: auth.session.name });
          return { ...created, messages };
        },
        { timeout: 20_000 },
      );
      await deliverAll(result.messages);
      let inviteLink: string | undefined;
      if (result.invite) {
        await sendEmail(inviteEmail({ ...result.invite.user, kind: "parent" }, await schoolName(), result.invite.token));
        if (config.EXPOSE_DEV_LINKS) inviteLink = inviteLinkPath(result.invite.token);
      }
      return { studentId: result.student.id, admissionNo: result.student.admissionNo, ...(inviteLink ? { inviteLink } : {}) };
    },
  }),
];
