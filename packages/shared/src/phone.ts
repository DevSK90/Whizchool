// Sri Lankan mobile numbers: 9 national digits, written locally as "077 123 4567".

/** Accepts "77 123 4567", "077 123 4567" or "+94 77 123 4567"; returns the 9 national digits or null. */
export function mobileDigits(value: string) {
  let d = value.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("94")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = d.slice(1);
  // Mobile numbers are 7X XXX XXXX nationally (070–078 locally).
  return /^7\d{8}$/.test(d) ? d : null;
}

/** "771234567" → "077 123 4567" */
export const toLocalPhone = (digits: string) => `0${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;

/** "771234567" → "+94 77 123 4567" */
export const toInternationalPhone = (digits: string) => `+94 ${toLocalPhone(digits).slice(1)}`;

/**
 * Any Sri Lankan number (mobile or landline) in the stored "0XX XXX XXXX" form, or null.
 * Accepts +94 / 94 prefixes and 9-digit numbers whose leading 0 a spreadsheet dropped.
 */
export function normalizeLocalPhone(value: string) {
  let d = value.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("94")) d = d.slice(2);
  if (d.length === 9 && !d.startsWith("0")) d = `0${d}`;
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : null;
}

/** The stored phone format: "077 123 4567" (landlines use the same 3-3-4 grouping). */
export const LOCAL_PHONE = /^0\d{2} \d{3} \d{4}$/;
