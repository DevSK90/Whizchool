import type { Route } from "../router";
import type { AudienceType, MessageLog } from "../../types";
import { audit, fail, isoNow, paginate, requireAuth, requirePerm, todayISO, type Ctx } from "../helpers";
import { nextId, type DB } from "../db";
import { defaulters } from "./fees";

const SMS_SEGMENT = 160;

function audienceCount(ctx: Ctx, type: AudienceType, ids: string[] = []) {
  const db = ctx.db;
  const active = db.students.rows.filter((s) => s.status === "active");
  const guardiansOf = (students: typeof active) => new Set(students.map((s) => s.guardianIds[0])).size;
  switch (type) {
    case "all_parents":
      return guardiansOf(active);
    case "grade":
      return guardiansOf(active.filter((s) => ids.includes(s.gradeId)));
    case "class":
      return guardiansOf(active.filter((s) => ids.includes(s.classId)));
    case "all_staff":
      return db.staff.rows.filter((s) => s.status === "active").length;
    case "defaulters":
      return defaulters(db, todayISO(ctx)).length;
  }
}

function audienceLabel(db: DB, type: AudienceType, ids: string[] = []) {
  switch (type) {
    case "all_parents":
      return "All parents";
    case "grade":
      return `Parents of ${ids.map((id) => db.grades.get(id)?.name).join(", ")}`;
    case "class":
      return `Parents of ${ids.map((id) => db.classes.get(id)?.name).join(", ")}`;
    case "all_staff":
      return "All staff";
    case "defaulters":
      return "Parents with overdue fees";
  }
}

/** The mock "queue" delivers messages a few seconds after they're created. */
function settle(m: MessageLog, now: Date) {
  if ((m.status === "queued" || m.status === "sending") && now.getTime() - new Date(m.createdAt).getTime() > 4000) {
    const failed = m.channel === "sms" ? Math.floor(m.recipients * 0.01) : 0;
    m.delivered = m.recipients - failed;
    m.failed = failed;
    m.status = failed ? "partial" : "sent";
  } else if (m.status === "queued" && now.getTime() - new Date(m.createdAt).getTime() > 1000) {
    m.status = "sending";
  }
}

export const commsRoutes: Route[] = [
  {
    method: "GET",
    path: "/messages",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.view");
      const { channel, kind } = ctx.query;
      const rows = [...ctx.db.messages.rows]
        .filter((m) => (!channel || channel === "all" || m.channel === channel) && (!kind || kind === "all" || m.kind === kind))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      rows.forEach((m) => settle(m, ctx.now));
      return paginate(rows, ctx.query);
    },
  },
  {
    method: "GET",
    path: "/messages/audience",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.create");
      const type = ctx.query.type as AudienceType;
      const ids = ctx.query.ids ? ctx.query.ids.split(",") : [];
      return { count: audienceCount(ctx, type, ids), label: audienceLabel(ctx.db, type, ids) };
    },
  },
  {
    method: "POST",
    path: "/messages",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.create");
      const db = ctx.db;
      const { channel, audience, subject, body } = ctx.body ?? {};
      if (channel !== "sms" && channel !== "email") fail(422, "validation", "Choose SMS or email.", { channel: "Required" });
      if (!body?.trim()) fail(422, "validation", "Message is required.", { body: "Required" });
      if (channel === "email" && !subject?.trim()) fail(422, "validation", "Subject is required for email.", { subject: "Required" });
      if (channel === "sms" && body.length > SMS_SEGMENT * 3) fail(422, "validation", "SMS is too long (max 3 parts).", { body: "Max 480 characters" });
      const type = audience?.type as AudienceType;
      const ids = (audience?.ids ?? []) as string[];
      if ((type === "grade" || type === "class") && !ids.length) fail(422, "validation", "Choose at least one grade or class.", { audience: "Required" });
      const recipients = audienceCount(ctx, type, ids);
      if (!recipients) fail(422, "validation", "No recipients match this audience.");
      const m = db.messages.insert({
        id: nextId(db, "msg"), channel, kind: type === "defaulters" ? "fee_reminder" : "manual",
        audience: { type, ids, label: audienceLabel(db, type, ids) }, subject: subject?.trim() || undefined, body: body.trim(),
        recipients, delivered: 0, failed: 0, status: "queued", createdAt: isoNow(ctx), createdBy: ctx.session!.name,
      });
      audit(ctx, "message.send", "Message", `Sent ${channel.toUpperCase()} to ${m.audience.label} (${recipients})`, m.id);
      return m;
    },
  },
  {
    method: "GET",
    path: "/notices",
    handler: (ctx) => {
      const s = requireAuth(ctx);
      const visible = s.kind === "parent" ? ["everyone", "parents"] : ["everyone", "staff", "parents"];
      return ctx.db.notices.rows
        .filter((n) => visible.includes(n.audience))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt.localeCompare(a.publishedAt));
    },
  },
  {
    method: "POST",
    path: "/notices",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.create");
      const { title, body, audience, pinned } = ctx.body ?? {};
      if (!title?.trim()) fail(422, "validation", "Title is required.", { title: "Required" });
      if (!body?.trim()) fail(422, "validation", "Notice text is required.", { body: "Required" });
      const n = ctx.db.notices.insert({
        id: nextId(ctx.db, "ntc"), title: title.trim(), body: body.trim(), audience: audience ?? "everyone",
        pinned: !!pinned, publishedAt: isoNow(ctx), author: ctx.session!.name,
      });
      audit(ctx, "notice.publish", "Notice", `Published notice “${n.title}”`, n.id);
      return n;
    },
  },
  {
    method: "PUT",
    path: "/notices/:id",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.create");
      const n = ctx.db.notices.get(ctx.params.id) ?? fail(404, "not_found", "Notice not found.");
      const { title, body, audience, pinned } = ctx.body ?? {};
      if (!title?.trim() || !body?.trim()) fail(422, "validation", "Title and text are required.");
      Object.assign(n, { title: title.trim(), body: body.trim(), audience, pinned: !!pinned });
      return n;
    },
  },
  {
    method: "DELETE",
    path: "/notices/:id",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.create");
      const n = ctx.db.notices.get(ctx.params.id) ?? fail(404, "not_found", "Notice not found.");
      ctx.db.notices.remove(n.id);
      audit(ctx, "notice.delete", "Notice", `Removed notice “${n.title}”`, n.id);
      return { ok: true };
    },
  },
];
