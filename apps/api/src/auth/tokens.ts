import { ApiError } from "@whizchool/shared/api";
import type { Db } from "../db";
import type { AuthTokenKind } from "../generated/prisma/client";
import { randomToken, sha256 } from "./crypto";

export const TOKEN_TTL_MS: Record<AuthTokenKind, number> = {
  invite: 7 * 24 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
};

type Tx = Pick<Db, "authToken">;

/** Issues a single-use link token, revoking earlier unused ones of the same kind. Returns the raw token. */
export async function issueToken(tx: Tx, userId: string, kind: AuthTokenKind) {
  const token = randomToken();
  await tx.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
  await tx.authToken.create({
    data: { tokenHash: sha256(token), userId, kind, expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]) },
  });
  return token;
}

const INVALID: Record<AuthTokenKind, ApiError> = {
  invite: new ApiError(404, "invalid_token", "This invitation link is invalid or has already been used."),
  reset: new ApiError(400, "invalid_token", "This reset link is invalid or has expired."),
};

/** Finds a live (unused, unexpired) token of the given kind, with its user, or throws the contract's error. */
export async function findLiveToken(db: Pick<Db, "authToken">, token: string, kind: AuthTokenKind) {
  const row = await db.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt <= new Date()) throw INVALID[kind];
  return row;
}
