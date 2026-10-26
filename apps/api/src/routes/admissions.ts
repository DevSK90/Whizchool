import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { Application, ApplicationInput, ApplicationListItem, ApplicationStage, ApplicationStatusView } from "@whizchool/shared/types";
import { audit } from "../audit";
import { config } from "../config";
import { nextNumber } from "../counters";
import { isoDate, schoolToday } from "../dates";
import { prisma } from "../db";
import { sendEmail } from "../email/mailer";
import { applicationReceivedEmail, inviteEmail, inviteLinkPath } from "../email/templates";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, page, parseSort, skipTake } from "../http/list";
import { limits } from "../http/rate-limit";
import { defineRoute } from "../http/route";
import { enqueue } from "../jobs";
import { currentYearId, schoolName } from "../school";
import { createStudent } from "../services/students";
import { toFileRef } from "../storage";
import { emailField, phoneField } from "./students";

const STAGES = ["new", "interview", "accepted", "rejected", "enrolled", "withdrawn"] as const;

/** Which stages an application may move to next; enrolment has its own route. */
const TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  new: ["interview", "accepted", "rejected", "withdrawn"],
  interview: ["accepted", "rejected", "withdrawn"],
  accepted: ["withdrawn"],
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
  documents: z
    .array(
      z.object({
        name: text(120),
        size: z.number().int().min(0),
        kind: z.enum(["birth_certificate", "report", "photo", "other"]),
        fileId: z.string().max(100).optional(),
      }),
    )
    .max(6)
    .default([]),
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
    ...(a.enrolledStudentId ? { enrolledStudentId: a.enrolledStudentId } : {}),
    timeline: a.events.map((e) => ({ stage: e.stage, at: e.at.toISOString(), by: e.by, ...(e.note ? { note: e.note } : {}) })),
  };
}

const toListItem = (a: Prisma.ApplicationGetPayload<{ include: { applyingGrade: { select: { name: true } } } }>): ApplicationListItem => ({
  id: a.id,
  refNo: a.refNo,
  studentName: a.studentName,
  gradeName: a.applyingGrade.name,
  guardianName: (a.guardian as { name: string }).name,
  guardianPhone: a.guardianPhone,
  stage: a.stage,
  submittedAt: a.submittedAt.toISOString(),
  ...(a.interviewAt ? { interviewAt: a.interviewAt.toISOString() } : {}),
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
      // Documents must be the applicant's own fresh uploads: application documents nobody has attached yet.
      const fileIds = body.documents.flatMap((d) => (d.fileId ? [d.fileId] : []));
      if (new Set(fileIds).size !== fileIds.length) throw new ApiError(422, "validation", "Each document must be a separate file.");
      if (fileIds.length) {
        const usable = await prisma.fileObject.count({
          where: { id: { in: fileIds }, purpose: "application_document", applicationDocuments: { none: {} }, studentDocuments: { none: {} } },
        });
        if (usable !== fileIds.length) throw new ApiError(422, "validation", "One of the documents couldn't be found. Please upload it again.");
      }
      const studentName = `${body.student.firstName} ${body.student.lastName}`;
      const app = await prisma.$transaction(async (tx) => {
        const refNo = await nextRefNo(tx, today.slice(0, 4));
        return tx.application.create({
          data: {
            refNo,
            applyingGradeId: grade.id,
            student: body.student,
            guardian: { ...body.guardian, email: body.guardian.email! },
            studentName,
            guardianEmail: body.guardian.email!,
            guardianPhone: body.guardian.phone,
            documents: { create: body.documents.map((d) => ({ name: d.name, size: d.size, kind: d.kind, fileId: d.fileId ?? null })) },
            events: { create: [{ stage: "new", by: "Online form" }] },
          },
        });
      });
      // Through the queue, with retries: it carries no secrets, and a mail outage must not lose it.
      const email = applicationReceivedEmail({ name: body.guardian.name, email: body.guardian.email! }, await schoolName(), { refNo: app.refNo, studentName, gradeName: grade.name });
      await enqueue("email.send", { ...email });
      return { refNo: app.refNo, email: body.guardian.email! };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/applications/status",
    access: "public",
    summary: "Track an application by reference number and the guardian's email",
    rateLimit: limits.statusLookup,
    query: z.object({ refNo: z.string().trim().max(20).default(""), email: z.string().trim().max(254).default("") }),
    handler: async ({ query }): Promise<ApplicationStatusView> => {
      const a = await prisma.application.findFirst({
        where: { refNo: query.refNo.toUpperCase(), guardianEmail: query.email.toLowerCase() },
        include: appInclude,
      });
      // The same answer for a wrong reference and a wrong email.
      if (!a) throw new ApiError(404, "not_found", "We couldn't find an application with that reference number and email.");
      return {
        refNo: a.refNo,
        studentName: a.studentName,
        gradeName: a.applyingGrade.name,
        stage: a.stage,
        submittedAt: a.submittedAt.toISOString(),
        ...(a.interviewAt ? { interviewAt: a.interviewAt.toISOString() } : {}),
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
      return page(rows.map(toListItem), total, query);
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
    }),
    handler: async ({ auth, params, body }) => {
      const needs = body.to === "accepted" || body.to === "rejected" ? "admissions.approve" : "admissions.edit";
      if (!auth.session.permissions.includes(needs)) throw new ApiError(403, "forbidden", "You don't have permission to do that.");
      const a = await loadApplication(params.id);
      if (!TRANSITIONS[a.stage].includes(body.to)) throw new ApiError(409, "invalid_transition", `Cannot move an application from ${a.stage} to ${body.to}.`);
      if (body.to === "interview" && !body.interviewAt) throw new ApiError(422, "validation", "Choose an interview date and time.", { interviewAt: "Required" });
      await prisma.$transaction(async (tx) => {
        await tx.application.update({
          where: { id: a.id },
          data: { stage: body.to, ...(body.interviewAt ? { interviewAt: new Date(body.interviewAt) } : {}) },
        });
        await tx.applicationEvent.create({ data: { applicationId: a.id, stage: body.to, by: auth.session.name, note: body.note || null } });
        await audit(tx, auth, { action: `application.${body.to}`, entity: "Application", entityId: a.id, summary: `Moved ${a.refNo} to ${body.to}` });
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
    body: z.object({ classId: z.string().max(100), inviteParent: z.boolean().default(true) }),
    handler: async ({ auth, params, body }) => {
      const a = await loadApplication(params.id);
      if (a.stage !== "accepted") throw new ApiError(409, "invalid_transition", "Only accepted applications can be enrolled.");
      const cls = await prisma.classSection.findUnique({ where: { id: body.classId } });
      if (!cls || cls.gradeId !== a.applyingGradeId || cls.yearId !== (await currentYearId())) {
        throw new ApiError(422, "validation", "Choose a class in the applied grade.", { classId: "Choose a class" });
      }
      const s = a.student as ApplicationInput["student"];
      const g = a.guardian as ApplicationInput["guardian"];
      const today = schoolToday();
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
          await tx.application.update({ where: { id: a.id }, data: { stage: "enrolled", enrolledStudentId: created.student.id } });
          await tx.applicationEvent.create({
            data: { applicationId: a.id, stage: "enrolled", by: auth.session.name, note: `Enrolled in ${created.className} (admission no. ${created.student.admissionNo})` },
          });
          return created;
        },
        { timeout: 20_000 },
      );
      let inviteLink: string | undefined;
      if (result.invite) {
        await sendEmail(inviteEmail({ ...result.invite.user, kind: "parent" }, await schoolName(), result.invite.token));
        if (config.EXPOSE_DEV_LINKS) inviteLink = inviteLinkPath(result.invite.token);
      }
      return { studentId: result.student.id, admissionNo: result.student.admissionNo, ...(inviteLink ? { inviteLink } : {}) };
    },
  }),
];
