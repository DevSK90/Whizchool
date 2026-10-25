import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { Guardian } from "@whizchool/shared/types";
import { audit } from "../audit";
import { config } from "../config";
import { prisma } from "../db";
import { sendEmail } from "../email/mailer";
import { inviteEmail, inviteLinkPath } from "../email/templates";
import type { FilePurpose } from "../generated/prisma/client";
import { omitNulls } from "../http/list";
import { checkRateLimit, limits } from "../http/rate-limit";
import { defineRoute } from "../http/route";
import { schoolName } from "../school";
import { ensureParentAccount, findMatchingGuardian } from "../services/students";
import { newStorageKey, store, toFileRef, verifyFileSignature } from "../storage";
import { PURPOSES, prepareUpload, readUpload, type UploadPurpose } from "../uploads";
import { editableStudent, guardianBody } from "./students";

/**
 * A file can be attached once, by the purpose it was uploaded for. Applicants' uploads aren't tied
 * to an account, so this stops anyone from attaching a file uploaded for someone else.
 */
async function attachableFile(fileId: string, purposes: FilePurpose[]) {
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    include: { _count: { select: { studentPhotos: true, studentDocuments: true, applicationDocuments: true } } },
  });
  if (!file || !purposes.includes(file.purpose)) throw new ApiError(422, "validation", "Upload the file first.", { fileId: "Upload the file first" });
  const uses = file._count.studentPhotos + file._count.studentDocuments + file._count.applicationDocuments;
  if (uses > 0) throw new ApiError(409, "in_use", "That file is already attached elsewhere.");
  return file;
}

/** Deletes a file's bytes and record once nothing points at it. */
async function deleteIfUnused(fileId: string) {
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    include: { _count: { select: { studentPhotos: true, studentDocuments: true, applicationDocuments: true } } },
  });
  if (!file || file._count.studentPhotos + file._count.studentDocuments + file._count.applicationDocuments > 0) return;
  await prisma.fileObject.delete({ where: { id: file.id } });
  await store.remove(file.key).catch(() => undefined);
}

const DOCUMENT_KINDS = ["birth_certificate", "photo", "report", "medical", "other"] as const;

export const fileRoutes = [
  defineRoute({
    method: "POST",
    path: "/uploads",
    access: "public",
    bodyType: "multipart",
    summary: "Upload one file (multipart: file, purpose). Applicants may upload application documents without an account",
    handler: async ({ req, res, auth }) => {
      const file = await readUpload(req, res);
      const purpose = String(req.body?.purpose ?? "") as UploadPurpose;
      if (!(purpose in PURPOSES)) throw new ApiError(422, "validation", "Unknown upload purpose.", { purpose: "Unknown purpose" });
      if (purpose === "application-document") {
        if (!auth && config.RATE_LIMITS) for (const rule of limits.publicUpload) checkRateLimit(rule, req);
      } else {
        if (!auth) throw new ApiError(401, "unauthenticated", "Your session has expired. Please sign in again.");
        if (!auth.session.permissions.includes("students.edit")) throw new ApiError(403, "forbidden", "You don't have permission to do that.");
      }
      const prepared = await prepareUpload(file.buffer, file.originalname, purpose);
      const key = newStorageKey(prepared.mimeType);
      await store.put(key, prepared.data);
      const saved = await prisma.fileObject.create({
        data: { key, name: prepared.name, size: prepared.data.length, mimeType: prepared.mimeType, purpose: PURPOSES[purpose], uploadedBy: auth?.session.id ?? null },
      });
      return toFileRef(saved);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/files/:id",
    access: "public",
    summary: "Download a file through a signed, expiring link",
    query: z.object({ expires: z.coerce.number().int(), signature: z.string().max(100) }),
    handler: async ({ params, query, res }) => {
      if (!verifyFileSignature(params.id, query.expires, query.signature)) {
        throw new ApiError(403, "link_expired", "This file link has expired. Reload the page to get a new one.");
      }
      const file = await prisma.fileObject.findUnique({ where: { id: params.id } });
      if (!file) throw new ApiError(404, "not_found", "File not found.");
      const data = await store.get(file.key).catch(() => {
        throw new ApiError(404, "not_found", "File not found.");
      });
      res.set({
        "Content-Type": file.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": `private, max-age=${Math.max(0, query.expires - Math.floor(Date.now() / 1000))}`,
        // Uploaded content must never run as part of our site.
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      res.end(data);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/students/:id/photo",
    access: { permission: "students.edit" },
    summary: "Set (fileId) or remove (null) a student's photo",
    body: z.object({ fileId: z.string().max(100).nullable() }),
    handler: async ({ auth, params, body }) => {
      const s = await editableStudent(auth, params.id);
      const file = body.fileId ? await attachableFile(body.fileId, ["student_photo"]) : null;
      await prisma.$transaction(async (tx) => {
        await tx.student.update({ where: { id: s.id }, data: { photoFileId: file?.id ?? null } });
        await audit(tx, auth, { action: "student.photo", entity: "Student", entityId: s.id, summary: `${file ? "Updated" : "Removed"} photo for ${s.firstName} ${s.lastName}` });
      });
      if (s.photoFileId && s.photoFileId !== file?.id) await deleteIfUnused(s.photoFileId);
      return { photoUrl: file ? toFileRef(file).url : undefined };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/students/:id/documents",
    access: { permission: "students.edit" },
    summary: "Attach an uploaded document to a student",
    body: z.object({ fileId: z.string().max(100), kind: z.enum(DOCUMENT_KINDS, { error: "Choose a document type" }) }),
    handler: async ({ auth, params, body }) => {
      const s = await editableStudent(auth, params.id);
      const file = await attachableFile(body.fileId, ["student_document"]);
      const doc = await prisma.$transaction(async (tx) => {
        const doc = await tx.studentDocument.create({
          data: { studentId: s.id, fileId: file.id, kind: body.kind, uploadedById: auth.session.id, uploadedBy: auth.session.name },
        });
        await audit(tx, auth, { action: "student.document", entity: "Student", entityId: s.id, summary: `Added ${body.kind.replace("_", " ")} for ${s.firstName} ${s.lastName}` });
        return doc;
      });
      return { id: doc.id, kind: doc.kind, uploadedAt: doc.uploadedAt.toISOString(), uploadedBy: doc.uploadedBy, file: toFileRef(file) };
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/students/:id/documents/:docId",
    access: { permission: "students.edit" },
    summary: "Remove a document from a student (the file is deleted)",
    handler: async ({ auth, params }) => {
      const s = await editableStudent(auth, params.id);
      const doc = await prisma.studentDocument.findUnique({ where: { id: params.docId } });
      if (!doc || doc.studentId !== s.id) throw new ApiError(404, "not_found", "Document not found.");
      await prisma.$transaction(async (tx) => {
        await tx.studentDocument.delete({ where: { id: doc.id } });
        await audit(tx, auth, { action: "student.document.remove", entity: "Student", entityId: s.id, summary: `Removed a ${doc.kind.replace("_", " ")} document from ${s.firstName} ${s.lastName}` });
      });
      await deleteIfUnused(doc.fileId);
      return { ok: true };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/students/:id/guardians",
    access: { permission: "students.edit" },
    summary: "Add a guardian, or link the existing guardian with the same email/phone (siblings)",
    body: guardianBody.extend({ inviteParent: z.boolean().optional() }),
    handler: async ({ auth, params, body }) => {
      const s = await editableStudent(auth, params.id);
      const { inviteParent, ...fields } = body;
      const result = await prisma.$transaction(async (tx) => {
        const existing = await findMatchingGuardian(tx, fields);
        if (existing && (await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId: s.id, guardianId: existing.id } } }))) {
          throw new ApiError(409, "duplicate", "This guardian is already linked to the student.");
        }
        const guardian = existing ?? (await tx.guardian.create({ data: fields }));
        const position = await tx.studentGuardian.count({ where: { studentId: s.id } });
        await tx.studentGuardian.create({ data: { studentId: s.id, guardianId: guardian.id, position, isPrimary: position === 0 } });
        const invite = inviteParent ? await ensureParentAccount(tx, guardian) : null;
        await audit(tx, auth, {
          action: "guardian.link",
          entity: "Student",
          entityId: s.id,
          summary: `${existing ? "Linked existing" : "Added"} guardian ${guardian.name} to ${s.firstName} ${s.lastName}`,
        });
        return { guardian: await tx.guardian.findUniqueOrThrow({ where: { id: guardian.id } }), linked: !!existing, invite };
      });
      let inviteLink: string | undefined;
      if (result.invite) {
        await sendEmail(inviteEmail({ ...result.invite.user, kind: "parent" }, await schoolName(), result.invite.token));
        if (config.EXPOSE_DEV_LINKS) inviteLink = inviteLinkPath(result.invite.token);
      }
      return { guardian: omitNulls(result.guardian) as Guardian, linked: result.linked, ...(inviteLink ? { inviteLink } : {}) };
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/students/:id/guardians/:guardianId",
    access: { permission: "students.edit" },
    summary: "Unlink a guardian from a student (a student always keeps at least one)",
    handler: async ({ auth, params }) => {
      const s = await editableStudent(auth, params.id);
      const links = await prisma.studentGuardian.findMany({ where: { studentId: s.id }, orderBy: { position: "asc" }, include: { guardian: true } });
      const link = links.find((l) => l.guardianId === params.guardianId);
      if (!link) throw new ApiError(404, "not_found", "Guardian not linked to this student.");
      if (links.length <= 1) throw new ApiError(409, "last_guardian", "A student must have at least one guardian.");
      await prisma.$transaction(async (tx) => {
        await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId: s.id, guardianId: link.guardianId } } });
        // Keep a primary contact: the next guardian in order takes over.
        const rest = links.filter((l) => l.guardianId !== link.guardianId);
        for (const [position, l] of rest.entries()) {
          await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId: s.id, guardianId: l.guardianId } }, data: { position, isPrimary: position === 0 } });
        }
        await audit(tx, auth, { action: "guardian.unlink", entity: "Student", entityId: s.id, summary: `Removed guardian ${link.guardian.name} from ${s.firstName} ${s.lastName}` });
      });
      return { ok: true };
    },
  }),
];
