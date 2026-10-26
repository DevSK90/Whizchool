import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { SMS_MAX_PARTS, smsLength } from "@whizchool/shared/sms";
import type { AudienceType, Notice } from "@whizchool/shared/types";
import { audit } from "../audit";
import { fromIsoDate, schoolToday } from "../dates";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, page, skipTake } from "../http/list";
import { defineRoute } from "../http/route";
import { enqueue } from "../jobs";
import { createMessage, resolveAudience, toMessageLog } from "../services/messages";

const AUDIENCES = ["all_parents", "grade", "class", "all_staff", "defaulters"] as const;
const CHANNELS = ["sms", "email"] as const;

const idList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean).slice(0, 60));

/** Grades or classes must exist (classes in the current year are what the UI offers). */
async function checkAudienceIds(type: AudienceType, ids: string[]) {
  if (type !== "grade" && type !== "class") return;
  if (!ids.length) throw new ApiError(422, "validation", "Choose at least one grade or class.", { audience: "Required" });
  const found = type === "grade" ? await prisma.grade.count({ where: { id: { in: ids } } }) : await prisma.classSection.count({ where: { id: { in: ids } } });
  if (found !== new Set(ids).size) throw new ApiError(422, "validation", "Choose grades or classes from the list.", { audience: "Unknown grade or class" });
}

const toNotice = (n: Prisma.NoticeGetPayload<object>): Notice => ({
  id: n.id,
  title: n.title,
  body: n.body,
  audience: n.audience,
  pinned: n.pinned,
  publishedAt: n.publishedAt.toISOString(),
  author: n.author,
});

const noticeBody = z.object({
  title: z.string().trim().min(1, "Required").max(120),
  body: z.string().trim().min(1, "Required").max(5000),
  audience: z.enum(["everyone", "parents", "staff"]).default("everyone"),
  pinned: z.boolean().default(false),
});

export const messageRoutes = [
  defineRoute({
    method: "GET",
    path: "/messages",
    access: { permission: "messaging.view" },
    summary: "Sent SMS and email, newest first, with delivery counts",
    query: listQuery.extend({
      channel: z.enum([...CHANNELS, "all"]).optional(),
      kind: z.enum(["manual", "absence_alert", "fee_reminder", "system", "all"]).optional(),
    }),
    handler: async ({ query }) => {
      const where: Prisma.MessageWhereInput = {
        ...(query.channel && query.channel !== "all" ? { channel: query.channel } : {}),
        ...(query.kind && query.kind !== "all" ? { kind: query.kind } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.message.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...skipTake(query) }),
        prisma.message.count({ where }),
      ]);
      return page(rows.map(toMessageLog), total, query);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/messages/audience",
    access: { permission: "messaging.create" },
    summary: "How many people an audience reaches on a channel, before sending",
    query: z.object({ type: z.enum(AUDIENCES), ids: idList, channel: z.enum(CHANNELS).default("sms") }),
    handler: async ({ query }) => {
      await checkAudienceIds(query.type, query.ids).catch(() => undefined);
      const a = await resolveAudience(prisma, query.type, query.ids, query.channel, fromIsoDate(schoolToday()));
      return { count: a.recipients.length, label: a.label, unreachable: a.unreachable };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/messages",
    access: { permission: "messaging.create" },
    summary: "Send an SMS or email to parents or staff; delivery happens in the background",
    idempotent: true,
    body: z
      .object({
        channel: z.enum(CHANNELS, { error: "Choose SMS or email" }),
        audience: z.object({ type: z.enum(AUDIENCES, { error: "Choose who receives it" }), ids: idList }),
        subject: z.string().trim().max(150).optional(),
        body: z.string().trim().min(1, "Required").max(5000),
      })
      .superRefine((m, ctx) => {
        if (m.channel === "email" && !m.subject) ctx.addIssue({ code: "custom", path: ["subject"], message: "Required" });
        if (m.channel === "sms") {
          const len = smsLength(m.body);
          if (len.parts > SMS_MAX_PARTS) {
            ctx.addIssue({ code: "custom", path: ["body"], message: `Too long: ${len.parts} SMS parts (at most ${SMS_MAX_PARTS})` });
          }
        }
      }),
    handler: async ({ auth, body }) => {
      await checkAudienceIds(body.audience.type, body.audience.ids);
      const audience = await resolveAudience(prisma, body.audience.type, body.audience.ids, body.channel, fromIsoDate(schoolToday()));
      if (!audience.recipients.length) throw new ApiError(422, "validation", "No recipients match this audience.");
      const message = await prisma.$transaction(async (tx) => {
        const m = await createMessage(tx, {
          channel: body.channel,
          kind: body.audience.type === "defaulters" ? "fee_reminder" : "manual",
          audience: { type: body.audience.type, ids: body.audience.ids, label: audience.label },
          subject: body.channel === "email" ? body.subject : null,
          body: body.body,
          createdById: auth.session.id,
          createdBy: auth.session.name,
          recipients: audience.recipients,
        });
        await audit(tx, auth, {
          action: "message.send",
          entity: "Message",
          entityId: m.id,
          summary: `Sent ${body.channel.toUpperCase()} to ${audience.label} (${audience.recipients.length})`,
        });
        return m;
      });
      await enqueue("messages.deliver", { messageId: message.id });
      return toMessageLog(await prisma.message.findUniqueOrThrow({ where: { id: message.id } }));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/notices",
    access: "session",
    summary: "Notices for the signed-in user (parents see school-wide and parent notices), pinned first",
    handler: async ({ session }) => {
      const notices = await prisma.notice.findMany({
        where: { audience: { in: session.kind === "parent" ? ["everyone", "parents"] : ["everyone", "staff", "parents"] } },
        orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      });
      return notices.map(toNotice);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/notices",
    access: { permission: "messaging.create" },
    summary: "Publish a notice",
    body: noticeBody,
    handler: async ({ auth, body }) => {
      const n = await prisma.$transaction(async (tx) => {
        const n = await tx.notice.create({ data: { ...body, authorId: auth.session.id, author: auth.session.name } });
        await audit(tx, auth, { action: "notice.publish", entity: "Notice", entityId: n.id, summary: `Published notice “${n.title}”` });
        return n;
      });
      return toNotice(n);
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/notices/:id",
    access: { permission: "messaging.create" },
    summary: "Edit a notice",
    body: noticeBody,
    handler: async ({ auth, params, body }) => {
      const before = await prisma.notice.findUnique({ where: { id: params.id } });
      if (!before) throw new ApiError(404, "not_found", "Notice not found.");
      const n = await prisma.$transaction(async (tx) => {
        const n = await tx.notice.update({ where: { id: before.id }, data: body });
        await audit(tx, auth, { action: "notice.update", entity: "Notice", entityId: n.id, summary: `Edited notice “${n.title}”`, before: { title: before.title, audience: before.audience, pinned: before.pinned } });
        return n;
      });
      return toNotice(n);
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/notices/:id",
    access: { permission: "messaging.create" },
    summary: "Remove a notice",
    handler: async ({ auth, params }) => {
      const n = await prisma.notice.findUnique({ where: { id: params.id } });
      if (!n) throw new ApiError(404, "not_found", "Notice not found.");
      await prisma.$transaction(async (tx) => {
        await tx.notice.delete({ where: { id: n.id } });
        await audit(tx, auth, { action: "notice.delete", entity: "Notice", entityId: n.id, summary: `Removed notice “${n.title}”`, before: { title: n.title, body: n.body } });
      });
      return { ok: true };
    },
  }),
];
