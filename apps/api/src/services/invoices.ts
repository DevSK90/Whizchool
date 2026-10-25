// Invoicing rules used outside the fees module. Phase 6 builds the rest of fees on these.
import { addDays, fromIsoDate } from "../dates";
import { nextNumber } from "../counters";
import type { Prisma } from "../generated/prisma/client";

type Tx = Prisma.TransactionClient;

const PAYMENT_TERMS_DAYS = 14;

/** "INV-2026-006520": gap-free per school, numbered in the same transaction as the invoice. */
async function nextInvoiceNumber(tx: Tx, year: string) {
  const n = await nextNumber(tx, "invoiceNo", (await tx.invoice.count()) + 1);
  return `INV-${year}-${String(n).padStart(6, "0")}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A newly admitted student's first invoice: every active one-time fee for their grade (admission,
 * deposit) plus this month's tuition, with the student's discounts applied per fee type.
 * Students imported from existing records don't get one: they were admitted long ago.
 */
export async function createFirstInvoice(tx: Tx, student: { id: string; gradeId: string }, yearId: string, discountIds: string[], today: string) {
  const structures = await tx.feeStructure.findMany({
    where: { yearId, gradeId: student.gradeId, feeType: { active: true, recurrence: { in: ["one_time", "monthly"] } } },
    include: { feeType: true },
    orderBy: { feeType: { recurrence: "desc" } },
  });
  if (!structures.length) return null;
  const discounts = discountIds.length ? await tx.discount.findMany({ where: { id: { in: discountIds } } }) : [];
  const period = today.slice(0, 7);
  const monthName = `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
  const lines = structures.map((s) => {
    const amount = Number(s.amount);
    const off = discounts
      .filter((d) => d.feeTypeId === s.feeTypeId)
      .reduce((sum, d) => sum + (d.kind === "percent" ? (amount * Number(d.value)) / 100 : Number(d.value)), 0);
    return {
      feeTypeId: s.feeTypeId,
      description: s.feeType.recurrence === "monthly" ? `${s.feeType.name} – ${monthName}` : s.feeType.name,
      amount,
      discount: Math.min(amount, Math.round(off)),
    };
  });
  const total = lines.reduce((sum, l) => sum + l.amount - l.discount, 0);
  return tx.invoice.create({
    data: {
      number: await nextInvoiceNumber(tx, today.slice(0, 4)),
      studentId: student.id,
      period,
      // One tuition invoice per student per month: the monthly run won't bill this month again.
      monthlyKey: structures.some((s) => s.feeType.recurrence === "monthly") ? `${student.id}|${period}` : null,
      issueDate: fromIsoDate(today),
      dueDate: fromIsoDate(addDays(today, PAYMENT_TERMS_DAYS)),
      total,
      status: total > 0 ? "unpaid" : "paid",
      lines: { create: lines },
    },
  });
}
