import { config } from "../config";
import type { Email } from "./mailer";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(schoolName: string, paragraphs: string[], action: { label: string; url: string }, footer: string) {
  const text = [...paragraphs, "", `${action.label}: ${action.url}`, "", footer, "", schoolName].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Segoe UI,Arial,sans-serif;color:#1d2033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:600;padding-bottom:16px">${escape(schoolName)}</td></tr>
${paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:12px">${escape(p)}</td></tr>`).join("")}
<tr><td style="padding:12px 0 20px"><a href="${escape(action.url)}" style="display:inline-block;background:#3b45cf;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">${escape(action.label)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6b6f85">${escape(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** A school message (notice, circular) as an email: the text as typed, paragraphs kept. */
export function messageEmail(to: string, schoolName: string, subject: string, body: string): Email {
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const text = [...paragraphs, "", schoolName].join("\n\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Segoe UI,Arial,sans-serif;color:#1d2033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:600;padding-bottom:16px">${escape(schoolName)}</td></tr>
${paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:12px;white-space:pre-line">${escape(p)}</td></tr>`).join("")}
</table></td></tr></table></body></html>`;
  return { to, subject, text, html };
}

export const inviteLinkPath =(token: string) => `/invite/${token}`;
export const resetLinkPath = (token: string) => `/reset-password?token=${encodeURIComponent(token)}`;

export function inviteEmail(to: { name: string; email: string; kind: "staff" | "parent" }, schoolName: string, token: string): Email {
  const area = to.kind === "parent" ? "the parent portal, where you can follow your child's attendance, results and fees" : "the staff app";
  return {
    to: to.email,
    subject: `You're invited to ${schoolName} on Whizchool`,
    ...layout(
      schoolName,
      [`Hello ${to.name},`, `${schoolName} has invited you to ${area}. Set a password to activate your account.`],
      { label: "Set your password", url: `${config.APP_URL}${inviteLinkPath(token)}` },
      "This link works once and expires in 7 days. If you weren't expecting this email, you can ignore it.",
    ),
  };
}

export function applicationReceivedEmail(to: { name: string; email: string }, schoolName: string, application: { refNo: string; studentName: string; gradeName: string }): Email {
  return {
    to: to.email,
    subject: `Application ${application.refNo} received – ${schoolName}`,
    ...layout(
      schoolName,
      [
        `Hello ${to.name},`,
        `Thank you for applying to ${schoolName}. We have received the application for ${application.studentName} (${application.gradeName}).`,
        `Your reference number is ${application.refNo}. Keep it to check the application's progress.`,
      ],
      { label: "Check application status", url: `${config.APP_URL}/apply/status?ref=${encodeURIComponent(application.refNo)}` },
      "We'll contact you about the next steps. If you didn't submit this application, please let the school office know.",
    ),
  };
}

export function resetEmail(to: { name: string; email: string }, schoolName: string, token: string): Email {
  return {
    to: to.email,
    subject: `Reset your ${schoolName} password`,
    ...layout(
      schoolName,
      [`Hello ${to.name},`, "We received a request to reset your password. Choose a new one using the link below."],
      { label: "Choose a new password", url: `${config.APP_URL}${resetLinkPath(token)}` },
      "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email; your password stays the same.",
    ),
  };
}
