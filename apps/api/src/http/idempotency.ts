import type { Request, Response } from "express";
import { ApiError } from "@whizchool/shared/api";
import { sha256 } from "../auth/crypto";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";

/** A stored response is replayed for this long; after that the key may be reused. */
const KEEP_MS = 24 * 60 * 60 * 1000;
const IN_PROGRESS = 0;

/**
 * Runs `work` at most once per Idempotency-Key. A retry with the same key and body gets the
 * stored response; the same key with a different body is refused. Without a key, `work` just runs.
 */
export async function idempotent(req: Request, res: Response, scope: string, body: unknown, work: () => Promise<unknown>) {
  const key = req.get("idempotency-key")?.trim();
  if (!key) return work();
  if (key.length > 100) throw new ApiError(422, "validation", "Idempotency-Key is too long.");
  const id = { key, userId: scope };
  const requestHash = sha256(`${req.method} ${req.baseUrl}${req.path} ${JSON.stringify(body ?? null)}`);

  const existing = await prisma.idempotencyKey.findUnique({ where: { key_userId: id } });
  if (existing && existing.createdAt.getTime() < Date.now() - KEEP_MS) {
    await prisma.idempotencyKey.delete({ where: { key_userId: id } });
  } else if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ApiError(422, "idempotency_mismatch", "This request key was already used for a different request.");
    }
    if (existing.status === IN_PROGRESS) throw new ApiError(409, "in_progress", "This request is still being processed. Try again in a moment.");
    res.status(existing.status);
    return existing.response ?? undefined;
  }

  try {
    await prisma.idempotencyKey.create({
      data: { ...id, method: req.method, path: `${req.baseUrl}${req.path}`, requestHash, status: IN_PROGRESS },
    });
  } catch (e) {
    // Two identical requests raced; the other one is doing the work.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "in_progress", "This request is still being processed. Try again in a moment.");
    }
    throw e;
  }
  try {
    const result = await work();
    await prisma.idempotencyKey.update({
      where: { key_userId: id },
      data: { status: res.statusCode || 200, response: (result ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
    return result;
  } catch (e) {
    // A failed attempt doesn't consume the key: the client may fix the problem and retry.
    await prisma.idempotencyKey.delete({ where: { key_userId: id } }).catch(() => undefined);
    throw e;
  }
}
