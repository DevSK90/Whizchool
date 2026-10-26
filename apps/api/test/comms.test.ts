import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSchoolToday } from "../src/dates";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/http/rate-limit";
import { deliverMessage } from "../src/jobs/deliver";
import { cleanup, sweepMessages } from "../src/jobs/maintenance";
import { RetryableSmsError, sentSms } from "../src/sms/sender";
import { store } from "../src/storage";
import { signIn, unique } from "./helpers";

/** Lets a test make SMS sends fail, the way a gateway outage or a refusal would: the next sends, or every send to one number. */
const failures = vi.hoisted(() => ({ next: [] as Error[], to: null as string | null }));
vi.mock("../src/sms/sender", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/sms/sender")>();
  return {
    ...real,
    sendSms: async (sms: Parameters<typeof real.sendSms>[0]) => {
      const err = sms.to === failures.to ? new real.RetryableSmsError("still down") : failures.next.shift();
      if (err) throw err;
      return real.sendSms(sms);
    },
  };
});

const FRIDAY = "2026-10-23";

beforeEach(() => {
  resetRateLimits();
  setSchoolToday(FRIDAY);
  failures.next.length = 0;
  failures.to = null;
});
afterAll(() => setSchoolToday(null));

async function teacherWithClass() {
  const teacher = await signIn("teacher@whizchool.lk");
  const me = await teacher.get("/api/v1/auth/me");
  return { teacher, classId: me.body.classIds[0] as string };
}

/** The register with the given students absent and everyone else present. */
async function register(agent: Awaited<ReturnType<typeof signIn>>, classId: string, date: string, absent: number[]) {
  const sheet = await agent.get("/api/v1/attendance").query({ classId, date });
  expect(sheet.status, JSON.stringify(sheet.body)).toBe(200);
  const records = sheet.body.records.map((r: { studentId: string }, i: number) => ({ studentId: r.studentId, status: absent.includes(i) ? "absent" : "present" }));
  return { records, save: (body = records) => agent.put("/api/v1/attendance").send({ classId, date, records: body }) };
}

describe("absence alerts", () => {
  it("texts the primary guardian of each newly absent student, by name, once", async () => {
    const { teacher, classId } = await teacherWithClass();
    const { records, save } = await register(teacher, classId, FRIDAY, [0, 1]);
    const before = sentSms.length;

    const res = await save();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ absent: 2, smsQueued: 2 });
    const texts = sentSms.slice(before);
    expect(texts).toHaveLength(2);
    const absentees = await prisma.student.findMany({
      where: { id: { in: [records[0].studentId, records[1].studentId] } },
      include: { guardians: { orderBy: { position: "asc" }, take: 1, include: { guardian: true } } },
    });
    for (const s of absentees) {
      const sms = texts.find((t) => t.to === s.guardians[0].guardian.phone);
      expect(sms?.text).toContain(`${s.firstName} ${s.lastName} was marked absent today (23 Oct)`);
    }
    const message = await prisma.message.findFirstOrThrow({ where: { relatesTo: `attendance:${classId}:${FRIDAY}` }, orderBy: { createdAt: "desc" } });
    expect(message).toMatchObject({ kind: "absence_alert", status: "sent", recipients: 2, delivered: 2 });

    // Saving the same register again texts nobody.
    const again = await save();
    expect(again.body.smsQueued).toBe(0);
    expect(sentSms.length).toBe(before + 2);
  });

  it("withdraws an alert that hasn't gone out when the absence is corrected", async () => {
    const { teacher, classId } = await teacherWithClass();
    const { records, save } = await register(teacher, classId, FRIDAY, [2]);
    failures.next.push(new RetryableSmsError("gateway down"));
    expect((await save()).body.smsQueued).toBe(1);
    const delivery = await prisma.messageDelivery.findFirstOrThrow({ where: { studentId: records[2].studentId, message: { relatesTo: `attendance:${classId}:${FRIDAY}` } } });
    expect(delivery).toMatchObject({ status: "queued", attempts: 1 });

    // The student was only late: correcting the register cancels the waiting SMS.
    const corrected = records.map((r: { studentId: string }, i: number) => (i === 2 ? { ...r, status: "late" } : r));
    expect((await save(corrected)).status).toBe(200);
    expect((await prisma.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("cancelled");
    expect((await prisma.message.findUniqueOrThrow({ where: { id: delivery.messageId } })).recipients).toBe(0);
  });

  it("doesn't text about an earlier day, and refuses dates no register can have", async () => {
    const { teacher, classId } = await teacherWithClass();
    const before = sentSms.length;
    const past = await register(teacher, classId, "2026-10-22", [0]);
    expect((await past.save()).body.smsQueued).toBe(0);
    expect(sentSms.length).toBe(before);

    for (const date of ["2026-10-24", "2026-10-26", "2025-10-23"]) {
      const res = await teacher.put("/api/v1/attendance").send({ classId, date, records: past.records });
      expect(res.status, date).toBe(422);
    }
    // Only students on this class's register.
    const outsider = await prisma.student.findFirstOrThrow({ where: { classId: { not: classId }, status: "active" } });
    const res = await teacher.put("/api/v1/attendance").send({ classId, date: "2026-10-22", records: [{ studentId: outsider.id, status: "absent" }] });
    expect(res.status).toBe(422);
  });
});

describe("delivery", () => {
  async function smsToClass(body: string) {
    const admin = await signIn("admin@whizchool.lk");
    const res = await admin.post("/api/v1/messages").set("Idempotency-Key", unique()).send({ channel: "sms", audience: { type: "class", ids: ["cls_2026_5a"] }, body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { id: string; recipients: number };
  }

  it("retries a delivery the gateway couldn't take, and gives up on one it refused", async () => {
    failures.next.push(new RetryableSmsError("timeout"), new Error("invalid number"));
    const message = await smsToClass(`Parent meeting ${unique()}`);
    const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id }, include: { deliveries: true } });
    expect(after.deliveries.filter((d) => d.status === "failed")).toHaveLength(1);
    const waiting = after.deliveries.filter((d) => d.status === "queued");
    expect(waiting).toHaveLength(1);
    expect(after.status).toBe("sending");

    // Not claimable until the claim times out; the sweeper then hands it to a worker again.
    await deliverMessage(message.id).catch(() => undefined);
    expect((await prisma.messageDelivery.findUniqueOrThrow({ where: { id: waiting[0].id } })).attempts).toBe(1);
    await prisma.$executeRaw`UPDATE "MessageDelivery" SET "lastAttemptAt" = now() - interval '5 minutes' WHERE "id" = ${waiting[0].id}`;
    await prisma.$executeRaw`UPDATE "Message" SET "createdAt" = now() - interval '5 minutes' WHERE "id" = ${message.id}`;
    expect(await sweepMessages()).toBeGreaterThanOrEqual(1);

    const settled = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(settled).toMatchObject({ status: "partial", recipients: message.recipients, delivered: message.recipients - 1, failed: 1 });
    expect(await prisma.eventLog.count({ where: { type: "message.failed", data: { path: ["messageId"], equals: message.id } } })).toBe(1);
  });

  it("stops retrying after the last attempt", async () => {
    const student = await prisma.student.findFirstOrThrow({ where: { classId: "cls_2026_5a", status: "active" }, include: { guardians: { orderBy: { position: "asc" }, take: 1, include: { guardian: true } } } });
    failures.to = student.guardians[0].guardian.phone;
    const message = await smsToClass(`School closed ${unique()}`);
    for (let i = 0; i < 2; i++) {
      await prisma.$executeRaw`UPDATE "MessageDelivery" SET "lastAttemptAt" = now() - interval '5 minutes' WHERE "messageId" = ${message.id} AND "status" = 'queued'`;
      await deliverMessage(message.id).catch(() => undefined);
    }
    const failed = await prisma.messageDelivery.findMany({ where: { messageId: message.id, status: "failed" } });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ attempts: 3, error: expect.stringContaining("still down") });
  });
});

describe("audiences", () => {
  it("counts reachable guardians per channel and emails only those with an address", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const sms = await admin.get("/api/v1/messages/audience").query({ type: "class", ids: "cls_2026_5a", channel: "sms" });
    const email = await admin.get("/api/v1/messages/audience").query({ type: "class", ids: "cls_2026_5a", channel: "email" });
    expect(sms.body.count).toBeGreaterThan(0);
    expect(email.body.count + email.body.unreachable).toBe(sms.body.count + sms.body.unreachable);

    const res = await admin.post("/api/v1/messages").set("Idempotency-Key", unique()).send({ channel: "email", audience: { type: "class", ids: ["cls_2026_5a"] }, subject: "Sports meet", body: "Friday at 8." });
    expect(res.status).toBe(200);
    const deliveries = await prisma.messageDelivery.findMany({ where: { messageId: res.body.id } });
    expect(deliveries).toHaveLength(email.body.count);
    expect(deliveries.every((d) => d.to.includes("@") && d.status === "sent")).toBe(true);
  });

  it("refuses an SMS longer than three parts, counting Sinhala at 67 characters a part", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const send = (body: string) => admin.post("/api/v1/messages").set("Idempotency-Key", unique()).send({ channel: "sms", audience: { type: "all_staff" }, body });
    expect((await send("ප".repeat(201))).status).toBe(200);
    const tooLong = await send("ප".repeat(202));
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.fields.body).toMatch(/4 SMS parts/);
    expect((await send("a".repeat(459))).status).toBe(200);
    expect((await send("a".repeat(460))).status).toBe(422);
  });

  it("shows parents only the notices meant for them", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const post = (audience: string) => admin.post("/api/v1/notices").send({ title: `Notice ${audience}`, body: "Text", audience, pinned: false });
    const [staff, parents, everyone] = [(await post("staff")).body, (await post("parents")).body, (await post("everyone")).body];
    const parent = await signIn("parent@whizchool.lk");
    const ids = (await parent.get("/api/v1/notices")).body.map((n: { id: string }) => n.id);
    expect(ids).toEqual(expect.arrayContaining([parents.id, everyone.id]));
    expect(ids).not.toContain(staff.id);
    expect((await parent.post("/api/v1/notices").send({ title: "x", body: "y", audience: "everyone" })).status).toBe(403);
  });
});

describe("nightly cleanup", () => {
  it("removes expired sessions, stale keys and uploads nobody attached", async () => {
    const admin = await signIn("admin@whizchool.lk");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@whizchool.lk" } });
    const expired = await prisma.session.create({ data: { tokenHash: `expired-${unique()}`, userId: user.id, expiresAt: new Date(Date.now() - 1000) } });
    const key = await prisma.idempotencyKey.create({
      data: { key: unique(), userId: user.id, method: "POST", path: "/x", requestHash: "h", status: 201, createdAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    const upload = await admin.post("/api/v1/uploads").field("purpose", "student-document").attach("file", Buffer.from("%PDF-1.4\n%%EOF\n"), "left-behind.pdf");
    expect(upload.status).toBe(200);
    const file = await prisma.fileObject.update({ where: { id: upload.body.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });

    const result = await cleanup();
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.idempotencyKey.findUnique({ where: { key_userId: { key: key.key, userId: user.id } } })).toBeNull();
    expect(await prisma.fileObject.findUnique({ where: { id: file.id } })).toBeNull();
    await expect(store.get(file.key)).rejects.toThrow();
    // The signed-in session is untouched.
    expect((await admin.get("/api/v1/auth/me")).status).toBe(200);
  });
});
