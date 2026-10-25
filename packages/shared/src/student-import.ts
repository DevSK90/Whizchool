// Student CSV import: which columns exist, how headers are recognised, and how cell values are
// cleaned up. The web app uses this to map and preview a file; the API runs the same checks again
// before saving, so what the preview promises is what gets imported.
import { normalizeLocalPhone } from "./phone";
import type { ImportRow } from "./types";

export type ImportFieldKey = keyof ImportRow;

export interface ImportField {
  key: ImportFieldKey;
  label: string;
  required: boolean;
  /** Header spellings recognised for this column, in addition to the label and key. */
  aliases: string[];
  example: string;
  /** What the cell may contain, shown in the column guide. */
  accepts: string;
}

/** Column order of the downloadable template. Files may use any order. */
export const IMPORT_FIELDS: ImportField[] = [
  {
    key: "admissionNo",
    label: "Admission No",
    required: false,
    aliases: ["admission number", "adm no", "admno", "index no", "index number", "student id", "student no", "reg no", "registration no"],
    example: "10851",
    accepts: "Leave empty to number new students automatically. Must not already exist.",
  },
  { key: "firstName", label: "First Name", required: true, aliases: ["given name", "forename", "student first name"], example: "Senul", accepts: "Text" },
  { key: "lastName", label: "Last Name", required: true, aliases: ["surname", "family name", "student last name", "student surname"], example: "Abeysekara", accepts: "Text" },
  { key: "gender", label: "Gender", required: true, aliases: ["sex"], example: "M", accepts: "M or F (Male, Female, Boy and Girl also work)" },
  {
    key: "dob",
    label: "Date of Birth",
    required: true,
    aliases: ["dob", "birth date", "birthdate", "birthday", "date of birth (dd/mm/yyyy)"],
    example: "14/03/2016",
    accepts: "DD/MM/YYYY, YYYY-MM-DD or 14 Mar 2016",
  },
  {
    key: "className",
    label: "Class",
    required: true,
    aliases: ["class name", "grade class", "grade and class", "grade/class", "class section", "section"],
    example: "4-A",
    accepts: "An existing class this year: 4-A, 4A, 4 A or Grade 4 A (A/L: 12-PS)",
  },
  {
    key: "guardianName",
    label: "Guardian Name",
    required: true,
    aliases: ["guardian", "parent", "parent name", "parents name", "guardians name", "parent/guardian", "parent/guardian name", "mother/father name"],
    example: "Mr. Upul Abeysekara",
    accepts: "Text",
  },
  {
    key: "guardianPhone",
    label: "Guardian Phone",
    required: true,
    aliases: ["phone", "mobile", "mobile no", "mobile number", "contact", "contact no", "contact number", "telephone", "tel", "parent phone", "parents phone", "guardians phone", "parent mobile", "guardian mobile"],
    example: "077 456 1290",
    accepts: "Sri Lankan number: 0771234567, 077 123 4567, +94 77 123 4567 (a missing leading 0 is restored)",
  },
  {
    key: "guardianEmail",
    label: "Guardian Email",
    required: false,
    aliases: ["email", "e-mail", "email address", "parent email", "parents email", "guardians email"],
    example: "upul.abey@gmail.com",
    accepts: "Needed to invite the parent to the portal",
  },
  {
    key: "guardianRelationship",
    label: "Relationship",
    required: false,
    aliases: ["guardian relationship", "relation", "relationship to student"],
    example: "Father",
    accepts: "Father, Mother or Guardian (default: Guardian)",
  },
  { key: "address", label: "Address", required: false, aliases: ["home address", "residential address", "student address"], example: "12 Lake Drive, Kandy", accepts: "Text" },
  { key: "religion", label: "Religion", required: false, aliases: [], example: "Buddhism", accepts: "Text" },
  {
    key: "joinedDate",
    label: "Admission Date",
    required: false,
    aliases: ["date of admission", "joined", "joined date", "date joined", "enrolled", "enrollment date", "enrolment date"],
    example: "05/01/2021",
    accepts: "When the student joined the school (default: today)",
  },
];

export const REQUIRED_IMPORT_FIELDS = IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key);

/** "Guardian's Phone No." → "guardiansphoneno": case, spacing and punctuation don't matter. */
export function normalizeHeader(header: string) {
  return header
    .replace(/^﻿/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_INDEX = new Map<string, ImportFieldKey>();
for (const f of IMPORT_FIELDS) for (const name of [f.key, f.label, ...f.aliases]) HEADER_INDEX.set(normalizeHeader(name), f.key);

export interface ColumnMapping {
  /** Field → index of the column holding it. */
  fields: Partial<Record<ImportFieldKey, number>>;
  /** Columns that matched no field (ignored unless mapped by hand). */
  unmatched: number[];
  /** Required fields with no column. */
  missing: ImportFieldKey[];
  /** Fields that two or more columns claim; the first is used. */
  duplicates: { field: ImportFieldKey; columns: number[] }[];
}

/** Recognises columns by their header text, in any order. */
export function matchColumns(headers: string[]): ColumnMapping {
  const fields: Partial<Record<ImportFieldKey, number>> = {};
  const claims = new Map<ImportFieldKey, number[]>();
  const unmatched: number[] = [];
  headers.forEach((h, i) => {
    const key = HEADER_INDEX.get(normalizeHeader(h));
    if (!key) {
      if (h.trim()) unmatched.push(i);
      return;
    }
    claims.set(key, [...(claims.get(key) ?? []), i]);
    fields[key] ??= i;
  });
  return {
    fields,
    unmatched,
    missing: REQUIRED_IMPORT_FIELDS.filter((k) => fields[k] === undefined),
    duplicates: [...claims].filter(([, cols]) => cols.length > 1).map(([field, columns]) => ({ field, columns })),
  };
}

/** Turns data rows (header row excluded) into ImportRows using a mapping; fully blank rows are dropped. */
export function rowsFromTable(body: string[][], fields: Partial<Record<ImportFieldKey, number>>) {
  return body
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((r) => {
      const row = {} as Record<ImportFieldKey, string>;
      for (const f of IMPORT_FIELDS) row[f.key] = fields[f.key] === undefined ? "" : (r[fields[f.key]!] ?? "").trim();
      return row as ImportRow;
    });
}

// ── Cell values ──

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoIfReal(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface ParsedValue {
  value?: string;
  error?: string;
  warning?: string;
}

/**
 * Dates as schools write them. Day comes first (DD/MM/YYYY, the Sri Lankan order); a value that
 * only makes sense month-first (05/14/2015) is read that way with a warning.
 */
export function parseImportDate(raw: string): ParsedValue {
  const s = raw.trim();
  if (!s) return {};
  const invalid = { error: `“${s}” isn't a date we can read. Use DD/MM/YYYY or YYYY-MM-DD.` };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) {
    const iso = isoIfReal(+m[1], +m[2], +m[3]);
    return iso ? { value: iso } : invalid;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    if (m[3].length !== 4) return { error: `“${s}”: use a 4-digit year, e.g. 14/03/2016.` };
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    const dayFirst = isoIfReal(y, b, a);
    if (dayFirst) return { value: dayFirst };
    const monthFirst = isoIfReal(y, a, b);
    if (monthFirst) return { value: monthFirst, warning: `Read “${s}” as month/day/year (${monthFirst}); check it.` };
    return invalid;
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const iso = month ? isoIfReal(+m[3], month, +m[1]) : null;
    return iso ? { value: iso } : invalid;
  }
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const iso = month ? isoIfReal(+m[3], month, +m[2]) : null;
    return iso ? { value: iso } : invalid;
  }
  return invalid;
}

export function parseImportGender(raw: string): "M" | "F" | null {
  const g = raw.trim().toLowerCase();
  if (["m", "male", "boy", "b"].includes(g)) return "M";
  if (["f", "female", "girl", "g"].includes(g)) return "F";
  return null;
}

/** "10A", "10 a", "Grade 10-A", "Gr. 10/A" → "10-A"; anything else is returned upper-cased. */
export function normalizeClassName(raw: string) {
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/^(GRADE|GR\.?|CLASS|STD\.?|YEAR)\s*/, "");
  // A separator is needed before a numeric section ("10-1"); without one the section must start
  // with a letter ("10A"), or "10" would read as grade 1, section 0.
  const m = s.match(/^(\d{1,2})(?:\s*[-/ .]\s*([A-Z0-9]{1,6})|([A-Z][A-Z0-9]{0,5}))$/);
  return m ? `${Number(m[1])}-${m[2] ?? m[3]}` : s;
}

export function parseRelationship(raw: string): { value: "Father" | "Mother" | "Guardian"; warning?: string } {
  const r = raw.trim().toLowerCase();
  if (!r) return { value: "Guardian" };
  if (["father", "dad", "f", "thaththa", "appa"].includes(r)) return { value: "Father" };
  if (["mother", "mom", "mum", "m", "amma"].includes(r)) return { value: "Mother" };
  if (r === "guardian") return { value: "Guardian" };
  return { value: "Guardian", warning: `Relationship “${raw.trim()}” recorded as Guardian.` };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CheckedImportRow {
  /** Cleaned values: ISO dates, M/F, "077 123 4567", "10-A". */
  data: ImportRow;
  errors: string[];
  warnings: string[];
}

/**
 * Cleans and checks one row on its own (no database needed). The API adds the checks that need
 * data: the class exists, the admission number is free, the guardian already exists.
 */
export function checkImportRow(row: ImportRow, today = new Date().toISOString().slice(0, 10)): CheckedImportRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

  // Spreadsheets turn 10850 into "10850.0".
  const admissionNo = text(row.admissionNo).replace(/^(\d+)\.0+$/, "$1");
  const firstName = text(row.firstName);
  const lastName = text(row.lastName);
  if (!firstName) errors.push("First name is missing");
  if (!lastName) errors.push("Last name is missing");

  const gender = parseImportGender(row.gender ?? "");
  if (!gender) errors.push(row.gender?.trim() ? `Gender “${row.gender.trim()}” must be M or F` : "Gender is missing");

  const dob = parseImportDate(row.dob ?? "");
  if (!row.dob?.trim()) errors.push("Date of birth is missing");
  else if (dob.error) errors.push(`Date of birth: ${dob.error}`);
  else {
    if (dob.warning) warnings.push(`Date of birth: ${dob.warning}`);
    const age = Number(today.slice(0, 4)) - Number(dob.value!.slice(0, 4));
    if (dob.value! > today) errors.push("Date of birth is in the future");
    else if (age < 3 || age > 22) warnings.push(`Age ${age} looks unusual for a school student`);
  }

  const className = normalizeClassName(row.className ?? "");
  if (!className) errors.push("Class is missing");
  else if (/^\d{1,2}$/.test(className)) errors.push(`Class “${className}” needs a section, e.g. ${className}-A`);

  const guardianName = text(row.guardianName);
  if (!guardianName) errors.push("Guardian name is missing");
  const rawPhone = text(row.guardianPhone);
  // Two numbers in one cell ("077… / 071…"): keep the first.
  const firstPhone = rawPhone.split(/[,/;]| or /i)[0] ?? "";
  const guardianPhone = normalizeLocalPhone(firstPhone);
  if (!rawPhone) errors.push("Guardian phone is missing");
  else if (!guardianPhone) errors.push(`Guardian phone “${rawPhone}” isn't a Sri Lankan number`);
  else if (firstPhone.trim() !== rawPhone) warnings.push(`Kept the first phone number of “${rawPhone}”`);

  const guardianEmail = text(row.guardianEmail).toLowerCase();
  if (guardianEmail && !EMAIL.test(guardianEmail)) errors.push(`Guardian email “${guardianEmail}” isn't valid`);
  if (!guardianEmail) warnings.push("No guardian email: the parent can't be invited to the portal");

  const relationship = parseRelationship(row.guardianRelationship ?? "");
  if (relationship.warning) warnings.push(relationship.warning);

  const joined = parseImportDate(row.joinedDate ?? "");
  if (joined.error) errors.push(`Admission date: ${joined.error}`);
  else if (joined.warning) warnings.push(`Admission date: ${joined.warning}`);
  else if (joined.value && joined.value > today) errors.push("Admission date is in the future");

  return {
    data: {
      admissionNo,
      firstName,
      lastName,
      gender: gender ?? text(row.gender),
      dob: dob.value ?? text(row.dob),
      className,
      guardianName,
      guardianPhone: guardianPhone ?? rawPhone,
      guardianEmail,
      guardianRelationship: relationship.value,
      address: text(row.address),
      religion: text(row.religion),
      joinedDate: joined.value ?? "",
    },
    errors,
    warnings,
  };
}

/** Upper bounds the API enforces per import. */
export const IMPORT_LIMITS = { rows: 2000, bytes: 5 * 1024 * 1024 } as const;
