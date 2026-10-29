import { prisma } from "../db";
import { logger } from "../logger";
import { schoolToday } from "../dates";
import { generateMonthlyInvoices, monthlyRunDone } from "../services/invoices";
import { expireOrders } from "../services/payhere";
import { store } from "../storage";
import { enqueue, registerJob } from "./queue";

/**
 * Every minute: messages that still have deliveries waiting (their job was lost in a crash, or a
 * retry is due) get a delivery job. Deliveries are claimed atomically, so an extra job is harmless.
 */
export async function sweepMessages() {
  const due = await prisma.$queryRaw<{ messageId: string }[]>`
    SELECT DISTINCT "messageId" FROM "MessageDelivery"
    WHERE "status" = 'queued' AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" < now() - interval '2 minutes')
      AND "messageId" IN (SELECT "id" FROM "Message" WHERE "createdAt" < now() - interval '1 minute')
    LIMIT 100`;
  for (const { messageId } of due) await enqueue("messages.deliver", { messageId });
  return due.length;
}

/** Nightly: removes what is no longer useful. */
export async function cleanup() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  const tokens = await prisma.authToken.deleteMany({ where: { OR: [{ usedAt: { lt: new Date(now - 30 * day) } }, { expiresAt: { lt: new Date(now - 30 * day) } }] } });
  const keys = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now - day) } } });
  // Uploads nobody attached within a day (an abandoned application form, a cancelled dialog).
  const orphans = await prisma.fileObject.findMany({
    where: { createdAt: { lt: new Date(now - day) }, studentPhotos: { none: {} }, studentDocuments: { none: {} }, applicationDocuments: { none: {} } },
    select: { id: true, key: true },
    take: 500,
  });
  for (const f of orphans) {
    await prisma.fileObject.delete({ where: { id: f.id } });
    await store.remove(f.key).catch(() => undefined);
  }
  const result = { sessions: sessions.count, tokens: tokens.count, idempotencyKeys: keys.count, files: orphans.length };
  logger.info(result, "nightly cleanup");
  return result;
}

registerJob("maintenance.sweep", async () => {
  await sweepMessages();
  await expireOrders();
});
registerJob("maintenance.cleanup", async () => {
  await cleanup();
});

/** Daily: bills this month's fees unless that has already happened (by this job or by hand). */
export async function monthlyInvoicesDue() {
  const period = schoolToday().slice(0, 7);
  if (await monthlyRunDone(prisma, period)) return null;
  const result = await generateMonthlyInvoices(prisma, period);
  logger.info({ period, ...result }, "monthly invoices");
  return result;
}

registerJob("invoices.monthly", async () => {
  await monthlyInvoicesDue();
});
