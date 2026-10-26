import type { AudienceType, MessageChannel, MessageLog } from "@whizchool/shared/types";
import type { Prisma } from "../generated/prisma/client";
import type { Db } from "../db";

type Tx = Prisma.TransactionClient;

export interface Recipient {
  /** Phone ("077 123 4567") or email address. */
  to: string;
  studentId?: string;
  guardianId?: string;
  /** Personalised text; the message body is used when absent. */
  body?: string;
}

/** Students with an unpaid balance on an invoice past its due date. */
export async function overdueStudentIds(db: Pick<Db, "invoice">, today: Date) {
  const rows = await db.invoice.findMany({
    where: { status: { in: ["unpaid", "partial"] }, dueDate: { lt: today }, student: { status: "active" } },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  return rows.map((r) => r.studentId);
}

/**
 * Who an audience reaches on a channel. Parents are reached through each student's primary
 * guardian, once per guardian however many children they have. People without a phone or email
 * for the channel are counted as unreachable rather than silently dropped.
 */
export async function resolveAudience(db: Pick<Db, "student" | "staff" | "grade" | "classSection" | "invoice">, type: AudienceType, ids: string[], channel: MessageChannel, today: Date) {
  let label: string;
  if (type === "all_staff") {
    const staff = await db.staff.findMany({ where: { status: "active" }, select: { phone: true, email: true } });
    const reachable = staff.map((s) => (channel === "sms" ? s.phone : s.email)).filter((v): v is string => !!v);
    return { label: "All staff", recipients: [...new Set(reachable)].map((to) => ({ to })), unreachable: staff.length - reachable.length };
  }
  const where: Prisma.StudentWhereInput = { status: "active" };
  if (type === "grade") {
    where.gradeId = { in: ids };
    label = `Parents of ${(await db.grade.findMany({ where: { id: { in: ids } }, orderBy: { number: "asc" } })).map((g) => g.name).join(", ")}`;
  } else if (type === "class") {
    where.classId = { in: ids };
    label = `Parents of ${(await db.classSection.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } })).map((c) => c.name).join(", ")}`;
  } else if (type === "defaulters") {
    where.id = { in: await overdueStudentIds(db, today) };
    label = "Parents with overdue fees";
  } else {
    label = "All parents";
  }
  const students = await db.student.findMany({
    where,
    select: { id: true, guardians: { orderBy: { position: "asc" }, take: 1, select: { guardian: { select: { id: true, phone: true, email: true } } } } },
  });
  const byGuardian = new Map<string, Recipient | null>();
  for (const s of students) {
    const g = s.guardians[0]?.guardian;
    if (!g || byGuardian.has(g.id)) continue;
    const to = channel === "sms" ? g.phone : g.email;
    byGuardian.set(g.id, to ? { to, guardianId: g.id, studentId: s.id } : null);
  }
  const all = [...byGuardian.values()];
  return { label, recipients: all.filter((r): r is Recipient => !!r), unreachable: all.filter((r) => !r).length };
}

export interface NewMessage {
  channel: MessageChannel;
  kind: "manual" | "absence_alert" | "fee_reminder" | "system";
  audience: { type: AudienceType; ids: string[]; label: string };
  subject?: string | null;
  body: string;
  createdById?: string | null;
  createdBy: string;
  relatesTo?: string;
  recipients: Recipient[];
}

/** Records a message and one delivery per recipient. Queue "messages.deliver" after the transaction commits. */
export function createMessage(tx: Tx, m: NewMessage) {
  return tx.message.create({
    data: {
      channel: m.channel,
      kind: m.kind,
      audienceType: m.audience.type,
      audienceIds: m.audience.ids,
      audienceLabel: m.audience.label,
      subject: m.subject || null,
      body: m.body,
      status: "queued",
      recipients: m.recipients.length,
      createdById: m.createdById ?? null,
      createdBy: m.createdBy,
      relatesTo: m.relatesTo ?? null,
      deliveries: {
        create: m.recipients.map((r) => ({ to: r.to, body: r.body ?? null, studentId: r.studentId ?? null, guardianId: r.guardianId ?? null })),
      },
    },
  });
}

export const toMessageLog = (m: Prisma.MessageGetPayload<object>): MessageLog => ({
  id: m.id,
  channel: m.channel,
  kind: m.kind,
  audience: { type: m.audienceType as AudienceType, ...(m.audienceIds.length ? { ids: m.audienceIds } : {}), label: m.audienceLabel },
  ...(m.subject ? { subject: m.subject } : {}),
  body: m.body,
  recipients: m.recipients,
  delivered: m.delivered,
  failed: m.failed,
  status: m.status,
  createdAt: m.createdAt.toISOString(),
  createdBy: m.createdBy,
});
