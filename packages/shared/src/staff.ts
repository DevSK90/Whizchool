// Staff records: the rules the real API and the demo API both apply.
import { normalizeLocalPhone } from "./phone";
import type { DateString, Gender, StaffType } from "./types";

export const STAFF_TITLES = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr.", "Rev.", "Ven."] as const;

/** What a staff member's type is when only their job title is known (an account invited from Users). */
export const staffTypeFor = (designation: string): StaffType => (/^(teacher|principal|deputy principal|vice principal)/i.test(designation.trim()) ? "academic" : "non_academic");

/** Stored names carry the title, as lists and pickers show them: "Mrs. Dilani Peiris". */
export const titledName = (title: string, name: string) => (title ? `${title} ${name}` : name);

/** The name without its title, for the edit form. */
export const untitledName = (title: string, name: string) => (title && name.startsWith(`${title} `) ? name.slice(title.length + 1) : name);

export interface StaffInput {
  title: string;
  name: string;
  staffType: StaffType;
  designation: string;
  phone: string;
  email?: string;
  gender?: Gender;
  dob?: DateString;
  nic?: string;
  address?: string;
  joinedOn: DateString;
  qualifications?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  notes?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Sri Lankan NIC: the old 9 digits and a letter, or the new 12 digits. */
const NIC = /^(\d{9}[VX]|\d{12})$/;

const LIMITS = { title: 20, name: 120, designation: 80, address: 300, qualifications: 1000, emergencyName: 120, notes: 1000 } as const;

/** Cleans a submitted staff record, or reports what to fix, field by field. */
export function checkStaffInput(raw: Record<string, unknown>, today: DateString): { value: StaffInput; errors: Record<string, string> } {
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  const errors: Record<string, string> = {};
  const name = text("name");
  const designation = text("designation");
  if (!name) errors.name = "Required";
  if (!designation) errors.designation = "Required";
  for (const [key, max] of Object.entries(LIMITS)) if (text(key).length > max) errors[key] = `Keep this to ${max} characters`;

  const staffType = raw.staffType;
  if (staffType !== "academic" && staffType !== "non_academic") errors.staffType = "Required";

  const phone = normalizeLocalPhone(text("phone"));
  if (!phone) errors.phone = "e.g. 077 123 4567";
  const emergencyPhone = text("emergencyPhone") ? normalizeLocalPhone(text("emergencyPhone")) : "";
  if (emergencyPhone === null) errors.emergencyPhone = "e.g. 077 123 4567";

  const email = text("email").toLowerCase();
  if (email && (!EMAIL.test(email) || email.length > 254)) errors.email = "Enter a valid email";
  const nic = text("nic").toUpperCase();
  if (nic && !NIC.test(nic)) errors.nic = "e.g. 851234567V or 198512345678";
  const gender = text("gender");
  if (gender && gender !== "M" && gender !== "F") errors.gender = "Choose one";

  const dob = text("dob");
  if (dob && !validDate(dob)) errors.dob = "Enter a valid date";
  else if (dob > today) errors.dob = "Can't be in the future";
  const joinedOn = text("joinedOn");
  if (!joinedOn) errors.joinedOn = "Required";
  else if (!validDate(joinedOn)) errors.joinedOn = "Enter a valid date";

  const optional = (value: string) => value || undefined;
  return {
    errors,
    value: {
      title: text("title"),
      name,
      staffType: staffType as StaffType,
      designation,
      phone: phone ?? "",
      email: optional(email),
      gender: optional(gender) as Gender | undefined,
      dob: optional(dob),
      nic: optional(nic),
      address: optional(text("address")),
      joinedOn,
      qualifications: optional(text("qualifications")),
      emergencyName: optional(text("emergencyName")),
      emergencyPhone: optional(emergencyPhone ?? ""),
      notes: optional(text("notes")),
    },
  };
}

/** Why someone can't be marked as left on this date, if so. */
export function checkLeftOn(leftOn: unknown, today: DateString, joinedOn?: DateString): string | undefined {
  if (typeof leftOn !== "string" || !validDate(leftOn)) return "Enter a valid date";
  if (leftOn > today) return "Can't be in the future";
  if (joinedOn && leftOn < joinedOn) return "Can't be before they joined";
  return undefined;
}
