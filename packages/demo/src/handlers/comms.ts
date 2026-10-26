import type { Route } from "../router";
import { SMS_MAX_PARTS, smsLength } from "@whizchool/shared/sms";
import type { AudienceType, MessageChannel, MessageLog } from "@whizchool/shared/types";
import { audit, fail, isoNow, paginate, requireAuth, requirePerm, todayISO, type Ctx } from "../helpers";
import { nextId, type DB } from "../db";
import { defaulters } from "./fees";

/** Reachable people for an audience on a channel (primary guardians, once each), plus those without a phone/email. */
function audienceCount(ctx: Ctx, type: AudienceType, ids: string[] = [], channel: MessageChannel = "sms") {
  const db = ctx.db;
  if (type === "all_staff") {
    const staff = db.staff.rows.filter((s) => s.status === "active");
    const reachable = staff.filter((s) => (channel === "sms" ? s.phone : s.email)).length;
    return { count: reachable, unreachable: staff.length - reachable };
  }
  const active = db.students.rows.filter((s) => s.status === "active");
  const overdue = type === "defaulters" ? new Set(defaulters(db, todayISO(ctx)).map((d) => d.studentId)) : null;
  const students = active.filter((s) =>
    type === "grade" ? ids.includes(s.gradeId) : type === "class" ? ids.includes(s.classId) : overdue ? overdue.has(s.id) : true,
  );
  const guardians = [...new Set(students.map((s) => s.guardianIds[0]))].map((id) => db.guardians.get(id)).filter((g) => !!g);
  const reachable = guardians.filter((g) => (channel === "sms" ? g.phone : g.email)).length;
  return { count: reachable, unreachable: guardians.length - reachable };
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

function noticeErrors(title: unknown, body: unknown) {
  const f: Record<string, string> = {};
  if (typeof title !== "string" || !title.trim()) f.title = "Required";
  if (typeof body !== "string" || !body.trim()) f.body = "Required";
  if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
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
      const channel = (ctx.query.channel === "email" ? "email" : "sms") as MessageChannel;
      return { ...audienceCount(ctx, type, ids, channel), label: audienceLabel(ctx.db, type, ids) };
    },
  },
  {
    method: "POST",
    path: "/messages",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.create");
      const db = ctx.db;
      const { channel, audience, subject, body } = ctx.body ?? {};
      const f: Record<string, string> = {};
      if (channel !== "sms" && channel !== "email") f.channel = "Choose SMS or email";
      if (!body?.trim()) f.body = "Required";
      if (channel === "email" && !subject?.trim()) f.subject = "Required";
      if (channel === "sms" && body?.trim()) {
        const len = smsLength(body.trim());
        if (len.parts > SMS_MAX_PARTS) f.body = `Too long: ${len.parts} SMS parts (at most ${SMS_MAX_PARTS})`;
      }
      const type = audience?.type as AudienceType;
      const ids = (audience?.ids ?? []) as string[];
      if ((type === "grade" || type === "class") && !ids.length) f.audience = "Required";
      if (Object.keys(f).length) fail(422, "validation", "Please fix the highlighted fields.", f);
      const recipients = audienceCount(ctx, type, ids, channel).count;
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
      noticeErrors(title, body);
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
      noticeErrors(title, body);
      Object.assign(n!, { title: title.trim(), body: body.trim(), audience: audience ?? "everyone", pinned: !!pinned });
      audit(ctx, "notice.update", "Notice", `Edited notice “${n!.title}”`, n!.id);
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
