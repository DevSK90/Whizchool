// Invoicing rules: a new student's first invoice and the monthly tuition run.
import { randomUUID } from "node:crypto";
import { addDays, fromIsoDate } from "../dates";
import { reserveNumbers } from "../counters";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { nextInvoiceNumber } from "./fees";

type Tx = Prisma.TransactionClient;

const PAYMENT_TERMS_DAYS = 14;
/** Monthly invoices are issued on the 1st and fall due on this day of the month. */
export const MONTHLY_DUE_DAY = 10;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const monthName = (period: string) => `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;

type Structure = { feeTypeId: string; amount: Prisma.Decimal; feeType: { name: string; recurrence: string } };
type DiscountRow = { feeTypeId: string | null; kind: "percent" | "fixed"; value: Prisma.Decimal };

/** Invoice lines for fee structures, with the student's discounts applied per fee type (never below zero). */
export function feeLines(structures: Structure[], discounts: DiscountRow[], period: string) {
  return structures.map((s) => {
    const amount = Number(s.amount);
    const off = discounts
      .filter((d) => d.feeTypeId === s.feeTypeId)
      .reduce((sum, d) => sum + (d.kind === "percent" ? (amount * Number(d.value)) / 100 : Number(d.value)), 0);
    return {
      feeTypeId: s.feeTypeId,
      description: s.feeType.recurrence === "monthly" ? `${s.feeType.name} – ${monthName(period)}` : s.feeType.name,
      amount,
      discount: Math.min(amount, Math.round(off)),
    };
  });
}

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
  const lines = feeLines(structures, discounts, period);
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

/**
 * Bills every active student their grade's monthly fees for `period` ("2026-11"), discounts applied.
 * Safe to run any number of times: a student already billed for the month is skipped, and two runs
 * at once are serialised. Uses the current year's fee structures.
 */
export async function generateMonthlyInvoices(db: Db, period: string) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoices.monthly'))`;
      const school = await tx.school.findUniqueOrThrow({ where: { id: "school" }, select: { currentYearId: true } });
      const students = await tx.student.findMany({
        where: { status: "active" },
        select: { id: true, gradeId: true, discounts: { select: { discount: true } } },
        orderBy: [{ gradeId: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
      });
      const billed = new Set(
        (await tx.invoice.findMany({ where: { period, monthlyKey: { not: null } }, select: { monthlyKey: true } })).map((i) => i.monthlyKey),
      );
      const structures = await tx.feeStructure.findMany({
        where: { yearId: school.currentYearId!, amount: { gt: 0 }, feeType: { active: true, recurrence: "monthly" } },
        include: { feeType: true },
        orderBy: { feeType: { name: "asc" } },
      });
      const byGrade = new Map<string, typeof structures>();
      for (const s of structures) byGrade.set(s.gradeId, [...(byGrade.get(s.gradeId) ?? []), s]);
      const issueDate = fromIsoDate(`${period}-01`);
      const dueDate = fromIsoDate(`${period}-${String(MONTHLY_DUE_DAY).padStart(2, "0")}`);
      const invoices: Prisma.InvoiceCreateManyInput[] = [];
      const lines: Prisma.InvoiceLineCreateManyInput[] = [];
      for (const s of students) {
        const key = `${s.id}|${period}`;
        const forGrade = byGrade.get(s.gradeId);
        if (billed.has(key) || !forGrade) continue;
        const invoiceLines = feeLines(forGrade, s.discounts.map((d) => d.discount), period);
        const total = invoiceLines.reduce((sum, l) => sum + l.amount - l.discount, 0);
        const id = randomUUID();
        invoices.push({ id, number: "", studentId: s.id, period, monthlyKey: key, issueDate, dueDate, total, status: total > 0 ? "unpaid" : "paid" });
        lines.push(...invoiceLines.map((l) => ({ ...l, invoiceId: id })));
      }
      if (invoices.length) {
        const first = await reserveNumbers(tx, "invoiceNo", invoices.length, (await tx.invoice.count()) + 1);
        invoices.forEach((inv, i) => (inv.number = `INV-${period.slice(0, 4)}-${String(first + i).padStart(6, "0")}`));
        await tx.invoice.createMany({ data: invoices });
        await tx.invoiceLine.createMany({ data: lines });
      }
      await tx.eventLog.create({ data: { type: "invoices.monthly", data: { period, created: invoices.length } } });
      return { created: invoices.length };
    },
    { timeout: 120_000 },
  );
}

/** Whether the monthly run has already happened for a period (by the job or by hand). */
export async function monthlyRunDone(db: Db, period: string) {
  return (await db.eventLog.count({ where: { type: "invoices.monthly", data: { path: ["period"], equals: period } } })) > 0;
}
