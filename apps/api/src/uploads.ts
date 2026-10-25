import type { Request, Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import multer from "multer";
import sharp from "sharp";
import { ApiError } from "@whizchool/shared/api";
import type { FilePurpose } from "./generated/prisma/client";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Upload purposes as the web app names them, and how each is stored. */
export const PURPOSES = {
  "application-document": "application_document",
  "student-photo": "student_photo",
  "student-document": "student_document",
} as const satisfies Record<string, FilePurpose>;

export type UploadPurpose = keyof typeof PURPOSES;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOCUMENT_TYPES = ["application/pdf", ...IMAGE_TYPES];

const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }).single("file");

/** Reads a multipart upload (field "file", plus text fields) into memory. */
export function readUpload(req: Request, res: Response): Promise<Express.Multer.File> {
  return new Promise((resolve, reject) => {
    parser(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return reject(
          err.code === "LIMIT_FILE_SIZE"
            ? new ApiError(413, "too_large", "Files must be 5 MB or smaller.")
            : new ApiError(422, "validation", "Send one file in the \"file\" field."),
        );
      }
      if (err) return reject(err);
      if (!req.file) return reject(new ApiError(422, "validation", "Choose a file to upload."));
      resolve(req.file);
    });
  });
}

/** Keeps a readable name without paths or control characters. */
export function cleanFileName(name: string, mimeType: string) {
  const base = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").trim().slice(0, 120) || "file";
  if (mimeType === "image/jpeg" && !/\.jpe?g$/i.test(base)) return `${base.replace(/\.[a-z0-9]{2,5}$/i, "")}.jpg`;
  return base;
}

/**
 * Checks what the file really is (from its bytes, not its name or declared type) and prepares it
 * for storage. Images are re-encoded as JPEG: this applies the camera's rotation, caps the size,
 * and drops EXIF data, so children's photos never keep GPS locations.
 */
export async function prepareUpload(data: Buffer, originalName: string, purpose: UploadPurpose) {
  const detected = await fileTypeFromBuffer(data);
  const allowed = purpose === "student-photo" ? IMAGE_TYPES : DOCUMENT_TYPES;
  const display = cleanFileName(originalName, detected?.mime ?? "");
  if (!detected || !allowed.includes(detected.mime)) {
    throw new ApiError(
      415,
      "unsupported_type",
      purpose === "student-photo" ? `${display} isn't a JPG, PNG or WebP image.` : `${display} isn't a PDF, JPG, PNG or WebP file.`,
    );
  }
  if (detected.mime === "application/pdf") return { data, mimeType: "application/pdf", name: display };
  const maxSide = purpose === "student-photo" ? 640 : 2000;
  try {
    const jpeg = await sharp(data, { failOn: "error" })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: purpose === "student-photo" ? 82 : 85, mozjpeg: true })
      .toBuffer();
    return { data: jpeg, mimeType: "image/jpeg", name: cleanFileName(originalName, "image/jpeg") };
  } catch {
    throw new ApiError(415, "unsupported_type", `${display} couldn't be read as an image.`);
  }
}
