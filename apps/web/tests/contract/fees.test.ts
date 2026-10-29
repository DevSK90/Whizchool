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

  it("charges a class, and voids only invoices without payments", async () => {
    await login("accountant");
    const classes: Json[] = await get("/classes");
    const tenA = classes.find((c) => c.name === "10-A");
    const feeTypes: Json[] = await get("/fee-types");
    const adHoc = feeTypes.find((f) => f.recurrence === "ad_hoc");
    const before = await get("/invoices", { classId: tenA.id, pageSize: 5 });
    const charged = await call("POST", "/invoices/charges", { target: { type: "class", ids: [tenA.id] }, feeTypeId: adHoc.id, description: "Science trip", amount: 1500, dueDate: "2026-12-01" });
    expect(charged.created).toBe(tenA.studentCount);
    const after = await get("/invoices", { classId: tenA.id, pageSize: 5 });
    expect(after.total).toBe(before.total + charged.created);
    const [student] = (await get("/students", { classId: tenA.id })).items;
    const fresh = (await get(`/students/${student.id}/invoices`)).find((i: Json) => i.lines[0].description === "Science trip");
    expect(fresh).toMatchObject({ status: "unpaid", balance: 1500 });

    await expectStatus(422, call("POST", `/invoices/${fresh.id}/void`, { reason: "" }));
    const voided = await call("POST", `/invoices/${fresh.id}/void`, { reason: "Trip cancelled" });
    expect(voided).toMatchObject({ status: "void", balance: 0 });
    await expectStatus(409, call("POST", `/invoices/${fresh.id}/void`, { reason: "Again" }));
    const paid = (await get("/invoices", { status: "paid", pageSize: 5 })).items[0];
    await expectStatus(409, call("POST", `/invoices/${paid.id}/void`, { reason: "Mistake" }));
    await expectStatus(422, call("POST", "/invoices/charges", { target: { type: "class", ids: [tenA.id] }, feeTypeId: adHoc.id, amount: 0, dueDate: "2026-12-01" }));
  });

  it("checks payments before recording them", async () => {
    const [defaulter] = await get("/fees/defaulters");
    const cheque = await expectStatus(422, call("POST", "/payments", { studentId: defaulter.studentId, amount: 500, method: "cheque" }));
    expect(cheque.fields.reference).toBeTruthy();
    await expectStatus(422, call("POST", "/payments", { studentId: defaulter.studentId, amount: 500, method: "payhere" }));
    await expectStatus(422, call("POST", "/payments", { studentId: defaulter.studentId, amount: -5, method: "cash" }));
    const slip = await call("POST", "/payments", { studentId: defaulter.studentId, amount: 500, method: "bank_deposit", reference: "BOC-77812" });
    expect(slip).toMatchObject({ method: "bank_deposit", reference: "BOC-77812", status: "completed", amount: 500 });
    const receipt = await get(`/payments/${slip.id}`);
    expect(receipt.school.name).toBeTruthy();
    const listed = await get("/payments", { search: "BOC-77812" });
    expect(listed.items.map((p: Json) => p.id)).toContain(slip.id);
  });

  it("keeps the fee setup consistent", async () => {
    await login("admin");
    const feeType = await call("POST", "/fee-types", { name: "Sports fee", recurrence: "one_time" });
    await expectStatus(409, call("POST", "/fee-types", { name: "Sports fee", recurrence: "one_time" }));
    const off = await call("PUT", `/fee-types/${feeType.id}`, { name: "Sports fee", active: false });
    expect(off.active).toBe(false);
    await expectStatus(422, call("POST", "/discounts", { name: "Too generous", kind: "percent", value: 150 }));
    const discount = await call("POST", "/discounts", { name: "Prefect", kind: "percent", value: 10 });
    expect(discount.feeTypeId).toBeTruthy();

    const grades: Json[] = await get("/grades");
    const structure = await call("PUT", "/fee-structures", { items: [{ gradeId: grades[0].id, feeTypeId: feeType.id, amount: 2500 }] });
    expect(structure.find((s: Json) => s.feeTypeId === feeType.id)).toMatchObject({ gradeId: grades[0].id, amount: 2500 });
    await expectStatus(422, call("PUT", "/fee-structures", { items: [{ gradeId: grades[0].id, feeTypeId: feeType.id, amount: -1 }] }));
  });

  it("reminds defaulters' parents by SMS", async () => {
    const list: Json[] = await get("/fees/defaulters");
    const picked = list.slice(0, 2).map((d) => d.studentId);
    const reminded = await call("POST", "/fees/defaulters/remind", { studentIds: picked });
    expect(reminded.sent).toBe(2);
    const again: Json[] = await get("/fees/defaulters");
    expect(again.filter((d) => picked.includes(d.studentId)).every((d) => d.lastReminderAt)).toBe(true);
    const messages = await get("/messages", { kind: "fee_reminder" });
    expect(messages.items[0].recipients).toBe(2);
    const summary = await get("/fees/summary");
    expect(summary.monthly).toHaveLength(10);
    expect(summary.outstanding).toBeGreaterThan(0);
    expect(summary.defaulters).toBe(again.length);
  });

  it("keeps parents to their own children's fees", async () => {
    await login("accountant");
    const someone = (await get("/invoices", { pageSize: 5 })).items[0];
    await login("parent");
    await expectStatus(403, get("/invoices"));
    const [child] = await get("/portal/children");
    if (someone.studentId !== child.id) {
      await expectStatus(403, get(`/invoices/${someone.id}`));
      await expectStatus(403, call("POST", "/payhere/checkout", { invoiceIds: [someone.id] }));
    }
  });

  it("leaves the balance alone when a parent cancels on PayHere", async () => {
    const [child] = await get("/portal/children");
    const open = (await get(`/students/${child.id}/invoices`)).filter((i: Json) => i.balance > 0);
    const checkout = await call("POST", "/payhere/checkout", { invoiceIds: [open[0].id] });
    expect(checkout.amount).toBe(open[0].balance);
    await call("POST", `/payhere/sandbox/${checkout.orderId}/complete`, { outcome: "cancelled" });
    expect((await get(`/payhere/orders/${checkout.orderId}`)).status).toBe("cancelled");
    expect((await get("/portal/children")).find((c: Json) => c.id === child.id).balance).toBe(child.balance);
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
