import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { Defaulter, Discount, FeeStructure, FeesSummary, FeeType, InvoiceDetail, PaymentMethod } from "@whizchool/shared/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth/context";
import { canSeeStudent } from "../auth/scope";
import { reserveNumbers } from "../counters";
import { addDays, fromIsoDate, isoDate, schoolToday, toIsoDate } from "../dates";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { listQuery, omitNulls, page, parseSort, skipTake } from "../http/list";
import { defineRoute } from "../http/route";
import { enqueue } from "../jobs";
import { currentYearId, schoolName } from "../school";
import {
  cents,
  DEFAULTER_DAYS,
  invoiceInclude,
  overdueByStudent,
  paymentInclude,
  recordPayment,
  reversePayment,
  rupees,
  toInvoiceListItem,
  toPayment,
  toPaymentListItem,
} from "../services/fees";
import { generateMonthlyInvoices } from "../services/invoices";
import { createMessage } from "../services/messages";
import { fullName } from "../students";
import { toSchool } from "./school";

const MAX_AMOUNT = 10_000_000;
const money = (field = "Amount") =>
  z.coerce
    .number({ error: "Enter an amount" })
    .positive(`${field} must be greater than 0`)
    .max(MAX_AMOUNT, `${field} is too large`)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most two decimals");

const lkr = (amount: number) => `LKR ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Words of a search box, each matched against the invoice number or the student's name or admission number. */
function studentSearch(search: string | undefined, extra: (term: string) => Prisma.InvoiceWhereInput[] = () => []): Prisma.InvoiceWhereInput {
  if (!search) return {};
  return {
    AND: search.split(/\s+/).map((term) => ({
      OR: [
        ...extra(term),
        { student: { firstName: { contains: term, mode: "insensitive" as const } } },
        { student: { lastName: { contains: term, mode: "insensitive" as const } } },
        { student: { admissionNo: { contains: term, mode: "insensitive" as const } } },
      ],
    })),
  };
}

const monthStart = (period: string) => fromIsoDate(`${period}-01`);
const nextMonth = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
};
const period = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");

/** Parents see their own children's records; staff need the permission (fees aren't narrowed by class). */
async function studentForFees(auth: AuthContext, studentId: string, perm: "fees.view" | "payments.view") {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, classId: true } });
  if (!s) throw new ApiError(404, "not_found", "Student not found.");
  if (auth.session.kind === "parent" ? !canSeeStudent(auth, s) : !auth.session.permissions.includes(perm)) {
    throw new ApiError(403, "forbidden", "You don't have access to these fees.");
  }
  return s;
}

const toFeeType = (f: { id: string; name: string; recurrence: FeeType["recurrence"]; description: string | null; active: boolean }): FeeType =>
  omitNulls({ id: f.id, name: f.name, recurrence: f.recurrence, description: f.description, active: f.active });
const toDiscount = (d: { id: string; name: string; kind: Discount["kind"]; value: Prisma.Decimal; feeTypeId: string | null; description: string | null }): Discount =>
  omitNulls({ id: d.id, name: d.name, kind: d.kind, value: Number(d.value), feeTypeId: d.feeTypeId, description: d.description });
const toStructure = (s: { id: string; yearId: string; gradeId: string; feeTypeId: string; amount: Prisma.Decimal }): FeeStructure => ({
  id: s.id,
  yearId: s.yearId,
  gradeId: s.gradeId,
  feeTypeId: s.feeTypeId,
  amount: Number(s.amount),
});

const isDuplicate = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Students with an invoice overdue for at least DEFAULTER_DAYS. */
async function defaulters(today: string): Promise<Defaulter[]> {
  const cutoff = fromIsoDate(addDays(today, -DEFAULTER_DAYS));
  const overdue = [...(await overdueByStudent(prisma, fromIsoDate(today)))].filter(([, o]) => o.oldest <= cutoff);
  const ids = overdue.map(([id]) => id);
  const [students, reminders] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        admissionNo: true,
        firstName: true,
        lastName: true,
        class: { select: { name: true } },
        guardians: { orderBy: { position: "asc" }, take: 1, select: { guardian: { select: { name: true, phone: true } } } },
      },
    }),
    prisma.feeReminder.groupBy({ by: ["studentId"], where: { studentId: { in: ids } }, _max: { sentAt: true } }),
  ]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const reminded = new Map(reminders.map((r) => [r.studentId, r._max.sentAt]));
  return overdue
    .map(([id, o]) => {
      const s = byId.get(id)!;
      const g = s.guardians[0]?.guardian;
      const last = reminded.get(id);
      return {
        studentId: id,
        admissionNo: s.admissionNo,
        fullName: fullName(s),
        className: s.class.name,
        ...(g ? { guardianName: g.name, guardianPhone: g.phone } : {}),
        overdueInvoices: o.invoices,
        balance: rupees(o.balanceCents),
        oldestDueDate: toIsoDate(o.oldest),
        ...(last ? { lastReminderAt: last.toISOString() } : {}),
      };
    })
    .sort((a, b) => b.balance - a.balance);
}

/** Collections this month and last, what's outstanding and overdue, the last ten months, and this month by method. */
export async function feeTotals(today: string): Promise<Omit<FeesSummary, "defaulters">> {
  const thisMonth = today.slice(0, 7);
  const months: string[] = [thisMonth];
  while (months.length < 10) {
    const [y, m] = months[0]!.split("-").map(Number);
    months.unshift(m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`);
  }
  const from = monthStart(months[0]!);
  const [collected, billed, [open]] = await Promise.all([
    prisma.$queryRaw<{ month: string; method: PaymentMethod; amount: string }[]>`
      SELECT to_char("paidAt" AT TIME ZONE 'Asia/Colombo', 'YYYY-MM') AS "month", "method", sum("amount")::text AS "amount"
      FROM "Payment" WHERE "status" = 'completed' AND "paidAt" >= ${from}
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ month: string; amount: string }[]>`
      SELECT to_char("issueDate", 'YYYY-MM') AS "month", sum("total")::text AS "amount"
      FROM "Invoice" WHERE "status" <> 'void' AND "issueDate" >= ${from}
      GROUP BY 1`,
    prisma.$queryRaw<{ amount: string | null; overdue: number }[]>`
      SELECT sum("total" - "paid")::text AS "amount", (count(*) FILTER (WHERE "dueDate" < ${fromIsoDate(today)}))::int AS "overdue"
      FROM "Invoice" WHERE "status" IN ('unpaid', 'partial')`,
  ]);
  const sum = (rows: { amount: string }[]) => rupees(rows.reduce((s, r) => s + cents(r.amount), 0));
  const inMonth = (m: string) => collected.filter((r) => r.month === m);
  return {
    collectedThisMonth: sum(inMonth(thisMonth)),
    collectedLastMonth: sum(inMonth(months[8]!)),
    outstanding: rupees(cents(open?.amount)),
    overdueInvoices: open?.overdue ?? 0,
    monthly: months.map((m) => ({
      month: m,
      label: monthStart(m).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
      billed: sum(billed.filter((r) => r.month === m)),
      collected: sum(inMonth(m)),
    })),
    byMethod: (["cash", "cheque", "bank_deposit", "payhere"] as const).map((method) => ({
      method,
      amount: sum(inMonth(thisMonth).filter((r) => r.method === method)),
    })),
  };
}

export const feeRoutes = [
  // ---------- Overview ----------
  defineRoute({
    method: "GET",
    path: "/fees/summary",
    access: { permission: "fees.view" },
    summary: "Collections this month and last, outstanding and overdue totals, the last ten months and this month by method",
    handler: async (): Promise<FeesSummary> => {
      const today = schoolToday();
      const [totals, defaulterRows] = await Promise.all([feeTotals(today), defaulters(today)]);
      return { ...totals, defaulters: defaulterRows.length };
    },
  }),

  // ---------- Invoices ----------
  defineRoute({
    method: "GET",
    path: "/invoices",
    access: { permission: "fees.view" },
    summary: "Invoices, filtered by status (or overdue), month, class and search",
    query: listQuery.extend({
      status: z.enum(["all", "unpaid", "partial", "paid", "void", "overdue"]).optional(),
      period: period().optional(),
      classId: z.string().max(100).optional(),
    }),
    handler: async ({ query }) => {
      const today = schoolToday();
      const where: Prisma.InvoiceWhereInput = {
        ...(query.status === "overdue"
          ? { status: { in: ["unpaid", "partial"] }, dueDate: { lt: fromIsoDate(today) } }
          : query.status && query.status !== "all"
            ? { status: query.status }
            : {}),
        ...(query.classId ? { student: { classId: query.classId } } : {}),
        AND: [
          query.period ? { OR: [{ period: query.period }, { issueDate: { gte: monthStart(query.period), lt: monthStart(nextMonth(query.period)) } }] } : {},
          studentSearch(query.search, (term) => [{ number: { contains: term, mode: "insensitive" } }]),
        ],
      };
      const sort = parseSort(query.sort ?? "-issueDate", ["issueDate", "dueDate", "student", "total", "balance"] as const, "issueDate");
      const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
        sort.field === "student"
          ? [{ student: { firstName: sort.dir } }, { student: { lastName: sort.dir } }]
          : sort.field === "issueDate"
            ? [{ issueDate: sort.dir }, { number: sort.dir }]
            : [{ [sort.field]: sort.dir }, { number: "asc" }];
      const [total, rows] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({ where, include: invoiceInclude, orderBy, ...skipTake(query) }),
      ]);
      return page(rows.map((r) => toInvoiceListItem(r, today)), total, query);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/invoices/:id",
    access: "session",
    summary: "One invoice with the payments made against it",
    handler: async ({ auth, params }): Promise<InvoiceDetail> => {
      const inv = await prisma.invoice.findUnique({
        where: { id: params.id },
        include: { ...invoiceInclude, student: { include: { class: { select: { name: true } }, guardians: { orderBy: { position: "asc" }, take: 1, include: { guardian: true } } } } },
      });
      if (!inv) throw new ApiError(404, "not_found", "Invoice not found.");
      await studentForFees(auth, inv.studentId, "fees.view");
      const payments = await prisma.payment.findMany({ where: { allocations: { some: { invoiceId: inv.id } } }, include: paymentInclude, orderBy: { paidAt: "asc" } });
      const guardian = inv.student.guardians[0]?.guardian;
      return { ...toInvoiceListItem(inv, schoolToday()), payments: payments.map(toPayment), ...(guardian ? { guardianName: guardian.name } : {}) };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/invoices/charges",
    access: { permission: "fees.create" },
    summary: "Charge a fee (exam, trip, books…) to a class, a grade or chosen students: one invoice each",
    idempotent: true,
    body: z.object({
      target: z.object({ type: z.enum(["class", "grade", "students"]), ids: z.array(z.string().max(100)).min(1, "Choose who to charge").max(2000) }),
      feeTypeId: z.string().max(100),
      description: z.string().trim().max(200).optional(),
      amount: money(),
      dueDate: isoDate(),
    }),
    handler: async ({ auth, body }) => {
      const feeType = await prisma.feeType.findUnique({ where: { id: body.feeTypeId } });
      if (!feeType) throw new ApiError(422, "validation", "Please fix the highlighted fields.", { feeTypeId: "Choose a fee type" });
      const { type, ids } = body.target;
      const students = await prisma.student.findMany({
        where: { status: "active", ...(type === "class" ? { classId: { in: ids } } : type === "grade" ? { gradeId: { in: ids } } : { id: { in: ids } }) },
        select: { id: true },
      });
      if (!students.length) throw new ApiError(422, "validation", "No students match the selected target.", { target: "No active students" });
      const today = schoolToday();
      const amount = rupees(cents(body.amount));
      await prisma.$transaction(async (tx) => {
        const first = await reserveNumbers(tx, "invoiceNo", students.length, (await tx.invoice.count()) + 1);
        const invoices = students.map((s, i) => ({
          id: randomUUID(),
          number: `INV-${today.slice(0, 4)}-${String(first + i).padStart(6, "0")}`,
          studentId: s.id,
          issueDate: fromIsoDate(today),
          dueDate: fromIsoDate(body.dueDate),
          total: amount,
        }));
        await tx.invoice.createMany({ data: invoices });
        await tx.invoiceLine.createMany({ data: invoices.map((inv) => ({ invoiceId: inv.id, feeTypeId: feeType.id, description: body.description || feeType.name, amount })) });
        await audit(tx, auth, { action: "invoice.charge", entity: "Invoice", summary: `Charged ${feeType.name} (${lkr(amount)}) to ${students.length} students` });
      });
      return { created: students.length };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/invoices/generate-monthly",
    access: { permission: "fees.create" },
    summary: "Bill a month's fees to every active student now (normally the job does this on the 1st); students already billed are skipped",
    body: z.object({ period: period() }),
    handler: async ({ auth, body }) => {
      const result = await generateMonthlyInvoices(prisma, body.period);
      await audit(prisma, auth, { action: "invoice.generate", entity: "Invoice", summary: `Generated ${body.period} monthly invoices (${result.created})` });
      return result;
    },
  }),
  defineRoute({
    method: "POST",
    path: "/invoices/:id/void",
    access: { permission: "fees.edit" },
    summary: "Cancel an invoice issued in error (only without payments)",
    body: z.object({ reason: z.string().trim().min(1, "Required").max(300) }),
    handler: async ({ auth, params, body }) => {
      const updated = await prisma.$transaction(async (tx) => {
        const [inv] = await tx.$queryRaw<{ number: string; paid: string; status: string }[]>`
          SELECT "number", "paid"::text, "status" FROM "Invoice" WHERE "id" = ${params.id} FOR UPDATE`;
        if (!inv) throw new ApiError(404, "not_found", "Invoice not found.");
        if (inv.status === "void") throw new ApiError(409, "invalid_transition", "This invoice is already void.");
        if (cents(inv.paid) > 0) throw new ApiError(409, "has_payments", "An invoice with payments can't be voided. Reverse the payments first.");
        // The monthly key stays, so the monthly run won't bill the month again; charge a corrected amount instead.
        const updated = await tx.invoice.update({ where: { id: params.id }, data: { status: "void", voidedAt: new Date(), voidReason: body.reason }, include: invoiceInclude });
        await audit(tx, auth, { action: "invoice.void", entity: "Invoice", entityId: params.id, summary: `Voided ${inv.number}: ${body.reason}` });
        return updated;
      });
      return toInvoiceListItem(updated, schoolToday());
    },
  }),
  defineRoute({
    method: "GET",
    path: "/students/:id/invoices",
    access: "session",
    summary: "A student's invoices, newest first (void ones left out)",
    handler: async ({ auth, params }) => {
      const s = await studentForFees(auth, params.id, "fees.view");
      const today = schoolToday();
      const rows = await prisma.invoice.findMany({ where: { studentId: s.id, status: { not: "void" } }, include: invoiceInclude, orderBy: [{ issueDate: "desc" }, { number: "desc" }] });
      return rows.map((r) => toInvoiceListItem(r, today));
    },
  }),

  // ---------- Payments ----------
  defineRoute({
    method: "GET",
    path: "/payments",
    access: { permission: "payments.view" },
    summary: "Payments, filtered by method, date range and search",
    query: listQuery.extend({
      method: z.enum(["all", "cash", "cheque", "bank_deposit", "payhere"]).optional(),
      from: isoDate().optional(),
      to: isoDate().optional(),
    }),
    handler: async ({ query }) => {
      const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
      const where: Prisma.PaymentWhereInput = {
        ...(query.method && query.method !== "all" ? { method: query.method } : {}),
        paidAt: { ...(query.from ? { gte: colombo(query.from) } : {}), ...(query.to ? { lt: colombo(addDays(query.to, 1)) } : {}) },
        AND: (query.search ?? "").split(/\s+/).filter(Boolean).map((term) => ({
          OR: [
            { receiptNo: { contains: term, mode: "insensitive" as const } },
            { reference: { contains: term, mode: "insensitive" as const } },
            { student: { firstName: { contains: term, mode: "insensitive" as const } } },
            { student: { lastName: { contains: term, mode: "insensitive" as const } } },
            { student: { admissionNo: { contains: term, mode: "insensitive" as const } } },
          ],
        })),
      };
      const sort = parseSort(query.sort ?? "-paidAt", ["paidAt", "amount", "student"] as const, "paidAt");
      const orderBy: Prisma.PaymentOrderByWithRelationInput[] =
        sort.field === "student" ? [{ student: { firstName: sort.dir } }, { student: { lastName: sort.dir } }] : [{ [sort.field]: sort.dir }, { receiptNo: "desc" }];
      const [total, rows] = await Promise.all([
        prisma.payment.count({ where }),
        prisma.payment.findMany({ where, include: paymentInclude, orderBy, ...skipTake(query) }),
      ]);
      return page(rows.map(toPaymentListItem), total, query);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/payments/:id",
    access: "session",
    summary: "A payment as a receipt (with the school's details)",
    handler: async ({ auth, params }) => {
      const p = await prisma.payment.findUnique({ where: { id: params.id }, include: paymentInclude });
      if (!p) throw new ApiError(404, "not_found", "Payment not found.");
      await studentForFees(auth, p.studentId, "payments.view");
      return { ...toPaymentListItem(p), school: toSchool(await prisma.school.findUniqueOrThrow({ where: { id: "school" } })) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/students/:id/payments",
    access: "session",
    summary: "A student's payments, newest first",
    handler: async ({ auth, params }) => {
      const s = await studentForFees(auth, params.id, "payments.view");
      return (await prisma.payment.findMany({ where: { studentId: s.id }, include: paymentInclude, orderBy: { paidAt: "desc" } })).map(toPayment);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/payments",
    access: { permission: "payments.create" },
    summary: "Record a cash, cheque or bank-deposit payment; it settles the student's invoices oldest first",
    idempotent: true,
    body: z.object({
      studentId: z.string().max(100),
      amount: money(),
      method: z.enum(["cash", "cheque", "bank_deposit"], { error: "Choose a payment method" }),
      reference: z.string().trim().max(100).optional(),
      paidAt: isoDate().optional(),
    }),
    handler: async ({ auth, body }) => {
      const today = schoolToday();
      const fields: Record<string, string> = {};
      if (body.method !== "cash" && !body.reference) fields.reference = "Cheque or slip number is required";
      if (body.paidAt && body.paidAt > today) fields.paidAt = "Can't be in the future";
      const student = await prisma.student.findUnique({ where: { id: body.studentId }, select: { id: true, firstName: true, lastName: true } });
      if (!student) fields.studentId = "Choose a student";
      if (Object.keys(fields).length) throw new ApiError(422, "validation", "Please fix the highlighted fields.", fields);
      const paidAt = !body.paidAt || body.paidAt === today ? new Date() : new Date(`${body.paidAt}T12:00:00+05:30`);
      const payment = await prisma.$transaction(async (tx) => {
        const { payment } = await recordPayment(tx, {
          studentId: student!.id,
          amountCents: cents(body.amount),
          method: body.method,
          reference: body.reference,
          paidAt,
          recordedById: auth.session.id,
          recordedBy: auth.session.name,
        });
        await audit(tx, auth, {
          action: "payment.record",
          entity: "Payment",
          entityId: payment.id,
          summary: `Recorded ${body.method.replace("_", " ")} payment ${payment.receiptNo} (${lkr(Number(payment.amount))}) for ${fullName(student!)}`,
        });
        await tx.eventLog.create({ data: { type: "payment.received", data: { paymentId: payment.id, method: body.method, amount: Number(payment.amount) } } });
        return payment;
      });
      return toPaymentListItem(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude }));
    },
  }),
  defineRoute({
    method: "POST",
    path: "/payments/:id/reverse",
    access: { permission: "payments.approve" },
    summary: "Reverse a payment entered in error (a bounced cheque): its invoices are owed again",
    body: z.object({ reason: z.string().trim().min(1, "Required").max(300) }),
    handler: async ({ auth, params, body }) => {
      const reversed = await prisma.$transaction(async (tx) => {
        const p = await reversePayment(tx, params.id, body.reason);
        await audit(tx, auth, { action: "payment.reverse", entity: "Payment", entityId: p.id, summary: `Reversed ${p.receiptNo}: ${body.reason}` });
        return p;
      });
      return toPaymentListItem(reversed);
    },
  }),

  // ---------- Defaulters ----------
  defineRoute({
    method: "GET",
    path: "/fees/defaulters",
    access: { permission: "fees.view" },
    summary: `Students with fees overdue for ${DEFAULTER_DAYS} days or more, biggest balance first`,
    query: z.object({ search: z.string().trim().max(100).optional(), classId: z.string().max(100).optional() }),
    handler: async ({ query }) => {
      let rows = await defaulters(schoolToday());
      if (query.classId) {
        const cls = await prisma.classSection.findUnique({ where: { id: query.classId }, select: { name: true } });
        rows = rows.filter((r) => r.className === cls?.name);
      }
      const terms = (query.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return rows.filter((r) => terms.every((t) => [r.fullName, r.admissionNo, r.guardianName ?? ""].some((f) => f.toLowerCase().includes(t))));
    },
  }),
  defineRoute({
    method: "POST",
    path: "/fees/defaulters/remind",
    access: { permission: "messaging.create" },
    summary: "Text each chosen student's parent their overdue balance",
    body: z.object({ studentIds: z.array(z.string().max(100)).min(1, "Select at least one student").max(2000) }),
    handler: async ({ auth, body }) => {
      const overdue = await overdueByStudent(prisma, fromIsoDate(schoolToday()));
      const students = await prisma.student.findMany({
        where: { id: { in: body.studentIds.filter((id) => overdue.has(id)) } },
        select: { id: true, firstName: true, lastName: true, guardians: { orderBy: { position: "asc" }, take: 1, select: { guardian: { select: { id: true, phone: true } } } } },
      });
      const school = await schoolName();
      const recipients = students
        .filter((s) => s.guardians[0]?.guardian.phone)
        .map((s) => ({
          to: s.guardians[0]!.guardian.phone,
          guardianId: s.guardians[0]!.guardian.id,
          studentId: s.id,
          body: `Dear parent, school fees of ${lkr(rupees(overdue.get(s.id)!.balanceCents))} for ${fullName(s)} are overdue. Please settle at the earliest or contact the school office. - ${school}`,
        }));
      if (!recipients.length) throw new ApiError(422, "validation", "None of the selected students has overdue fees and a parent's phone number.");
      const message = await prisma.$transaction(async (tx) => {
        const message = await createMessage(tx, {
          channel: "sms",
          kind: "fee_reminder",
          audience: { type: "defaulters", ids: recipients.map((r) => r.studentId), label: `Parents with overdue fees (${recipients.length})` },
          body: "Dear parent, school fees of {balance} for {student} are overdue. Please settle at the earliest or contact the school office.",
          createdById: auth.session.id,
          createdBy: auth.session.name,
          recipients,
        });
        await tx.feeReminder.createMany({ data: recipients.map((r) => ({ studentId: r.studentId, messageId: message.id })) });
        await audit(tx, auth, { action: "fees.reminder", entity: "Message", entityId: message.id, summary: `Sent overdue reminders to ${recipients.length} parents` });
        return message;
      });
      await enqueue("messages.deliver", { messageId: message.id });
      return { sent: recipients.length };
    },
  }),

  // ---------- Fee setup ----------
  defineRoute({
    method: "GET",
    path: "/fee-types",
    access: "session",
    summary: "Kinds of fee (tuition, admission, exam…)",
    handler: async () => (await prisma.feeType.findMany({ orderBy: [{ recurrence: "asc" }, { name: "asc" }] })).map(toFeeType),
  }),
  defineRoute({
    method: "POST",
    path: "/fee-types",
    access: { permission: "fees.edit" },
    summary: "Add a fee type",
    body: z.object({ name: z.string().trim().min(1, "Required").max(80), recurrence: z.enum(["monthly", "one_time", "ad_hoc"], { error: "Choose how often it's charged" }), description: z.string().trim().max(200).optional() }),
    handler: async ({ auth, body }) => {
      try {
        return await prisma.$transaction(async (tx) => {
          const ft = await tx.feeType.create({ data: { name: body.name, recurrence: body.recurrence, description: body.description || null } });
          await audit(tx, auth, { action: "feeType.create", entity: "Fee type", entityId: ft.id, summary: `Added fee type ${ft.name}` });
          return toFeeType(ft);
        });
      } catch (e) {
        if (isDuplicate(e)) throw new ApiError(409, "duplicate", "A fee type with this name already exists.", { name: "Already exists" });
        throw e;
      }
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/fee-types/:id",
    access: { permission: "fees.edit" },
    summary: "Rename, describe or (de)activate a fee type; how often it's charged can't change",
    body: z.object({ name: z.string().trim().min(1, "Required").max(80), description: z.string().trim().max(200).optional(), active: z.boolean() }),
    handler: async ({ auth, params, body }) => {
      if (!(await prisma.feeType.findUnique({ where: { id: params.id } }))) throw new ApiError(404, "not_found", "Fee type not found.");
      try {
        return await prisma.$transaction(async (tx) => {
          const ft = await tx.feeType.update({ where: { id: params.id }, data: { name: body.name, description: body.description || null, active: body.active } });
          await audit(tx, auth, { action: "feeType.update", entity: "Fee type", entityId: ft.id, summary: `Updated fee type ${ft.name}${ft.active ? "" : " (inactive)"}` });
          return toFeeType(ft);
        });
      } catch (e) {
        if (isDuplicate(e)) throw new ApiError(409, "duplicate", "A fee type with this name already exists.", { name: "Already exists" });
        throw e;
      }
    },
  }),
  defineRoute({
    method: "GET",
    path: "/fee-structures",
    access: { permission: "fees.view" },
    summary: "Fee amounts per grade for a year (default: the current year)",
    query: z.object({ yearId: z.string().max(100).optional() }),
    handler: async ({ query }) => (await prisma.feeStructure.findMany({ where: { yearId: query.yearId || (await currentYearId()) } })).map(toStructure),
  }),
  defineRoute({
    method: "PUT",
    path: "/fee-structures",
    access: { permission: "fees.edit" },
    summary: "Set fee amounts per grade and fee type for a year (default: the current year)",
    body: z.object({
      yearId: z.string().max(100).optional(),
      items: z.array(z.object({ gradeId: z.string().max(100), feeTypeId: z.string().max(100), amount: z.coerce.number().min(0, "Can't be negative").max(MAX_AMOUNT) })).max(1000),
    }),
    handler: async ({ auth, body }) => {
      const yearId = body.yearId || (await currentYearId());
      const [grades, feeTypes, year] = await Promise.all([
        prisma.grade.findMany({ select: { id: true } }),
        prisma.feeType.findMany({ select: { id: true } }),
        prisma.academicYear.findUnique({ where: { id: yearId } }),
      ]);
      if (!year) throw new ApiError(404, "not_found", "Academic year not found.");
      const known = (ids: { id: string }[], id: string) => ids.some((x) => x.id === id);
      if (body.items.some((i) => !known(grades, i.gradeId) || !known(feeTypes, i.feeTypeId))) throw new ApiError(422, "validation", "Unknown grade or fee type.");
      await prisma.$transaction(async (tx) => {
        for (const it of body.items) {
          const amount = rupees(cents(it.amount));
          await tx.feeStructure.upsert({
            where: { yearId_gradeId_feeTypeId: { yearId, gradeId: it.gradeId, feeTypeId: it.feeTypeId } },
            update: { amount },
            create: { yearId, gradeId: it.gradeId, feeTypeId: it.feeTypeId, amount },
          });
        }
        await audit(tx, auth, { action: "feeStructure.update", entity: "Fee structure", summary: `Updated the ${year.name} fee structure (${body.items.length} amounts)` });
      });
      return (await prisma.feeStructure.findMany({ where: { yearId } })).map(toStructure);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/discounts",
    access: "session",
    summary: "Discounts and scholarships",
    handler: async () => (await prisma.discount.findMany({ orderBy: { name: "asc" } })).map(toDiscount),
  }),
  defineRoute({
    method: "POST",
    path: "/discounts",
    access: { permission: "fees.edit" },
    summary: "Add a discount (a percentage or a fixed amount off one fee type; tuition by default)",
    body: z.object({
      name: z.string().trim().min(1, "Required").max(80),
      kind: z.enum(["percent", "fixed"]),
      value: z.coerce.number(),
      feeTypeId: z.string().max(100).optional(),
      description: z.string().trim().max(200).optional(),
    }),
    handler: async ({ auth, body }) => {
      if (body.kind === "percent" && !(body.value > 0 && body.value <= 100)) throw new ApiError(422, "validation", "Percentage must be 1–100.", { value: "1–100" });
      if (body.kind === "fixed" && !(body.value > 0 && body.value <= MAX_AMOUNT)) throw new ApiError(422, "validation", "Amount must be greater than zero.", { value: "Must be greater than 0" });
      const feeType = body.feeTypeId
        ? await prisma.feeType.findUnique({ where: { id: body.feeTypeId } })
        : await prisma.feeType.findFirst({ where: { recurrence: "monthly", active: true }, orderBy: { name: "asc" } });
      if (!feeType) throw new ApiError(422, "validation", "Choose the fee type the discount applies to.", { feeTypeId: "Required" });
      try {
        return await prisma.$transaction(async (tx) => {
          const d = await tx.discount.create({ data: { name: body.name, kind: body.kind, value: body.value, feeTypeId: feeType.id, description: body.description || null } });
          await audit(tx, auth, { action: "discount.create", entity: "Discount", entityId: d.id, summary: `Added discount ${d.name}` });
          return toDiscount(d);
        });
      } catch (e) {
        if (isDuplicate(e)) throw new ApiError(409, "duplicate", "A discount with this name already exists.", { name: "Already exists" });
        throw e;
      }
    },
  }),
];
