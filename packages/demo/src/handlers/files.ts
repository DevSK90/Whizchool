import type { Route } from "../router";
import type { DocumentKind, Guardian } from "@whizchool/shared/types";
import { audit, fail, fileRef, fullName, isoNow, requireAuth, requirePerm } from "../helpers";
import { nextId } from "../db";
import { findMatchingGuardian, inviteUser } from "./students";

const MAX_BYTES = 5 * 1024 * 1024;
const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PURPOSES = ["application-document", "student-photo", "student-document"] as const;
const KINDS: DocumentKind[] = ["birth_certificate", "photo", "report", "medical", "other"];
const PHONE = /^0\d{2}\s?\d{3}\s?\d{4}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const fileRoutes: Route[] = [
  {
    // Real API: multipart upload to object storage; returns a file reference with a signed URL.
    method: "POST",
    path: "/uploads",
    public: true,
    handler: (ctx) => {
      const { name, size, mimeType, purpose, dataUrl } = ctx.body ?? {};
      if (!PURPOSES.includes(purpose)) fail(422, "validation", "Unknown upload purpose.");
      // Applicants upload before they have an account; everything else needs a session.
      if (purpose !== "application-document") requireAuth(ctx);
      if (!name || !(size > 0)) fail(422, "validation", "Choose a file to upload.");
      if (size > MAX_BYTES) fail(413, "too_large", `${name} is larger than 5 MB.`);
      const allowed = purpose === "student-photo" ? IMAGE_TYPES : DOC_TYPES;
      if (!allowed.includes(mimeType)) fail(415, "unsupported_type", `${name} isn't an allowed file type.`);
      const file = ctx.db.files.insert({
        id: nextId(ctx.db, "file"),
        name: String(name).slice(0, 120),
        size,
        mimeType,
        purpose,
        dataUrl: typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? dataUrl : undefined,
        uploadedAt: isoNow(ctx),
      });
      return fileRef(ctx.db, file.id);
    },
  },
  {
    method: "PUT",
    path: "/students/:id/photo",
    handler: (ctx) => {
      requirePerm(ctx, "students.edit");
      const s = ctx.db.students.get(ctx.params.id) ?? fail(404, "not_found", "Student not found.");
      const fileId = ctx.body?.fileId as string | null;
      if (fileId) {
        const f = ctx.db.files.get(fileId) ?? fail(422, "validation", "Upload the photo first.");
        if (f.purpose !== "student-photo") fail(422, "validation", "That file isn't a photo upload.");
      }
      s.photoFileId = fileId || undefined;
      audit(ctx, "student.photo", "Student", `${fileId ? "Updated" : "Removed"} photo for ${fullName(s)}`, s.id);
      return { photoUrl: fileRef(ctx.db, s.photoFileId)?.url };
    },
  },
  {
    method: "POST",
    path: "/students/:id/documents",
    handler: (ctx) => {
      const session = requirePerm(ctx, "students.edit");
      const s = ctx.db.students.get(ctx.params.id) ?? fail(404, "not_found", "Student not found.");
      const { fileId, kind } = ctx.body ?? {};
      if (!ctx.db.files.get(fileId)) fail(422, "validation", "Upload the file first.");
      if (!KINDS.includes(kind)) fail(422, "validation", "Choose a document type.", { kind: "Required" });
      const doc = ctx.db.studentDocuments.insert({
        id: nextId(ctx.db, "sdoc"), studentId: s.id, fileId, kind, uploadedAt: isoNow(ctx), uploadedBy: session.name,
      });
      audit(ctx, "student.document", "Student", `Added ${kind.replace("_", " ")} for ${fullName(s)}`, s.id);
      return { ...doc, file: fileRef(ctx.db, fileId) };
    },
  },
  {
    method: "DELETE",
    path: "/students/:id/documents/:docId",
    handler: (ctx) => {
      requirePerm(ctx, "students.edit");
      const doc = ctx.db.studentDocuments.get(ctx.params.docId);
      if (!doc || doc.studentId !== ctx.params.id) fail(404, "not_found", "Document not found.");
      ctx.db.studentDocuments.remove(doc!.id);
      audit(ctx, "student.document.remove", "Student", `Removed a ${doc!.kind.replace("_", " ")} document`, ctx.params.id);
      return { ok: true };
    },
  },
  {
    // Adds a guardian; an existing guardian with the same email or phone is linked instead (siblings).
    method: "POST",
    path: "/students/:id/guardians",
    handler: (ctx) => {
      requirePerm(ctx, "students.edit");
      const db = ctx.db;
      const s = db.students.get(ctx.params.id) ?? fail(404, "not_found", "Student not found.");
      const { name, relationship, phone, email, nic, occupation, address, inviteParent } = ctx.body ?? {};
      const f: Record<string, string> = {};
      if (!name?.trim()) f.name = "Required";
      if (!PHONE.test(phone ?? "")) f.phone = "Enter a valid phone number, e.g. 077 123 4567";
      if (email && !EMAIL.test(email)) f.email = "Enter a valid email";
      if (!["Father", "Mother", "Guardian"].includes(relationship)) f.relationship = "Required";
      if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
      let g: Guardian | undefined = findMatchingGuardian(db, { name, email, phone });
      const linked = !!g;
      if (g && s.guardianIds.includes(g.id)) fail(409, "duplicate", "This guardian is already linked to the student.");
      g ??= db.guardians.insert({
        id: nextId(db, "gdn"), name: name.trim(), relationship, phone, email: email || undefined, nic, occupation, address,
      });
      s.guardianIds.push(g.id);
      let inviteLink: string | undefined;
      if (inviteParent && g.email && !g.userId) {
        const res = inviteUser(ctx, { name: g.name, email: g.email, phone: g.phone, kind: "parent", roleIds: ["role_parent"], guardianId: g.id });
        g.userId = res.user.id;
        inviteLink = res.inviteLink;
      }
      audit(ctx, "guardian.link", "Student", `${linked ? "Linked existing" : "Added"} guardian ${g.name} to ${fullName(s)}`, s.id);
      return { guardian: g, linked, inviteLink };
    },
  },
  {
    method: "DELETE",
    path: "/students/:id/guardians/:guardianId",
    handler: (ctx) => {
      requirePerm(ctx, "students.edit");
      const s = ctx.db.students.get(ctx.params.id) ?? fail(404, "not_found", "Student not found.");
      if (!s.guardianIds.includes(ctx.params.guardianId)) fail(404, "not_found", "Guardian not linked to this student.");
      if (s.guardianIds.length <= 1) fail(409, "last_guardian", "A student must have at least one guardian.");
      s.guardianIds = s.guardianIds.filter((id) => id !== ctx.params.guardianId);
      audit(ctx, "guardian.unlink", "Student", `Removed guardian ${ctx.db.guardians.get(ctx.params.guardianId)?.name} from ${fullName(s)}`, s.id);
      return { ok: true };
    },
  },
];
