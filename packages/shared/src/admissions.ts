// What parents are told as an application moves along: the real API and the demo API send the same words.
import { mobileDigits, normalizeLocalPhone } from "./phone";
import type { ApplicationStage } from "./types";

export type ApplicantNotice = "received" | "interview" | "accepted" | "date_changed" | "rejected" | "enrolled";

export interface ApplicantNoticeDetails {
  schoolName: string;
  refNo: string;
  studentName: string;
  interviewAt?: string;
  enrollmentDate?: string;
  admissionNo?: string;
  className?: string;
  /** Where the parent can follow the application, for the first message. */
  statusUrl?: string;
}

const COLOMBO = "Asia/Colombo";
const formatDay = (date: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
const formatMoment = (at: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: COLOMBO, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at));

/** The words for one stage. The same text goes by email and SMS, so it stays short. */
export function applicantMessage(notice: ApplicantNotice, d: ApplicantNoticeDetails): { subject: string; body: string } {
  const who = `${d.studentName} (${d.refNo})`;
  switch (notice) {
    case "received":
      return {
        subject: `Application ${d.refNo} received`,
        body: `${d.schoolName}: we received the application for ${d.studentName}. Your tracking no. is ${d.refNo}.${d.statusUrl ? ` Track it at ${d.statusUrl}` : ""}`,
      };
    case "interview":
      return {
        subject: `Interview for ${d.studentName}`,
        body: `${d.schoolName}: the interview for ${who} is on ${formatMoment(d.interviewAt!)}. Please come with your child.`,
      };
    case "accepted":
      return {
        subject: `${d.studentName} has been offered a place`,
        body: `${d.schoolName}: ${who} has been offered a place. Please come to the school to enrol on ${formatDay(d.enrollmentDate!)} and be ready to pay the enrolment fees.`,
      };
    case "date_changed":
      return {
        subject: `New enrolment date for ${d.studentName}`,
        body: `${d.schoolName}: the enrolment date for ${who} is now ${formatDay(d.enrollmentDate!)}.`,
      };
    case "rejected":
      return {
        subject: `Application ${d.refNo}`,
        body: `${d.schoolName}: unfortunately we can't offer a place to ${who} this time. Please contact the school office for details.`,
      };
    case "enrolled":
      return {
        subject: `${d.studentName} is enrolled`,
        body: `${d.schoolName}: ${d.studentName} is enrolled in ${d.className}. Admission no. ${d.admissionNo}.`,
      };
  }
}

/** Which message, if any, a move to this stage sends. */
export function noticeForMove(from: ApplicationStage, to: ApplicationStage): ApplicantNotice | null {
  if (to === "interview") return "interview";
  if (to === "accepted") return from === "accepted" ? "date_changed" : "accepted";
  if (to === "rejected") return "rejected";
  return null;
}

/** Only mobile numbers can receive an SMS. */
export const canTextPhone = (phone: string) => mobileDigits(phone) !== null;

/** Whether what a parent typed on the status page is this application's email or phone number. */
export function matchesApplicantContact(contact: string, guardian: { email?: string | null; phone: string }) {
  const typed = contact.trim().toLowerCase();
  if (!typed) return false;
  if (guardian.email && guardian.email.toLowerCase() === typed) return true;
  const phone = normalizeLocalPhone(typed);
  return !!phone && phone === normalizeLocalPhone(guardian.phone);
}
