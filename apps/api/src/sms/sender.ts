import nodemailer from "nodemailer";
import { smsLength } from "@whizchool/shared/sms";
import { config } from "../config";

export interface Sms {
  /** "077 123 4567" */
  to: string;
  text: string;
  senderId: string;
}

/** A failure the provider may get past on a later try (network, rate limit, 5xx). */
export class RetryableSmsError extends Error {}

type Transport = (sms: Sms) => Promise<{ providerId?: string }>;

/** SMS "sent" with SMS_TRANSPORT=log, newest last. Tests read them from here. */
export const sentSms: Sms[] = [];

/** "077 123 4567" → "94771234567", the international form SMS gateways expect. */
export const toE164Digits = (phone: string) => `94${phone.replace(/\D/g, "").replace(/^0/, "")}`;

function notifyLk(): Transport {
  return async (sms) => {
    const params = new URLSearchParams({
      user_id: config.NOTIFYLK_USER_ID!,
      api_key: config.NOTIFYLK_API_KEY!,
      sender_id: sms.senderId,
      to: toE164Digits(sms.to),
      message: sms.text,
    });
    // Sinhala and Tamil text must be sent as Unicode or it arrives garbled.
    if (smsLength(sms.text).encoding === "UCS-2") params.set("type", "unicode");
    let res: Response;
    try {
      res = await fetch("https://app.notify.lk/api/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new RetryableSmsError(`Notify.lk unreachable: ${String(e)}`);
    }
    const body = (await res.json().catch(() => null)) as { status?: string; data?: unknown } | null;
    if (res.status >= 500 || res.status === 429) throw new RetryableSmsError(`Notify.lk responded ${res.status}`);
    if (!res.ok || body?.status !== "success") throw new Error(`Notify.lk refused the message: ${JSON.stringify(body ?? res.status)}`);
    return { providerId: typeof body.data === "string" ? body.data : undefined };
  };
}

/** Development: every SMS lands in Mailpit (http://localhost:8025) as an email to <number>@sms.test. */
function mailpit(): Transport {
  const url = new URL(config.SMTP_URL);
  const smtp = nodemailer.createTransport({ host: url.hostname, port: Number(url.port) || 25, secure: false, connectionTimeout: 5_000, greetingTimeout: 5_000 });
  return async (sms) => {
    const length = smsLength(sms.text);
    try {
      await smtp.sendMail({
        from: `${sms.senderId} (SMS) <sms@whizchool.test>`,
        to: `${sms.to.replace(/\s/g, "")}@sms.test`,
        subject: `SMS to ${sms.to} (${length.parts} part${length.parts > 1 ? "s" : ""}, ${length.encoding})`,
        text: sms.text,
      });
    } catch (e) {
      throw new RetryableSmsError(String(e));
    }
    return {};
  };
}

const log: Transport = async (sms) => {
  sentSms.push(sms);
  return {};
};

export const sendSms: Transport = config.SMS_TRANSPORT === "notifylk" ? notifyLk() : config.SMS_TRANSPORT === "mailpit" ? mailpit() : log;
