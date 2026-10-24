import { api, API_MODE } from "@/lib/api/client";
import type { FileRef } from "@/lib/api/types";

export type UploadPurpose = "application-document" | "student-photo" | "student-document";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Client-side check before uploading; the API validates again. */
export function checkFile(file: File, purpose: UploadPurpose): "badType" | "tooLarge" | null {
  const allowed = purpose === "student-photo" ? IMAGE_TYPES : DOCUMENT_TYPES;
  if (!allowed.includes(file.type)) return "badType";
  if (file.size > MAX_UPLOAD_BYTES) return "tooLarge";
  return null;
}

/** Shrinks an image to a JPEG data URL (demo mode keeps previews in browser storage). */
async function downscale(file: File, maxSide: number, quality = 0.75) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // JPEG has no alpha; without a fill, transparent areas turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Uploads a file and returns its reference. The real API stores it in object storage and
 * returns a signed URL; demo mode keeps a small image preview and metadata only for PDFs.
 */
export async function uploadFile(file: File, purpose: UploadPurpose): Promise<FileRef> {
  if (API_MODE === "http") {
    const form = new FormData();
    form.append("file", file);
    form.append("purpose", purpose);
    return api.upload<FileRef>("/uploads", form);
  }
  const dataUrl = IMAGE_TYPES.includes(file.type) ? await downscale(file, purpose === "student-photo" ? 320 : 900) : undefined;
  return api.post<FileRef>("/uploads", { name: file.name, size: file.size, mimeType: file.type, purpose, dataUrl });
}
