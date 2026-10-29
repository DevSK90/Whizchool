// Money rules: invoices, payments and how payments settle invoices. Amounts are handled in cents
// (integers) so sums never drift; the database keeps them as Decimal(12, 2).
import { ApiError } from "@whizchool/shared/api";
import type { Invoice, InvoiceListItem, Payment, PaymentListItem, PaymentMethod } from "@whizchool/shared/types";
import { nextNumber } from "../counters";
import { toIsoDate } from "../dates";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { fullName } from "../students";

type Tx = Prisma.TransactionClient;
type Client = Db | Tx;

export const cents = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
export const rupees = (c: number) => c / 100;

export function invoiceStatus(totalCents: number, paidCents: number): "unpaid" | "partial" | "paid" {
  if (paidCents >= totalCents) return "paid";
  return paidCents > 0 ? "partial" : "unpaid";
}

export const invoiceInclude = {
  lines: { orderBy: { id: "asc" } },
  student: { select: { firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } } } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export function toInvoice(i: Omit<InvoiceRow, "student">): Invoice {
  const total = cents(i.total);
  const paid = cents(i.paid);
  return {
    id: i.id,
    number: i.number,
    studentId: i.studentId,
    ...(i.period ? { period: i.period } : {}),
    issueDate: toIsoDate(i.issueDate),
    dueDate: toIsoDate(i.dueDate),
    lines: i.lines.map((l) => ({ id: l.id, feeTypeId: l.feeTypeId, description: l.description, amount: Number(l.amount), discount: Number(l.discount) })),
    total: rupees(total),
    paid: rupees(paid),
    balance: i.status === "void" ? 0 : rupees(Math.max(0, total - paid)),
    status: i.status,
  };
}

export function toInvoiceListItem(i: InvoiceRow, today: string): InvoiceListItem {
  const inv = toInvoice(i);
  return {
    ...inv,
    studentName: fullName(i.student),
    admissionNo: i.student.admissionNo,
    className: i.student.class.name,
    overdue: inv.balance > 0 && inv.dueDate < today,
  };
}

export const paymentInclude = {
  allocations: { include: { invoice: { select: { number: true } } }, orderBy: { id: "asc" } },
  student: { select: { firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } } } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function toPayment(p: Omit<PaymentRow, "student">): Payment {
  return {
    id: p.id,
    receiptNo: p.receiptNo,
    studentId: p.studentId,
    amount: Number(p.amount),
    method: p.method,
    ...(p.reference ? { reference: p.reference } : {}),
    paidAt: p.paidAt.toISOString(),
    recordedBy: p.recordedBy,
    status: p.status,
    allocations: p.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoice.number, amount: Number(a.amount) })),
  };
}

export function toPaymentListItem(p: PaymentRow): PaymentListItem {
  return { ...toPayment(p), studentName: fullName(p.student), admissionNo: p.student.admissionNo, className: p.student.class.name };
}

/** "INV-2026-006520": gap-free per school, numbered in the same transaction as the invoice. */
export async function nextInvoiceNumber(tx: Tx, year: string) {
  const n = await nextNumber(tx, "invoiceNo", (await tx.invoice.count()) + 1);
  return `INV-${year}-${String(n).padStart(6, "0")}`;
}

interface OpenInvoice {
  id: string;
  number: string;
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
}

/**
 * A student's unpaid invoices, locked for this transaction so a cash payment and an online one
 * can't settle the same balance twice. `first` invoices come first, then the oldest due date.
 */
export function lockOpenInvoices(tx: Tx, studentId: string, first: string[] = []) {
  return tx.$queryRaw<OpenInvoice[]>`
    SELECT "id", "number", "total", "paid" FROM "Invoice"
    WHERE "studentId" = ${studentId} AND "status" IN ('unpaid', 'partial')
    ORDER BY ("id" = ANY(${first}::text[])) DESC, "dueDate" ASC, "number" ASC
    FOR UPDATE`;
}

export interface NewPayment {
  studentId: string;
  amountCents: number;
  method: PaymentMethod;
  reference?: string | null;
  paidAt: Date;
  recordedById?: string | null;
  recordedBy: string;
  /** Invoices to settle before the rest (a PayHere order's own invoices). */
  first?: string[];
  /**
   * Money already taken (online payments) is recorded even when it exceeds what's owed; the excess
   * stays unallocated for the accountant to refund or apply. Cash over the balance is refused.
   */
  allowExcess?: boolean;
}

/** Records a payment with its receipt number and settles open invoices, oldest due first. */
export async function recordPayment(tx: Tx, p: NewPayment) {
  const open = await lockOpenInvoices(tx, p.studentId, p.first);
  const owed = open.reduce((sum, i) => sum + cents(i.total) - cents(i.paid), 0);
  if (p.amountCents > owed && !p.allowExcess) {
    throw new ApiError(422, "validation", "Amount is more than the outstanding balance.", { amount: `Outstanding balance is ${rupees(owed).toFixed(2)}` });
  }
  const year = toIsoDate(p.paidAt).slice(0, 4);
  const n = await nextNumber(tx, "receiptNo", (await tx.payment.count()) + 1);
  const payment = await tx.payment.create({
    data: {
      receiptNo: `RCT-${year}-${String(n).padStart(6, "0")}`,
      studentId: p.studentId,
      amount: rupees(p.amountCents),
      method: p.method,
      reference: p.reference || null,
      paidAt: p.paidAt,
      recordedById: p.recordedById ?? null,
      recordedBy: p.recordedBy,
    },
  });
  let left = p.amountCents;
  const allocations: { paymentId: string; invoiceId: string; amount: number }[] = [];
  for (const inv of open) {
    if (left <= 0) break;
    const total = cents(inv.total);
    const paid = cents(inv.paid);
    const take = Math.min(left, total - paid);
    if (take <= 0) continue;
    await tx.invoice.update({ where: { id: inv.id }, data: { paid: rupees(paid + take), status: invoiceStatus(total, paid + take) } });
    allocations.push({ paymentId: payment.id, invoiceId: inv.id, amount: rupees(take) });
    left -= take;
  }
  if (allocations.length) await tx.paymentAllocation.createMany({ data: allocations });
  return { payment, unallocatedCents: left };
}

/** Undoes a payment's effect on its invoices; the payment stays on record as reversed. */
export async function reversePayment(tx: Tx, paymentId: string, reason: string) {
  const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  if (!locked) throw new ApiError(404, "not_found", "Payment not found.");
  if (locked.status !== "completed") throw new ApiError(409, "invalid_transition", "Only completed payments can be reversed.");
  const allocations = await tx.paymentAllocation.findMany({ where: { paymentId } });
  for (const a of allocations) {
    const [inv] = await tx.$queryRaw<{ total: Prisma.Decimal; paid: Prisma.Decimal; status: string }[]>`
      SELECT "total", "paid", "status" FROM "Invoice" WHERE "id" = ${a.invoiceId} FOR UPDATE`;
    const paid = Math.max(0, cents(inv!.paid) - cents(a.amount));
    const status = inv!.status === "void" ? "void" : invoiceStatus(cents(inv!.total), paid);
    await tx.invoice.update({ where: { id: a.invoiceId }, data: { paid: rupees(paid), status } });
  }
  return tx.payment.update({ where: { id: paymentId }, data: { status: "reversed", reversedAt: new Date(), reversalReason: reason }, include: paymentInclude });
}

/** Each student's overdue balance and oldest overdue due date (active students only). */
export async function overdueByStudent(db: Client, today: Date) {
  const rows = await db.invoice.findMany({
    where: { status: { in: ["unpaid", "partial"] }, dueDate: { lt: today }, student: { status: "active" } },
    select: { studentId: true, total: true, paid: true, dueDate: true },
  });
  const out = new Map<string, { invoices: number; balanceCents: number; oldest: Date }>();
  for (const r of rows) {
    const o = out.get(r.studentId) ?? { invoices: 0, balanceCents: 0, oldest: r.dueDate };
    o.invoices++;
    o.balanceCents += cents(r.total) - cents(r.paid);
    if (r.dueDate < o.oldest) o.oldest = r.dueDate;
    out.set(r.studentId, o);
  }
  return out;
}

/** Days an invoice may be overdue before the student counts as a defaulter. */
export const DEFAULTER_DAYS = 30;
