import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { audit } from "../audit";
import { loadAuthContext } from "../auth/context";
import { hashPassword, passwordSchema, verifyPassword } from "../auth/password";
import { endSession, startSession } from "../auth/session";
import { findLiveToken, issueToken } from "../auth/tokens";
import { config } from "../config";
import { prisma } from "../db";
import { sendEmail } from "../email/mailer";
import { resetEmail, resetLinkPath } from "../email/templates";
import { limits } from "../http/rate-limit";
import { defineRoute } from "../http/route";
import { schoolName } from "../school";

const email = z.string().trim().toLowerCase().max(254);

async function sessionFor(userId: string) {
  const auth = await loadAuthContext(prisma, userId, null);
  if (!auth) throw new ApiError(403, "deactivated", "This account has been deactivated. Contact the school office.");
  return auth.session;
}

export const authRoutes = [
  defineRoute({
    method: "POST",
    path: "/auth/login",
    access: "public",
    summary: "Sign in with email and password; sets the session cookie",
    rateLimit: limits.login,
    body: z.object({ email, password: z.string().max(200) }),
    handler: async ({ req, res, body }) => {
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      // Always run the hash check so timing doesn't reveal which emails exist.
      const ok = await verifyPassword(user?.passwordHash, body.password);
      if (!user || !ok) throw new ApiError(401, "invalid_credentials", "Incorrect email or password.");
      if (user.status === "deactivated") throw new ApiError(403, "deactivated", "This account has been deactivated. Contact the school office.");
      if (user.status === "invited") throw new ApiError(403, "not_activated", "Please accept your invitation email to set a password first.");
      await startSession(prisma, req, res, user);
      return sessionFor(user.id);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/auth/logout",
    access: "public",
    summary: "End the current session (idempotent)",
    handler: async ({ req, res }) => {
      await endSession(prisma, req, res);
      return { ok: true };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/auth/me",
    access: "session",
    summary: "The signed-in user with roles, permissions and data scope",
    handler: ({ session }) => session,
  }),
  defineRoute({
    method: "POST",
    path: "/auth/forgot-password",
    access: "public",
    summary: "Email a password-reset link (same answer whether or not the email exists)",
    rateLimit: limits.passwordEmail,
    body: z.object({ email }),
    handler: async ({ body }) => {
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (user?.status === "active") {
        const token = await issueToken(prisma, user.id, "reset");
        // Not awaited: waiting for the mail server would make known emails measurably slower.
        void schoolName().then((school) => sendEmail(resetEmail(user, school, token)));
        if (config.EXPOSE_DEV_LINKS) return { ok: true, resetLink: resetLinkPath(token) };
      }
      return { ok: true };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/auth/reset-password",
    access: "public",
    summary: "Set a new password from a reset link; signs out every session",
    rateLimit: limits.tokenUse,
    body: z.object({ token: z.string().max(200), password: passwordSchema }),
    handler: async ({ body }) => {
      const token = await findLiveToken(prisma, body.token, "reset");
      if (token.user.status !== "active") throw new ApiError(400, "invalid_token", "This reset link is invalid or has expired.");
      const passwordHash = await hashPassword(body.password);
      await prisma.$transaction([
        prisma.user.update({ where: { id: token.userId }, data: { passwordHash } }),
        prisma.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
        prisma.session.deleteMany({ where: { userId: token.userId } }),
        prisma.auditLog.create({
          data: { actorId: token.userId, actor: token.user.name, action: "user.password", entity: "User", entityId: token.userId, summary: "Reset password from an emailed link" },
        }),
      ]);
      return { ok: true };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/auth/invites/:token",
    access: "public",
    summary: "Who an invitation is for, before they set a password",
    rateLimit: limits.tokenUse,
    handler: async ({ params }) => {
      const { user } = await findLiveToken(prisma, params.token, "invite");
      if (user.status !== "invited") throw new ApiError(404, "invalid_token", "This invitation link is invalid or has already been used.");
      return { name: user.name, email: user.email, kind: user.kind };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/auth/invites/:token/accept",
    access: "public",
    summary: "Set a password from an invitation, activate the account and sign in",
    rateLimit: limits.tokenUse,
    body: z.object({ password: passwordSchema }),
    handler: async ({ req, res, params, body }) => {
      const token = await findLiveToken(prisma, params.token, "invite");
      if (token.user.status !== "invited") throw new ApiError(404, "invalid_token", "This invitation link is invalid or has already been used.");
      const passwordHash = await hashPassword(body.password);
      await prisma.$transaction([
        prisma.user.update({ where: { id: token.userId }, data: { passwordHash, status: "active" } }),
        prisma.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
        prisma.auditLog.create({
          data: { actorId: token.userId, actor: token.user.name, action: "user.activate", entity: "User", entityId: token.userId, summary: "Accepted invitation and set a password" },
        }),
      ]);
      await startSession(prisma, req, res, token.user);
      return sessionFor(token.userId);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/auth/change-password",
    access: "session",
    summary: "Change own password; signs out the user's other sessions",
    body: z.object({ currentPassword: z.string().max(200), newPassword: passwordSchema }),
    handler: async ({ auth, body }) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.session.id } });
      if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
        throw new ApiError(422, "validation", "Current password is incorrect.", { currentPassword: "Current password is incorrect." });
      }
      const passwordHash = await hashPassword(body.newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        await tx.session.deleteMany({ where: { userId: user.id, NOT: { id: auth.sessionId ?? undefined } } });
        await audit(tx, auth, { action: "user.password", entity: "User", entityId: user.id, summary: "Changed own password" });
      });
      return { ok: true };
    },
  }),
];
