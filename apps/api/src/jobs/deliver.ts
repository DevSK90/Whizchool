import { prisma } from "../db";
import { deliverEmail, type Email } from "../email/mailer";
import { messageEmail } from "../email/templates";
import { logger } from "../logger";
import { RetryableSmsError, sendSms } from "../sms/sender";
import { registerJob } from "./queue";

/** Tries per recipient before a delivery is marked failed. */
export const MAX_ATTEMPTS = 3;
const BATCH = 50;
/** A claimed delivery whose worker died becomes claimable again after this. */
const CLAIM_TIMEOUT = "2 minutes";

interface ClaimedDelivery {
  id: string;
  to: string;
  body: string | null;
  attempts: number;
}

/**
 * Takes the next batch of this message's queued deliveries for this worker only. Rows another
 * worker holds are skipped, so two workers can never send the same delivery twice.
 */
function claim(messageId: string) {
  return prisma.$queryRaw<ClaimedDelivery[]>`
    UPDATE "MessageDelivery" SET "attempts" = "attempts" + 1, "lastAttemptAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "MessageDelivery"
      WHERE "messageId" = ${messageId} AND "status" = 'queued'
        AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" < now() - ${CLAIM_TIMEOUT}::interval)
      ORDER BY "id" LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "to", "body", "attempts"`;
}

/** Recomputes a message's counts and status from its deliveries. */
export async function settleMessage(messageId: string) {
  const counts = await prisma.messageDelivery.groupBy({ by: ["status"], where: { messageId }, _count: { _all: true } });
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const [queued, sent, failed] = [n("queued"), n("sent"), n("failed")];
  const status = queued ? (sent || failed ? "sending" : "queued") : failed === 0 ? "sent" : sent === 0 ? "failed" : "partial";
  await prisma.message.update({ where: { id: messageId }, data: { recipients: queued + sent + failed, delivered: sent, failed, status } });
  return { queued, sent, failed };
}

/** Sends every queued delivery of one message. Throws (so the queue retries later) while some are waiting on a retry. */
export async function deliverMessage(messageId: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return;
  const school = await prisma.school.findUniqueOrThrow({ where: { id: "school" }, select: { name: true, smsSenderId: true } });
  let waitingOnRetry = false;
  for (let batch = await claim(messageId); batch.length; batch = await claim(messageId)) {
    for (const d of batch) {
      const text = d.body ?? message.body;
      try {
        let providerId: string | undefined;
        if (message.channel === "sms") providerId = (await sendSms({ to: d.to, text, senderId: school.smsSenderId })).providerId;
        else await deliverEmail(messageEmail(d.to, school.name, message.subject ?? school.name, text));
        await prisma.messageDelivery.update({ where: { id: d.id }, data: { status: "sent", sentAt: new Date(), providerId: providerId ?? null, error: null } });
      } catch (err) {
        const retryable = err instanceof RetryableSmsError || message.channel === "email";
        const giveUp = !retryable || d.attempts >= MAX_ATTEMPTS;
        if (!giveUp) waitingOnRetry = true;
        await prisma.messageDelivery.update({
          where: { id: d.id },
          // Left queued, the delivery is claimable again once the claim times out.
          data: { status: giveUp ? "failed" : "queued", error: String(err).slice(0, 500) },
        });
        logger.warn({ err, deliveryId: d.id, attempt: d.attempts, giveUp }, "delivery failed");
      }
    }
    await settleMessage(messageId);
  }
  const { queued, failed } = await settleMessage(messageId);
  if (failed && !queued) {
    await prisma.eventLog.create({ data: { type: "message.failed", data: { messageId, failed } } });
  }
  if (waitingOnRetry || queued) throw new Error(`Message ${messageId}: ${queued} deliveries waiting to retry`);
}

registerJob("messages.deliver", async (data) => deliverMessage(String(data.messageId)));

/** One-off emails without secrets (e.g. an application's confirmation), sent with retries. */
registerJob("email.send", async (data) => {
  await deliverEmail(data as unknown as Email);
});
