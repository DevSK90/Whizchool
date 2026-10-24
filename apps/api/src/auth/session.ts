import type { Request, RequestHandler, Response } from "express";
import { SESSION_COOKIE } from "@whizchool/shared/api";
import type { UserKind } from "@whizchool/shared/types";
import { config } from "../config";
import { prisma, type Db } from "../db";
import { loadAuthContext } from "./context";
import { randomToken, sha256 } from "./crypto";

/** Idle timeouts: a session expires after this long without a request (PLAN.md assumption 5). */
export const SESSION_IDLE_MS: Record<UserKind, number> = {
  staff: 12 * 60 * 60 * 1000,
  parent: 7 * 24 * 60 * 60 * 1000,
};
/** Extending a session costs a write, so only do it when the last extension is this old. */
const SLIDE_AFTER_MS = 5 * 60 * 1000;

function setSessionCookie(res: Response, token: string, maxAge: number) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: "lax", path: "/", maxAge });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: "lax", path: "/" });
}

export function readSessionToken(req: Request): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim()) || null;
  }
  return null;
}

/** Starts a session for the user and sets the cookie. Replaces the session the request came in with, if any. */
export async function startSession(db: Db, req: Request, res: Response, user: { id: string; kind: UserKind }) {
  const token = randomToken();
  const now = new Date();
  const idle = SESSION_IDLE_MS[user.kind];
  const previous = readSessionToken(req);
  await db.$transaction([
    // Rotating on sign-in prevents session fixation; expired rows for this user are tidied up too.
    db.session.deleteMany({
      where: { OR: [{ userId: user.id, expiresAt: { lt: now } }, ...(previous ? [{ tokenHash: sha256(previous) }] : [])] },
    }),
    db.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        expiresAt: new Date(now.getTime() + idle),
        ip: req.ip ?? null,
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
      },
    }),
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
  ]);
  setSessionCookie(res, token, idle);
}

export async function endSession(db: Db, req: Request, res: Response) {
  const token = readSessionToken(req);
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  clearSessionCookie(res);
}

/**
 * Resolves the session cookie into `res.locals.auth`. Unknown, expired or deactivated sessions are
 * treated as signed out; routes that need a session then answer 401 and the web app sends the user to sign-in.
 */
export const sessionMiddleware: RequestHandler = async (req, res, next) => {
  const token = readSessionToken(req);
  if (!token) return next();
  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, lastSeenAt: true, user: { select: { kind: true } } },
  });
  const now = Date.now();
  if (!row || row.expiresAt.getTime() <= now) {
    if (row) await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    clearSessionCookie(res);
    return next();
  }
  const auth = await loadAuthContext(prisma, row.userId, row.id);
  if (!auth) {
    await prisma.session.deleteMany({ where: { userId: row.userId } });
    clearSessionCookie(res);
    return next();
  }
  if (now - row.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    const idle = SESSION_IDLE_MS[row.user.kind];
    await prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + idle) } });
    setSessionCookie(res, token, idle);
  }
  res.locals.auth = auth;
  next();
};
