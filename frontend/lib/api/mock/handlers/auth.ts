import type { Route } from "../router";
import { audit, buildSession, fail, isoNow, requireAuth } from "../helpers";

const MIN_PASSWORD = 8;

function checkPassword(password: unknown) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    fail(422, "validation", "Password is too short.", { password: `Use at least ${MIN_PASSWORD} characters.` });
  }
}

export const authRoutes: Route[] = [
  {
    method: "POST",
    path: "/auth/login",
    public: true,
    handler: (ctx) => {
      const email = String(ctx.body?.email ?? "").trim().toLowerCase();
      const user = ctx.db.users.rows.find((u) => u.email.toLowerCase() === email);
      if (!user || user.password !== ctx.body?.password) {
        fail(401, "invalid_credentials", "Incorrect email or password.");
      }
      if (user!.status === "invited") fail(403, "not_activated", "Please accept your invitation email to set a password first.");
      if (user!.status === "deactivated") fail(403, "deactivated", "This account has been deactivated. Contact the school office.");
      user!.lastLoginAt = isoNow(ctx);
      return buildSession(ctx.db, user!);
    },
  },
  { method: "POST", path: "/auth/logout", public: true, handler: () => ({ ok: true }) },
  { method: "GET", path: "/auth/me", handler: (ctx) => requireAuth(ctx) },
  {
    method: "POST",
    path: "/auth/forgot-password",
    public: true,
    // Always succeeds so the endpoint can't be used to discover registered emails.
    handler: () => ({ ok: true }),
  },
  {
    method: "POST",
    path: "/auth/reset-password",
    public: true,
    handler: (ctx) => {
      const token = ctx.db.tokens.get(String(ctx.body?.token));
      if (!token || token.kind !== "reset") fail(400, "invalid_token", "This reset link is invalid or has expired.");
      checkPassword(ctx.body?.password);
      const user = ctx.db.users.get(token!.userId)!;
      user.password = ctx.body.password;
      return { ok: true };
    },
  },
  {
    method: "GET",
    path: "/auth/invites/:token",
    public: true,
    handler: (ctx) => {
      const token = ctx.db.tokens.get(ctx.params.token);
      const user = token?.kind === "invite" ? ctx.db.users.get(token.userId) : undefined;
      if (!user || user.status !== "invited") fail(404, "invalid_token", "This invitation link is invalid or has already been used.");
      return { name: user!.name, email: user!.email, kind: user!.kind };
    },
  },
  {
    method: "POST",
    path: "/auth/invites/:token/accept",
    public: true,
    handler: (ctx) => {
      const token = ctx.db.tokens.get(ctx.params.token);
      const user = token?.kind === "invite" ? ctx.db.users.get(token.userId) : undefined;
      if (!user || user.status !== "invited") fail(404, "invalid_token", "This invitation link is invalid or has already been used.");
      checkPassword(ctx.body?.password);
      user!.password = ctx.body.password;
      user!.status = "active";
      user!.lastLoginAt = isoNow(ctx);
      ctx.db.tokens.delete(ctx.params.token);
      return buildSession(ctx.db, user!);
    },
  },
  {
    method: "POST",
    path: "/auth/change-password",
    handler: (ctx) => {
      const s = requireAuth(ctx);
      const user = ctx.db.users.get(s.id)!;
      if (user.password !== ctx.body?.currentPassword) {
        fail(422, "validation", "Current password is incorrect.", { currentPassword: "Current password is incorrect." });
      }
      checkPassword(ctx.body?.newPassword);
      user.password = ctx.body.newPassword;
      audit(ctx, "user.password", "User", "Changed own password", user.id);
      return { ok: true };
    },
  },
];
