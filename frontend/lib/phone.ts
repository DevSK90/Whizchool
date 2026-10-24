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
