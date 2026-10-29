import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import type { PayHereCheckout } from "@whizchool/shared/types";
import type { AuthContext } from "../auth/context";
import { canSeeStudent } from "../auth/scope";
import { config } from "../config";
import { prisma } from "../db";
import { defineRoute } from "../http/route";
import { schoolName } from "../school";
import { createCheckout, fakeNotify, handleNotify, type NotifyPayload } from "../services/payhere";
import { fullName } from "../students";

/** Parents pay for their own children; staff may open a checkout for any student. */
function assertCanPay(auth: AuthContext, student: { id: string; classId: string }, perm: "payments.create" | "payments.view") {
  if (auth.session.kind === "parent" ? !canSeeStudent(auth, student) : !auth.session.permissions.includes(perm)) {
    throw new ApiError(403, "forbidden", "You can only pay your own children's fees.");
  }
}

async function loadOrder(auth: AuthContext, id: string, perm: "payments.create" | "payments.view") {
  const order = await prisma.payHereOrder.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, classId: true, firstName: true, lastName: true } },
      invoices: { include: { invoice: { select: { number: true } } } },
      payment: { select: { id: true, receiptNo: true } },
    },
  });
  if (!order) throw new ApiError(404, "not_found", "Order not found.");
  assertCanPay(auth, order.student, perm);
  return order;
}

const fakeRoutes = [
  defineRoute({
    method: "POST",
    path: "/payhere/sandbox/:id/complete",
    access: "session",
    summary: "Development only: finish a checkout on the app's own PayHere stand-in",
    body: z.object({ outcome: z.enum(["success", "failed", "cancelled"]) }),
    handler: async ({ auth, params, body }) => {
      await loadOrder(auth, params.id, "payments.create");
      return { status: await fakeNotify(params.id, body.outcome) };
    },
  }),
];

export const payhereRoutes = [
  defineRoute({
    method: "POST",
    path: "/payhere/checkout",
    access: "session",
    summary: "Start an online payment for some of one student's invoices: an order and the signed PayHere form",
    idempotent: true,
    body: z.object({ invoiceIds: z.array(z.string().max(100)).min(1, "Select at least one invoice to pay").max(60) }),
    handler: async ({ auth, body }): Promise<PayHereCheckout> => {
      const invoices = await prisma.invoice.findMany({ where: { id: { in: body.invoiceIds } }, select: { studentId: true, student: { select: { id: true, classId: true } } } });
      if (!invoices.length) throw new ApiError(422, "validation", "Select at least one invoice to pay.");
      if (new Set(invoices.map((i) => i.studentId)).size > 1) throw new ApiError(422, "validation", "Pay one child's invoices at a time.");
      assertCanPay(auth, invoices[0]!.student, "payments.create");
      return createCheckout(invoices[0]!.studentId, body.invoiceIds, auth.session.id);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/payhere/orders/:id",
    access: "session",
    summary: "An online payment's progress (the page PayHere returns the parent to polls this)",
    handler: async ({ auth, params }) => {
      const order = await loadOrder(auth, params.id, "payments.view");
      return {
        id: order.id,
        studentId: order.studentId,
        invoiceIds: order.invoices.map((i) => i.invoiceId),
        amount: Number(order.amount),
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        studentName: fullName(order.student),
        invoiceNumbers: order.invoices.map((i) => i.invoice.number),
        ...(order.payment ? { receiptNo: order.payment.receiptNo, paymentId: order.payment.id } : {}),
        merchant: await schoolName(),
      };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/payhere/notify",
    access: "public",
    bodyType: "form",
    summary: "PayHere's server-to-server payment notification (checked by its md5sig)",
    body: z.record(z.string(), z.string()),
    handler: async ({ body }) => ({ status: await handleNotify(body as NotifyPayload) }),
  }),
  ...(config.PAYHERE_MODE === "fake" ? fakeRoutes : []),
];
