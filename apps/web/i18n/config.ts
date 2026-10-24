// UI languages. English ships first; Sinhala ("si") and Tamil ("ta") will be added as message files later.
export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const timeZone = "Asia/Colombo";
