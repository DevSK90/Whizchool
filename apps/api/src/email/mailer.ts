import nodemailer from "nodemailer";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../logger";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Transport = (email: Email) => Promise<void>;

/** Emails "sent" with EMAIL_TRANSPORT=log, newest last. Tests read invite and reset links from here. */
export const sentEmails: Email[] = [];

function createTransport(): Transport {
  switch (config.EMAIL_TRANSPORT) {
    case "smtp": {
      const url = new URL(config.SMTP_URL);
      const smtp = nodemailer.createTransport({
        host: url.hostname,
        port: Number(url.port) || (url.protocol === "smtps:" ? 465 : 25),
        secure: url.protocol === "smtps:",
        auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
        // Short timeouts: until sending moves to the job queue (Phase 4), a dead mail server must not stall requests.
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
      });
      return async (email) => {
        await smtp.sendMail({ from: config.EMAIL_FROM, ...email });
      };
    }
    case "resend":
      return async (email) => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: config.EMAIL_FROM, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
        });
        if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      };
    case "log":
      return async (email) => {
        sentEmails.push(email);
      };
  }
}

const transport = createTransport();

/** Sends and reports failure by throwing; the job queue uses this so it can retry. */
export const deliverEmail = (email: Email) => transport(email);

/**
 * Sends without failing the caller: a mail outage must not undo an invite or block a reset.
 * Failures are logged and recorded in the EventLog. (Phase 4 moves sending onto the job queue with retries.)
 */
export async function sendEmail(email: Email) {
  try {
    await transport(email);
    logger.debug({ to: email.to, subject: email.subject }, "email sent");
  } catch (err) {
    logger.error({ err, to: email.to, subject: email.subject }, "email failed");
    await prisma.eventLog
      .create({ data: { type: "email.failed", data: { to: email.to, subject: email.subject, error: String(err) } } })
      .catch(() => undefined);
  }
}
