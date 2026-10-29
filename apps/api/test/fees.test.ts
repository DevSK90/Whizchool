import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { config } from "../src/config";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/http/rate-limit";
import { monthlyInvoicesDue } from "../src/jobs/maintenance";
import { cents } from "../src/services/fees";
import { generateMonthlyInvoices } from "../src/services/invoices";
import { expireOrders, notifySignature } from "../src/services/payhere";
import { app, signIn, unique } from "./helpers";
import request from "supertest";

beforeEach(() => resetRateLimits());

const md5 = (s: string) => createHash("md5").update(s).digest("hex").toUpperCase();

/** A student with unpaid invoices, and what they owe. */
async function debtor(skip = 0) {
  const inv = await prisma.invoice.findMany({
    where: { status: { in: ["unpaid", "partial"] }, student: { status: "active" } },
    distinct: ["studentId"],
    orderBy: { studentId: "asc" },
    skip,
    take: 1,
    select: { studentId: true },
  });
  const studentId = inv[0]!.studentId;
  const open = await prisma.invoice.findMany({ where: { studentId, status: { in: ["unpaid", "partial"] } }, orderBy: { dueDate: "asc" } });
  return { studentId, open, owedCents: open.reduce((s, i) => s + cents(i.total) - cents(i.paid), 0) };
}

/** PayHere's notification, form-encoded and signed (or not) the way PayHere signs it. */
function notify(orderId: string, amount: string, statusCode = "2", sign = true) {
  const fields = { merchant_id: config.PAYHERE_MERCHANT_ID, order_id: orderId, payment_id: `PH${unique()}`, payhere_amount: amount, payhere_currency: "LKR", status_code: statusCode };
  return request(app).post("/api/v1/payhere/notify").type("form").send({ ...fields, md5sig: sign ? notifySignature(fields) : "0".repeat(32) });
}

async function checkout(studentId: string, invoiceIds: string[]) {
  const accountant = await signIn("accountant@whizchool.lk");
  const res = await accountant.post("/api/v1/payhere/checkout").send({ invoiceIds });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { orderId: string; amount: number; actionUrl: string; fields: Record<string, string> };
}

describe("PayHere", () => {
  it("signs the checkout form the way PayHere checks it", async () => {
    const d = await debtor();
    const c = await checkout(d.studentId, d.open.map((i) => i.id));
    expect(c.amount * 100).toBe(d.owedCents);
    expect(c.fields).toMatchObject({ merchant_id: config.PAYHERE_MERCHANT_ID, order_id: c.orderId, currency: "LKR", amount: (d.owedCents / 100).toFixed(2), country: "Sri Lanka" });
    expect(c.fields.amount).not.toContain(",");
    expect(c.fields.hash).toBe(md5(`${config.PAYHERE_MERCHANT_ID}${c.orderId}${c.fields.amount}LKR${md5(config.PAYHERE_MERCHANT_SECRET)}`));
    expect(c.fields.notify_url).toBe(`${config.PUBLIC_API_URL}/api/v1/payhere/notify`);
    expect(c.fields.return_url).toContain(`/portal/pay/result?order=${c.orderId}`);
    expect(c.actionUrl).toBe(`/portal/pay/sandbox?order=${c.orderId}`);
  });

  it("records a verified payment exactly once, and refuses a forged one", async () => {
    const d = await debtor(1);
    const c = await checkout(d.studentId, d.open.map((i) => i.id));
    const amount = c.fields.amount!;

    const forged = await notify(c.orderId, amount, "2", false);
    expect(forged.status).toBe(400);
    expect(await prisma.payment.count({ where: { reference: c.orderId } })).toBe(0);
    expect(await prisma.eventLog.count({ where: { type: "payhere.bad_signature", data: { path: ["orderId"], equals: c.orderId } } })).toBe(1);

    // PayHere may send the same notification more than once.
    const [a, b] = await Promise.all([notify(c.orderId, amount), notify(c.orderId, amount)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const payments = await prisma.payment.findMany({ where: { reference: c.orderId }, include: { allocations: true } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: "payhere", status: "completed" });
    expect(payments[0]!.allocations.reduce((s, x) => s + cents(x.amount), 0)).toBe(d.owedCents);
    expect(await prisma.invoice.count({ where: { studentId: d.studentId, status: { in: ["unpaid", "partial"] } } })).toBe(0);
    const order = await prisma.payHereOrder.findUniqueOrThrow({ where: { id: c.orderId } });
    expect(order).toMatchObject({ status: "success", paymentId: payments[0]!.id, statusCode: 2 });
  });

  it("still records money taken after the checkout expired, and keeps any excess for the accountant", async () => {
    const d = await debtor(2);
    const c = await checkout(d.studentId, [d.open[0]!.id]);
    await prisma.payHereOrder.update({ where: { id: c.orderId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireOrders()).toBeGreaterThanOrEqual(1);
    expect((await prisma.payHereOrder.findUniqueOrThrow({ where: { id: c.orderId } })).status).toBe("cancelled");

    // Meanwhile the parent paid that invoice in cash, then PayHere reports success after all.
    const accountant = await signIn("accountant@whizchool.lk");
    const first = d.open[0]!;
    const cash = await accountant.post("/api/v1/payments").send({ studentId: d.studentId, amount: (cents(first.total) - cents(first.paid)) / 100, method: "cash" });
    expect(cash.status).toBe(200);
    expect((await notify(c.orderId, c.fields.amount!)).status).toBe(200);

    const payment = await prisma.payment.findFirstOrThrow({ where: { reference: c.orderId }, include: { allocations: true } });
    expect(cents(payment.amount)).toBe(Math.round(c.amount * 100));
    const allocated = payment.allocations.reduce((s, x) => s + cents(x.amount), 0);
    expect(allocated).toBe(Math.min(cents(payment.amount), d.owedCents - Math.round(c.amount * 100)));
    expect((await prisma.payHereOrder.findUniqueOrThrow({ where: { id: c.orderId } })).status).toBe("success");
    if (allocated < cents(payment.amount)) {
      expect(await prisma.eventLog.count({ where: { type: "payment.unallocated", data: { path: ["paymentId"], equals: payment.id } } })).toBe(1);
    }
  });

  it("marks a cancelled checkout without touching the invoices", async () => {
    const d = await debtor(3);
    const c = await checkout(d.studentId, [d.open[0]!.id]);
    expect((await notify(c.orderId, c.fields.amount!, "-1")).body.status).toBe("cancelled");
    expect((await notify(c.orderId, c.fields.amount!, "-2")).body.status).toBe("cancelled");
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: d.open[0]!.id } });
    expect(cents(inv.paid)).toBe(cents(d.open[0]!.paid));
  });
});

describe("payments", () => {
  it("can't collect the same balance twice when two payments race", async () => {
    const d = await debtor(4);
    const accountant = await signIn("accountant@whizchool.lk");
    const body = { studentId: d.studentId, amount: d.owedCents / 100, method: "cash" };
    const results = await Promise.all([accountant.post("/api/v1/payments").send(body), accountant.post("/api/v1/payments").send(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  });

  it("reverses a payment: its invoices are owed again", async () => {
    const d = await debtor(5);
    const accountant = await signIn("accountant@whizchool.lk");
    const paid = await accountant.post("/api/v1/payments").send({ studentId: d.studentId, amount: d.owedCents / 100, method: "cheque", reference: "CHQ 001234" });
    expect(paid.status).toBe(200);
    expect(paid.body.receiptNo).toMatch(/^RCT-\d{4}-\d{6}$/);
    expect(await prisma.invoice.count({ where: { studentId: d.studentId, status: { in: ["unpaid", "partial"] } } })).toBe(0);

    const teacher = await signIn("teacher@whizchool.lk");
    expect((await teacher.post(`/api/v1/payments/${paid.body.id}/reverse`).send({ reason: "Cheque bounced" })).status).toBe(403);
    const admin = await signIn("admin@whizchool.lk");
    const reversed = await admin.post(`/api/v1/payments/${paid.body.id}/reverse`).send({ reason: "Cheque bounced" });
    expect(reversed.body.status).toBe("reversed");
    for (const before of d.open) {
      const now = await prisma.invoice.findUniqueOrThrow({ where: { id: before.id } });
      expect([now.status, cents(now.paid)]).toEqual([before.status, cents(before.paid)]);
    }
    expect((await admin.post(`/api/v1/payments/${paid.body.id}/reverse`).send({ reason: "Again" })).status).toBe(409);
  });
});

describe("monthly invoices", () => {
  it("bills each active student once per month, with their discounts, even when runs overlap", async () => {
    const period = "2027-03";
    const students = await prisma.student.count({ where: { status: "active" } });
    const runs = await Promise.all([generateMonthlyInvoices(prisma, period), generateMonthlyInvoices(prisma, period)]);
    expect(runs.map((r) => r.created).sort((a, b) => a - b)).toEqual([0, students]);
    expect(await prisma.invoice.count({ where: { period } })).toBe(students);
    expect((await generateMonthlyInvoices(prisma, period)).created).toBe(0);

    // Gap-free numbers.
    const numbers = (await prisma.invoice.findMany({ where: { period }, select: { number: true } })).map((i) => Number(i.number.slice(-6))).sort((a, b) => a - b);
    expect(numbers.at(-1)! - numbers[0]!).toBe(students - 1);

    const discounted = await prisma.student.findFirstOrThrow({ where: { status: "active", discounts: { some: {} } }, include: { discounts: { include: { discount: true } } } });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { period, studentId: discounted.id }, include: { lines: true } });
    const tuition = inv.lines.find((l) => discounted.discounts.some((d) => d.discount.feeTypeId === l.feeTypeId))!;
    expect(cents(tuition.discount)).toBeGreaterThan(0);
    expect(cents(inv.total)).toBe(inv.lines.reduce((s, l) => s + cents(l.amount) - cents(l.discount), 0));
    expect(inv.dueDate.toISOString().slice(0, 10)).toBe(`${period}-10`);
  });

  it("is run by the daily job only once a month", async () => {
    const period = new Date().toISOString().slice(0, 7);
    await prisma.eventLog.create({ data: { type: "invoices.monthly", data: { period, created: 0 } } }).catch(() => undefined);
    expect(await monthlyInvoicesDue()).toBeNull();
  });

  it("doesn't bill a voided month again", async () => {
    const period = "2027-03";
    const inv = await prisma.invoice.findFirstOrThrow({ where: { period, status: "unpaid" } });
    const admin = await signIn("admin@whizchool.lk");
    expect((await admin.post(`/api/v1/invoices/${inv.id}/void`).send({ reason: "Wrong discount" })).status).toBe(200);
    expect((await generateMonthlyInvoices(prisma, period)).created).toBe(0);
  });
});

describe("invoice balances", () => {
  // Last in the file, so the payments, reversals and voids above have all happened.
  it("keep up with every payment, reversal and void, so lists can sort by what's owed", async () => {
    const d = await debtor(6);
    const accountant = await signIn("accountant@whizchool.lk");
    expect((await accountant.post("/api/v1/payments").send({ studentId: d.studentId, amount: 100, method: "cash" })).status).toBe(200);
    const [{ wrong }] = await prisma.$queryRaw<{ wrong: number }[]>`
      SELECT count(*)::int AS "wrong" FROM "Invoice" WHERE "balance" <> CASE WHEN "status" = 'void' THEN 0 ELSE "total" - "paid" END`;
    expect(wrong).toBe(0);
    expect(await prisma.invoice.count({ where: { status: "void" } })).toBeGreaterThan(0);

    const list = await accountant.get("/api/v1/invoices?sort=-balance&pageSize=50&status=all");
    const balances: number[] = list.body.items.map((i: { balance: number }) => i.balance);
    expect(balances).toEqual([...balances].sort((a, b) => b - a));
    const top = await prisma.invoice.aggregate({ _max: { balance: true } });
    expect(balances[0]).toBe(Number(top._max.balance));
  });
});
