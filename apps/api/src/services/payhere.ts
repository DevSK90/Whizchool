// PayHere Checkout (https://support.payhere.lk/api-&-mobile-sdk/checkout-api). The browser posts a
// signed form to PayHere; PayHere then calls notify_url server-to-server, and only that verified
// notification records a payment. The return_url page just shows the order's state.
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "@whizchool/shared/api";
import type { PayHereCheckout } from "@whizchool/shared/types";
import { audit } from "../audit";
import { config } from "../config";
import { nextNumber } from "../counters";
import { prisma } from "../db";
import { logger } from "../logger";
import { fullName } from "../students";
import { cents, recordPayment, rupees } from "./fees";

/** A checkout the parent hasn't finished in this time is closed (a late success notification still counts). */
export const ORDER_TTL_MINUTES = 60;

const ACTION_URLS = { sandbox: "https://sandbox.payhere.lk/pay/checkout", live: "https://www.payhere.lk/pay/checkout" };

const md5 = (s: string) => createHash("md5").update(s).digest("hex").toUpperCase();
const secretHash = () => md5(config.PAYHERE_MERCHANT_SECRET);
/** PayHere's amount format: two decimals, no thousands separator. */
export const payhereAmount = (amountCents: number) => rupees(amountCents).toFixed(2);

export const checkoutHash = (orderId: string, amount: string, currency: string) =>
  md5(`${config.PAYHERE_MERCHANT_ID}${orderId}${amount}${currency}${secretHash()}`);

export interface NotifyPayload {
  merchant_id: string;
  order_id: string;
  payment_id?: string;
  payhere_amount: string;
  payhere_currency: string;
  status_code: string;
  md5sig: string;
  [field: string]: string | undefined;
}

export const notifySignature = (p: Pick<NotifyPayload, "merchant_id" | "order_id" | "payhere_amount" | "payhere_currency" | "status_code">) =>
  md5(`${p.merchant_id}${p.order_id}${p.payhere_amount}${p.payhere_currency}${p.status_code}${secretHash()}`);

function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Opens a checkout for some of one student's invoices: the order and the signed form for PayHere. */
export async function createCheckout(studentId: string, invoiceIds: string[], createdById: string): Promise<PayHereCheckout> {
  const order = await prisma.$transaction(async (tx) => {
    const invoices = await tx.invoice.findMany({ where: { id: { in: invoiceIds }, studentId, status: { in: ["unpaid", "partial"] } } });
    const amountCents = invoices.reduce((sum, i) => sum + cents(i.total) - cents(i.paid), 0);
    if (!invoices.length || amountCents <= 0) throw new ApiError(409, "already_paid", "These invoices are already paid.");
    const n = await nextNumber(tx, "orderNo", 50_001);
    return tx.payHereOrder.create({
      data: {
        id: `ORD-${n}`,
        studentId,
        amount: rupees(amountCents),
        createdById,
        expiresAt: new Date(Date.now() + ORDER_TTL_MINUTES * 60_000),
        invoices: { create: invoices.map((i) => ({ invoiceId: i.id })) },
      },
      include: {
        invoices: { include: { invoice: { select: { number: true } } } },
        student: {
          select: {
            lastName: true,
            address: true,
            guardians: { orderBy: { position: "asc" }, take: 1, select: { guardian: { select: { name: true, email: true, phone: true, address: true } } } },
          },
        },
      },
    });
  });
  const amount = payhereAmount(cents(order.amount));
  const payer = order.student.guardians[0]?.guardian;
  const [first, ...rest] = (payer?.name ?? "Parent").replace(/^(Mr|Mrs|Ms|Miss|Dr|Rev)\.?\s+/i, "").split(/\s+/);
  const address = payer?.address || order.student.address;
  const resultUrl = `${config.APP_URL}/portal/pay/result?order=${order.id}`;
  return {
    orderId: order.id,
    amount: Number(amount),
    currency: "LKR",
    actionUrl: config.PAYHERE_MODE === "fake" ? `/portal/pay/sandbox?order=${order.id}` : ACTION_URLS[config.PAYHERE_MODE],
    fields: {
      merchant_id: config.PAYHERE_MERCHANT_ID,
      return_url: resultUrl,
      cancel_url: resultUrl,
      notify_url: `${config.PUBLIC_API_URL}/api/v1/payhere/notify`,
      order_id: order.id,
      items: order.invoices.map((i) => i.invoice.number).join(", "),
      currency: "LKR",
      amount,
      first_name: first ?? "Parent",
      last_name: rest.join(" ") || order.student.lastName,
      email: payer?.email ?? "",
      phone: payer?.phone ?? "",
      address,
      city: address.split(",").pop()?.trim() || "Sri Lanka",
      country: "Sri Lanka",
      hash: checkoutHash(order.id, amount, "LKR"),
    },
  };
}

const STATUS = { "2": "success", "0": "pending", "-1": "cancelled", "-2": "failed", "-3": "chargedback" } as const;

/**
 * Handles PayHere's notification for an order. Signature first; then a success records the payment
 * exactly once (repeat notifications are acknowledged and ignored). Returns the order's status.
 */
export async function handleNotify(p: NotifyPayload) {
  const fields = ["merchant_id", "order_id", "payhere_amount", "payhere_currency", "status_code", "md5sig"] as const;
  if (fields.some((f) => typeof p[f] !== "string")) throw new ApiError(400, "bad_request", "Missing PayHere fields.");
  if (p.merchant_id !== config.PAYHERE_MERCHANT_ID || !sameText(p.md5sig.toUpperCase(), notifySignature(p))) {
    await prisma.eventLog.create({ data: { type: "payhere.bad_signature", data: { orderId: p.order_id, merchantId: p.merchant_id } } });
    logger.warn({ orderId: p.order_id }, "PayHere notification with a bad signature");
    throw new ApiError(400, "bad_signature", "Signature check failed.");
  }
  const outcome = STATUS[p.status_code as keyof typeof STATUS];
  const payload = Object.fromEntries(Object.entries(p).filter(([k]) => !["card_no", "card_holder_name", "card_expiry"].includes(k)));
  return prisma.$transaction(async (tx) => {
    const [order] = await tx.$queryRaw<{ id: string; status: string; paymentId: string | null; studentId: string; amount: string }[]>`
      SELECT "id", "status", "paymentId", "studentId", "amount"::text FROM "PayHereOrder" WHERE "id" = ${p.order_id} FOR UPDATE`;
    if (!order) {
      await tx.eventLog.create({ data: { type: "payhere.unknown_order", data: payload } });
      return "unknown";
    }
    const seen = { payherePaymentId: p.payment_id ?? null, statusCode: Number(p.status_code), notifyPayload: payload };
    if (outcome === "success") {
      if (order.paymentId) return "success"; // a repeat notification
      if (p.payhere_currency !== "LKR") {
        await tx.eventLog.create({ data: { type: "payhere.wrong_currency", data: payload } });
        return order.status;
      }
      const amountCents = cents(p.payhere_amount);
      const invoiceIds = (await tx.payHereOrderInvoice.findMany({ where: { orderId: order.id }, select: { invoiceId: true } })).map((i) => i.invoiceId);
      // The money has been taken, so it's recorded even if the order had expired or the invoices
      // were settled another way meanwhile; anything left over waits for the accountant.
      const { payment, unallocatedCents } = await recordPayment(tx, {
        studentId: order.studentId,
        amountCents,
        method: "payhere",
        reference: order.id,
        paidAt: new Date(),
        recordedBy: "PayHere (online)",
        first: invoiceIds,
        allowExcess: true,
      });
      await tx.payHereOrder.update({ where: { id: order.id }, data: { ...seen, status: "success", completedAt: new Date(), paymentId: payment.id } });
      if (amountCents !== cents(order.amount) || unallocatedCents > 0) {
        await tx.eventLog.create({
          data: { type: "payment.unallocated", data: { paymentId: payment.id, orderId: order.id, ordered: rupees(cents(order.amount)), paid: rupees(amountCents), unallocated: rupees(unallocatedCents) } },
        });
      }
      const student = await tx.student.findUniqueOrThrow({ where: { id: order.studentId }, select: { firstName: true, lastName: true } });
      await audit(tx, null, {
        action: "payment.payhere",
        entity: "Payment",
        entityId: payment.id,
        summary: `PayHere payment ${payment.receiptNo} (${rupees(amountCents).toFixed(2)}) for ${fullName(student)}`,
      });
      await tx.eventLog.create({ data: { type: "payment.received", data: { paymentId: payment.id, method: "payhere", amount: rupees(amountCents) } } });
      return "success";
    }
    if (outcome === "chargedback") {
      await tx.eventLog.create({ data: { type: "payhere.chargeback", data: { orderId: order.id, paymentId: order.paymentId } } });
      await tx.payHereOrder.update({ where: { id: order.id }, data: seen });
      return order.status;
    }
    // Pending, cancelled or failed: only an order still waiting changes.
    const status = outcome === "cancelled" || outcome === "failed" ? outcome : undefined;
    await tx.payHereOrder.update({ where: { id: order.id }, data: { ...seen, ...(status && order.status === "pending" ? { status } : {}) } });
    return status && order.status === "pending" ? status : order.status;
  });
}

/** Development stand-in for PayHere: signs a notification the way PayHere would and handles it. */
export async function fakeNotify(orderId: string, outcome: "success" | "failed" | "cancelled") {
  const order = await prisma.payHereOrder.findUniqueOrThrow({ where: { id: orderId } });
  const fields = {
    merchant_id: config.PAYHERE_MERCHANT_ID,
    order_id: order.id,
    payment_id: `FAKE${Date.now()}`,
    payhere_amount: payhereAmount(cents(order.amount)),
    payhere_currency: "LKR",
    status_code: { success: "2", failed: "-2", cancelled: "-1" }[outcome],
    method: "VISA",
  };
  return handleNotify({ ...fields, md5sig: notifySignature(fields) });
}

/** Closes checkouts nobody finished (run by the minutely sweep). */
export async function expireOrders() {
  const { count } = await prisma.payHereOrder.updateMany({ where: { status: "pending", expiresAt: { lt: new Date() } }, data: { status: "cancelled" } });
  return count;
}
