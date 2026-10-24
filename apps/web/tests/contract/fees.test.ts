import { beforeAll, describe, expect, it } from "vitest";
import { call, expectStatus, get, login, resetData, type Json } from "./helpers";

beforeAll(() => resetData());

describe("fees", () => {
  it("records a cash payment against the oldest invoice first, once per key", async () => {
    await login("accountant");
    const [defaulter] = await get("/fees/defaulters");
    const invoices: Json[] = await get(`/students/${defaulter.studentId}/invoices`);
    const oldest = invoices.filter((i) => i.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const body = { studentId: defaulter.studentId, amount: Math.min(1000, oldest.balance), method: "cash", paidAt: "2026-10-24" };
    const payment = await call("POST", "/payments", body, undefined, "pay-1");
    const retry = await call("POST", "/payments", body, undefined, "pay-1");
    expect(retry.id).toBe(payment.id);
    expect(payment.allocations[0].invoiceNumber).toBe(oldest.number);
    expect((await get(`/students/${defaulter.studentId}`)).balance).toBe(defaulter.balance - body.amount);

    await expectStatus(422, call("POST", "/payments", { studentId: defaulter.studentId, amount: 99_999_999, method: "cash" }));
    await call("POST", `/payments/${payment.id}/reverse`, { reason: "Entered twice" });
    expect((await get(`/students/${defaulter.studentId}`)).balance).toBe(defaulter.balance);
  });

  it("generates monthly invoices idempotently", async () => {
    const first = await call("POST", "/invoices/generate-monthly", { period: "2026-11" });
    const again = await call("POST", "/invoices/generate-monthly", { period: "2026-11" });
    expect(first.created).toBeGreaterThan(0);
    expect(again.created).toBe(0);
  });

  it("keeps accountants out of user management", async () => {
    await expectStatus(403, get("/users"));
  });

  it("lets a parent pay online through the PayHere sandbox", async () => {
    await login("parent");
    const [child] = await get("/portal/children");
    const open = (await get(`/students/${child.id}/invoices`)).filter((i: Json) => i.balance > 0);
    expect(open.length).toBeGreaterThan(0);
    const checkout = await call("POST", "/payhere/checkout", { invoiceIds: open.map((i: Json) => i.id) });
    await call("POST", `/payhere/sandbox/${checkout.orderId}/complete`, { outcome: "success" });
    const order = await get(`/payhere/orders/${checkout.orderId}`);
    expect(order.status).toBe("success");
    expect((await get(`/payments/${order.paymentId}`)).receiptNo).toBeTruthy();
    const after = (await get("/portal/children")).find((c: Json) => c.id === child.id);
    expect(after.balance).toBe(0);
  });
});
