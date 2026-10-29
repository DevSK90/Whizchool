import { format, parseISO, subMonths } from "date-fns";
import type { Route } from "../router";
import type { Defaulter, FeesSummary, Invoice, Payment, PaymentMethod, PayHereCheckout } from "@whizchool/shared/types";
import {
  audit,
  canSeeStudent,
  className,
  fail,
  fullName,
  isoNow,
  matches,
  paginate,
  requireAuth,
  requirePerm,
  sortRows,
  todayISO,
  toInvoiceListItem,
  type Ctx,
} from "../helpers";
import { nextId, nextNumber, type DB } from "../db";

const METHODS: PaymentMethod[] = ["cash", "cheque", "bank_deposit", "payhere"];

function recompute(inv: Invoice) {
  inv.balance = inv.total - inv.paid;
  inv.status = inv.status === "void" ? "void" : inv.paid <= 0 ? "unpaid" : inv.balance <= 0 ? "paid" : "partial";
}

/** Applies a payment to the student's open invoices, oldest due date first. */
function allocate(db: DB, studentId: string, amount: number, invoiceIds?: string[]) {
  const open = db.invoices.rows
    .filter((i) => i.studentId === studentId && i.balance > 0 && i.status !== "void" && (!invoiceIds || invoiceIds.includes(i.id)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
  let left = amount;
  const allocations: Payment["allocations"] = [];
  for (const inv of open) {
    if (left <= 0) break;
    const take = Math.min(left, inv.balance);
    inv.paid += take;
    recompute(inv);
    allocations.push({ invoiceId: inv.id, invoiceNumber: inv.number, amount: take });
    left -= take;
  }
  return allocations;
}

function receipt(db: DB, ctx: Ctx, p: Omit<Payment, "id" | "receiptNo">) {
  const year = ctx.now.getFullYear();
  return db.payments.insert({ ...p, id: nextId(db, "pay"), receiptNo: `RCT-${year}-${String(nextNumber(db, "receiptNo")).padStart(6, "0")}` });
}

function toPaymentListItem(db: DB, p: Payment) {
  const s = db.students.get(p.studentId)!;
  return { ...p, studentName: fullName(s), admissionNo: s.admissionNo, className: className(db, s.classId) };
}

function iso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function defaulters(db: DB, today: string): Defaulter[] {
  const cutoff = iso(new Date(new Date(`${today}T12:00:00`).getTime() - 30 * 86400000));
  const byStudent = new Map<string, Invoice[]>();
  for (const inv of db.invoices.rows) {
    if (inv.balance <= 0 || inv.status === "void" || inv.dueDate >= today) continue;
    byStudent.set(inv.studentId, [...(byStudent.get(inv.studentId) ?? []), inv]);
  }
  const rows: Defaulter[] = [];
  for (const [studentId, invs] of byStudent) {
    const oldest = invs.map((i) => i.dueDate).sort()[0];
    if (oldest > cutoff) continue;
    const s = db.students.get(studentId)!;
    if (s.status !== "active") continue;
    const g = db.guardians.get(s.guardianIds[0]);
    rows.push({
      studentId, admissionNo: s.admissionNo, fullName: fullName(s), className: className(db, s.classId),
      guardianName: g?.name, guardianPhone: g?.phone, overdueInvoices: invs.length,
      balance: invs.reduce((a, i) => a + i.balance, 0), oldestDueDate: oldest, lastReminderAt: db.reminders.get(studentId),
    });
  }
  return rows.sort((a, b) => b.balance - a.balance);
}

export function feesSummary(db: DB, today: string): FeesSummary {
  const thisMonth = today.slice(0, 7);
  const lastMonth = format(subMonths(parseISO(`${thisMonth}-01`), 1), "yyyy-MM");
  const completed = db.payments.rows.filter((p) => p.status === "completed");
  const sumMonth = (m: string) => completed.filter((p) => p.paidAt.slice(0, 7) === m).reduce((a, p) => a + p.amount, 0);
  const months = Array.from({ length: 10 }, (_, i) => format(subMonths(parseISO(`${thisMonth}-01`), 9 - i), "yyyy-MM"));
  const open = db.invoices.rows.filter((i) => i.status !== "void" && i.balance > 0);
  return {
    collectedThisMonth: sumMonth(thisMonth),
    collectedLastMonth: sumMonth(lastMonth),
    outstanding: open.reduce((a, i) => a + i.balance, 0),
    overdueInvoices: open.filter((i) => i.dueDate < today).length,
    defaulters: defaulters(db, today).length,
    monthly: months.map((m) => ({
      month: m,
      label: format(parseISO(`${m}-01`), "MMM"),
      billed: db.invoices.rows.filter((i) => i.status !== "void" && i.issueDate.slice(0, 7) === m).reduce((a, i) => a + i.total, 0),
      collected: sumMonth(m),
    })),
    byMethod: METHODS.map((method) => ({
      method,
      amount: completed.filter((p) => p.method === method && p.paidAt.slice(0, 7) === thisMonth).reduce((a, p) => a + p.amount, 0),
    })),
  };
}

function assertInvoiceAccess(ctx: Ctx, inv: Invoice) {
  const s = requireAuth(ctx);
  if (s.kind === "parent") {
    if (!canSeeStudent(ctx, inv.studentId)) fail(403, "forbidden", "You can only view your own invoices.");
  } else if (!s.permissions.includes("fees.view")) {
    fail(403, "forbidden", "You don't have access to fees.");
  }
}

export const feeRoutes: Route[] = [
  { method: "GET", path: "/fees/summary", handler: (ctx) => (requirePerm(ctx, "fees.view"), feesSummary(ctx.db, todayISO(ctx))) },
  {
    method: "GET",
    path: "/invoices",
    handler: (ctx) => {
      requirePerm(ctx, "fees.view");
      const db = ctx.db;
      const today = todayISO(ctx);
      const { status, period, classId, search, sort = "-issueDate" } = ctx.query;
      const rows = db.invoices.rows
        .filter((i) => {
          if (period && i.period !== period && i.issueDate.slice(0, 7) !== period) return false;
          if (status === "overdue") return i.balance > 0 && i.status !== "void" && i.dueDate < today;
          if (status && status !== "all" && i.status !== status) return false;
          return true;
        })
        .map((i) => toInvoiceListItem(db, i, today))
        .filter((i) => (!classId || i.className === className(db, classId)) && matches(search, i.number, i.studentName, i.admissionNo));
      return paginate(
        sortRows(rows, sort, {
          issueDate: (r) => r.issueDate + r.number,
          dueDate: (r) => r.dueDate,
          student: (r) => r.studentName,
          total: (r) => r.total,
          balance: (r) => r.balance,
        }),
        ctx.query,
      );
    },
  },
  {
    method: "GET",
    path: "/invoices/:id",
    handler: (ctx) => {
      const db = ctx.db;
      const inv = db.invoices.get(ctx.params.id) ?? fail(404, "not_found", "Invoice not found.");
      assertInvoiceAccess(ctx, inv);
      const s = db.students.get(inv.studentId)!;
      return {
        ...toInvoiceListItem(db, inv, todayISO(ctx)),
        guardianName: db.guardians.get(s.guardianIds[0])?.name,
        payments: db.payments.rows.filter((p) => p.allocations.some((a) => a.invoiceId === inv.id)),
      };
    },
  },
  {
    method: "POST",
    path: "/invoices/charges",
    handler: (ctx) => {
      requirePerm(ctx, "fees.create");
      const db = ctx.db;
      const { target, feeTypeId, description, amount, dueDate } = ctx.body ?? {};
      const feeType = db.feeTypes.get(feeTypeId) ?? fail(422, "validation", "Choose a fee type.", { feeTypeId: "Required" });
      if (!(Number(amount) > 0)) fail(422, "validation", "Amount must be greater than zero.", { amount: "Must be greater than 0" });
      if (!dueDate) fail(422, "validation", "Due date is required.", { dueDate: "Required" });
      const students = db.students.rows.filter((s) => {
        if (s.status !== "active") return false;
        if (target?.type === "class") return target.ids?.includes(s.classId);
        if (target?.type === "grade") return target.ids?.includes(s.gradeId);
        if (target?.type === "students") return target.ids?.includes(s.id);
        return false;
      });
      if (!students.length) fail(422, "validation", "No students match the selected target.");
      const today = todayISO(ctx);
      for (const s of students) {
        const total = Math.round(Number(amount));
        db.invoices.insert({
          id: nextId(db, "inv"), number: `INV-${today.slice(0, 4)}-${String(nextNumber(db, "invoiceNo")).padStart(6, "0")}`,
          studentId: s.id, issueDate: today, dueDate, total, paid: 0, balance: total, status: "unpaid",
          lines: [{ id: "l1", feeTypeId, description: description?.trim() || feeType.name, amount: total, discount: 0 }],
        });
      }
      audit(ctx, "invoice.charge", "Invoice", `Charged ${feeType.name} to ${students.length} students`);
      return { created: students.length };
    },
  },
  {
    method: "POST",
    path: "/invoices/generate-monthly",
    handler: (ctx) => {
      requirePerm(ctx, "fees.create");
      const db = ctx.db;
      const period = String(ctx.body?.period ?? "");
      if (!/^\d{4}-\d{2}$/.test(period)) fail(422, "validation", "Choose a month.", { period: "Required" });
      let created = 0;
      for (const s of db.students.rows.filter((x) => x.status === "active")) {
        const exists = db.invoices.rows.some((i) => i.studentId === s.id && i.period === period && i.lines.some((l) => l.feeTypeId === "fee_tuition"));
        if (exists) continue;
        const tuition = db.feeStructures.rows.find((f) => f.gradeId === s.gradeId && f.feeTypeId === "fee_tuition" && f.yearId === db.school.currentYearId)?.amount ?? 0;
        const pct = s.discountIds.map((d) => db.discounts.get(d)).reduce((a, d) => a + (d?.kind === "percent" && d.feeTypeId === "fee_tuition" ? d.value : 0), 0);
        const discount = Math.round((tuition * pct) / 100);
        db.invoices.insert({
          id: nextId(db, "inv"), number: `INV-${period.slice(0, 4)}-${String(nextNumber(db, "invoiceNo")).padStart(6, "0")}`,
          studentId: s.id, period, issueDate: `${period}-01`, dueDate: `${period}-10`, total: tuition - discount, paid: 0, balance: tuition - discount, status: "unpaid",
          lines: [{ id: "l1", feeTypeId: "fee_tuition", description: `Tuition fee – ${format(parseISO(`${period}-01`), "MMMM yyyy")}`, amount: tuition, discount }],
        });
        created++;
      }
      audit(ctx, "invoice.generate", "Invoice", `Generated ${period} tuition invoices (${created})`);
      return { created };
    },
  },
  {
    method: "POST",
    path: "/invoices/:id/void",
    handler: (ctx) => {
      requirePerm(ctx, "fees.edit");
      const inv = ctx.db.invoices.get(ctx.params.id) ?? fail(404, "not_found", "Invoice not found.");
      if (inv.status === "void") fail(409, "invalid_transition", "This invoice is already void.");
      if (inv.paid > 0) fail(409, "has_payments", "An invoice with payments can't be voided. Reverse the payments first.");
      if (!ctx.body?.reason?.trim()) fail(422, "validation", "Give a reason for voiding.", { reason: "Required" });
      inv.status = "void";
      inv.balance = 0;
      audit(ctx, "invoice.void", "Invoice", `Voided ${inv.number}: ${ctx.body.reason}`, inv.id);
      return inv;
    },
  },
  {
    method: "GET",
    path: "/payments",
    handler: (ctx) => {
      requirePerm(ctx, "payments.view");
      const db = ctx.db;
      const { method, search, from, to, sort = "-paidAt" } = ctx.query;
      const rows = db.payments.rows
        .filter((p) => (!method || method === "all" || p.method === method) && (!from || p.paidAt.slice(0, 10) >= from) && (!to || p.paidAt.slice(0, 10) <= to))
        .map((p) => toPaymentListItem(db, p))
        .filter((p) => matches(search, p.receiptNo, p.studentName, p.admissionNo, p.reference));
      return paginate(sortRows(rows, sort, { paidAt: (r) => r.paidAt, amount: (r) => r.amount, student: (r) => r.studentName }), ctx.query);
    },
  },
  {
    method: "GET",
    path: "/payments/:id",
    handler: (ctx) => {
      const p = ctx.db.payments.get(ctx.params.id) ?? fail(404, "not_found", "Payment not found.");
      const s = requireAuth(ctx);
      if (s.kind === "parent" ? !canSeeStudent(ctx, p.studentId) : !s.permissions.includes("payments.view")) fail(403, "forbidden", "Not allowed.");
      return { ...toPaymentListItem(ctx.db, p), school: ctx.db.school };
    },
  },
  {
    method: "POST",
    path: "/payments",
    handler: (ctx) => {
      requirePerm(ctx, "payments.create");
      const db = ctx.db;
      const { studentId, amount, method, reference, paidAt } = ctx.body ?? {};
      const s = db.students.get(studentId) ?? fail(422, "validation", "Choose a student.", { studentId: "Required" });
      const value = Math.round(Number(amount));
      if (!(value > 0)) fail(422, "validation", "Amount must be greater than zero.", { amount: "Must be greater than 0" });
      if (!METHODS.includes(method) || method === "payhere") fail(422, "validation", "Choose a payment method.", { method: "Required" });
      if ((method === "cheque" || method === "bank_deposit") && !reference?.trim()) fail(422, "validation", "Reference is required.", { reference: "Cheque or slip number is required" });
      if (paidAt && paidAt > todayISO(ctx)) fail(422, "validation", "Please fix the highlighted fields.", { paidAt: "Can't be in the future" });
      const balance = db.invoices.rows.filter((i) => i.studentId === s.id && i.status !== "void").reduce((a, i) => a + i.balance, 0);
      if (value > balance) fail(422, "validation", "Amount is more than the outstanding balance.", { amount: `Outstanding balance is ${balance}` });
      const allocations = allocate(db, s.id, value);
      const p = receipt(db, ctx, {
        studentId: s.id, amount: value, method, reference: reference?.trim() || undefined,
        paidAt: paidAt ? `${paidAt}T${isoNow(ctx).slice(11)}` : isoNow(ctx), recordedBy: ctx.session!.name, status: "completed", allocations,
      });
      audit(ctx, "payment.record", "Payment", `Recorded ${method.replace("_", " ")} payment ${p.receiptNo} (${value}) for ${fullName(s)}`, p.id);
      return toPaymentListItem(db, p);
    },
  },
  {
    method: "POST",
    path: "/payments/:id/reverse",
    handler: (ctx) => {
      requirePerm(ctx, "payments.approve");
      const db = ctx.db;
      const p = db.payments.get(ctx.params.id) ?? fail(404, "not_found", "Payment not found.");
      if (p.status !== "completed") fail(409, "invalid_transition", "Only completed payments can be reversed.");
      if (!ctx.body?.reason?.trim()) fail(422, "validation", "Give a reason for the reversal.", { reason: "Required" });
      for (const a of p.allocations) {
        const inv = db.invoices.get(a.invoiceId)!;
        inv.paid -= a.amount;
        recompute(inv);
      }
      p.status = "reversed";
      audit(ctx, "payment.reverse", "Payment", `Reversed ${p.receiptNo}: ${ctx.body.reason}`, p.id);
      return toPaymentListItem(db, p);
    },
  },
  {
    method: "GET",
    path: "/fees/defaulters",
    handler: (ctx) => {
      requirePerm(ctx, "fees.view");
      const { search, classId } = ctx.query;
      const cls = classId ? className(ctx.db, classId) : undefined;
      return defaulters(ctx.db, todayISO(ctx)).filter((d) => (!cls || d.className === cls) && matches(search, d.fullName, d.admissionNo, d.guardianName));
    },
  },
  {
    method: "POST",
    path: "/fees/defaulters/remind",
    handler: (ctx) => {
      requirePerm(ctx, "messaging.create");
      const db = ctx.db;
      const ids = (ctx.body?.studentIds ?? []) as string[];
      if (!ids.length) fail(422, "validation", "Select at least one student.");
      for (const id of ids) db.reminders.set(id, isoNow(ctx));
      db.messages.insert({
        id: nextId(db, "msg"), channel: "sms", kind: "fee_reminder",
        audience: { type: "defaulters", ids, label: `Parents with overdue fees (${ids.length})` },
        body: `Dear parent, school fees of {balance} for {student} are overdue. Please settle at the earliest or contact the school office. – ${db.school.name}`,
        recipients: ids.length, delivered: 0, failed: 0, status: "queued", createdAt: isoNow(ctx), createdBy: ctx.session!.name,
      });
      audit(ctx, "fees.reminder", "Message", `Sent overdue reminders to ${ids.length} parents`);
      return { sent: ids.length };
    },
  },
  { method: "GET", path: "/fee-types", handler: (ctx) => (requireAuth(ctx), ctx.db.feeTypes.rows) },
  {
    method: "POST",
    path: "/fee-types",
    handler: (ctx) => {
      requirePerm(ctx, "fees.edit");
      const { name, recurrence, description } = ctx.body ?? {};
      if (!name?.trim()) fail(422, "validation", "Name is required.", { name: "Required" });
      if (!["monthly", "one_time", "ad_hoc"].includes(recurrence)) fail(422, "validation", "Choose how often it's charged.", { recurrence: "Required" });
      if (ctx.db.feeTypes.rows.some((f) => f.name.toLowerCase() === name.trim().toLowerCase())) fail(409, "duplicate", "A fee type with this name already exists.", { name: "Already exists" });
      const ft = ctx.db.feeTypes.insert({ id: nextId(ctx.db, "fee"), name: name.trim(), recurrence, description, active: true });
      audit(ctx, "feeType.create", "Fee type", `Added fee type ${ft.name}`, ft.id);
      return ft;
    },
  },
  {
    method: "PUT",
    path: "/fee-types/:id",
    handler: (ctx) => {
      requirePerm(ctx, "fees.edit");
      const ft = ctx.db.feeTypes.get(ctx.params.id) ?? fail(404, "not_found", "Fee type not found.");
      const { name, description, active } = ctx.body ?? {};
      if (!name?.trim()) fail(422, "validation", "Name is required.", { name: "Required" });
      Object.assign(ft, { name: name.trim(), description, active: !!active });
      audit(ctx, "feeType.update", "Fee type", `Updated fee type ${ft.name}`, ft.id);
      return ft;
    },
  },
  {
    method: "GET",
    path: "/fee-structures",
    handler: (ctx) => {
      requirePerm(ctx, "fees.view");
      const yearId = ctx.query.yearId ?? ctx.db.school.currentYearId;
      return ctx.db.feeStructures.rows.filter((f) => f.yearId === yearId);
    },
  },
  {
    method: "PUT",
    path: "/fee-structures",
    handler: (ctx) => {
      requirePerm(ctx, "fees.edit");
      const db = ctx.db;
      const yearId = db.school.currentYearId;
      const items = (ctx.body?.items ?? []) as { gradeId: string; feeTypeId: string; amount: number }[];
      for (const it of items) {
        if (!(it.amount >= 0)) fail(422, "validation", "Amounts can't be negative.");
        const existing = db.feeStructures.rows.find((f) => f.yearId === yearId && f.gradeId === it.gradeId && f.feeTypeId === it.feeTypeId);
        if (existing) existing.amount = Math.round(it.amount);
        else if (it.amount > 0) db.feeStructures.insert({ id: nextId(db, "fs"), yearId, gradeId: it.gradeId, feeTypeId: it.feeTypeId, amount: Math.round(it.amount) });
      }
      audit(ctx, "feeStructure.update", "Fee structure", `Updated fee structure (${items.length} amounts)`);
      return db.feeStructures.rows.filter((f) => f.yearId === yearId);
    },
  },
  { method: "GET", path: "/discounts", handler: (ctx) => (requireAuth(ctx), ctx.db.discounts.rows) },
  {
    method: "POST",
    path: "/discounts",
    handler: (ctx) => {
      requirePerm(ctx, "fees.edit");
      const { name, kind, value, description } = ctx.body ?? {};
      if (!name?.trim()) fail(422, "validation", "Name is required.", { name: "Required" });
      if (kind === "percent" && !(value > 0 && value <= 100)) fail(422, "validation", "Percentage must be 1–100.", { value: "1–100" });
      if (kind === "fixed" && !(value > 0)) fail(422, "validation", "Amount must be greater than zero.", { value: "Must be greater than 0" });
      if (ctx.db.discounts.rows.some((d) => d.name.toLowerCase() === name.trim().toLowerCase())) fail(409, "duplicate", "A discount with this name already exists.", { name: "Already exists" });
      const d = ctx.db.discounts.insert({ id: nextId(ctx.db, "disc"), name: name.trim(), kind, value: Number(value), feeTypeId: "fee_tuition", description });
      audit(ctx, "discount.create", "Discount", `Added discount ${d.name}`, d.id);
      return d;
    },
  },

  // ---------- PayHere ----------
  {
    method: "POST",
    path: "/payhere/checkout",
    handler: (ctx): PayHereCheckout => {
      const s = requireAuth(ctx);
      const db = ctx.db;
      const ids = (ctx.body?.invoiceIds ?? []) as string[];
      const invoices = ids.map((id) => db.invoices.get(id)).filter((i) => !!i);
      if (!invoices.length) fail(422, "validation", "Select at least one invoice to pay.");
      const studentId = invoices[0].studentId;
      if (invoices.some((i) => i.studentId !== studentId)) fail(422, "validation", "Pay one child's invoices at a time.");
      if (s.kind === "parent" ? !canSeeStudent(ctx, studentId) : !s.permissions.includes("payments.create")) fail(403, "forbidden", "Not allowed.");
      const amount = invoices.reduce((a, i) => a + i.balance, 0);
      if (amount <= 0) fail(409, "already_paid", "These invoices are already paid.");
      const order = db.payhereOrders.insert({
        id: `ORD-${String(nextNumber(db, "orderNo", 50001))}`, studentId, invoiceIds: invoices.map((i) => i.id), amount, status: "pending", createdAt: isoNow(ctx),
      });
      const student = db.students.get(studentId)!;
      return {
        orderId: order.id, amount, currency: "LKR",
        // The real API returns https://sandbox.payhere.lk/pay/checkout and a server-computed md5 hash.
        actionUrl: `/portal/pay/sandbox?order=${order.id}`,
        fields: {
          merchant_id: "1211149", order_id: order.id, items: invoices.map((i) => i.number).join(", "), currency: "LKR",
          amount: amount.toFixed(2), first_name: s.name.split(" ").slice(1, 2).join(" ") || s.name, last_name: student.lastName,
          email: s.email, return_url: "/portal/pay/result", cancel_url: "/portal/pay/result", notify_url: "/api/v1/payhere/notify", hash: "MOCK",
        },
      };
    },
  },
  {
    method: "GET",
    path: "/payhere/orders/:id",
    handler: (ctx) => {
      const s = requireAuth(ctx);
      const db = ctx.db;
      const order = db.payhereOrders.get(ctx.params.id) ?? fail(404, "not_found", "Order not found.");
      if (s.kind === "parent" && !canSeeStudent(ctx, order.studentId)) fail(403, "forbidden", "Not allowed.");
      const payment = db.payments.rows.find((p) => p.reference === order.id);
      return {
        ...order,
        studentName: fullName(db.students.get(order.studentId)!),
        invoiceNumbers: order.invoiceIds.map((id) => db.invoices.get(id)!.number),
        receiptNo: payment?.receiptNo,
        paymentId: payment?.id,
        merchant: db.school.name,
      };
    },
  },
  {
    // Stands in for PayHere's server-to-server notify_url callback (verified by md5sig in the real API).
    method: "POST",
    path: "/payhere/sandbox/:id/complete",
    public: true,
    handler: (ctx) => {
      const db = ctx.db;
      const order = db.payhereOrders.get(ctx.params.id) ?? fail(404, "not_found", "Order not found.");
      if (order.status !== "pending") return { status: order.status };
      const outcome = ctx.body?.outcome as "success" | "failed" | "cancelled";
      order.status = outcome;
      if (outcome === "success") {
        const amount = order.invoiceIds.reduce((a, id) => a + db.invoices.get(id)!.balance, 0);
        const allocations = allocate(db, order.studentId, amount, order.invoiceIds);
        const p = receipt(db, ctx, {
          studentId: order.studentId, amount, method: "payhere", reference: order.id, paidAt: isoNow(ctx),
          recordedBy: "PayHere (online)", status: "completed", allocations,
        });
        audit(ctx, "payment.payhere", "Payment", `PayHere payment ${p.receiptNo} (${amount}) for ${fullName(db.students.get(order.studentId)!)}`, p.id);
      }
      return { status: order.status };
    },
  },
];
