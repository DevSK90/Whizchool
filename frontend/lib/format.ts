import { format, parseISO } from "date-fns";

const lkr = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
  maximumFractionDigits: 0,
});

const lkrPrecise = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-LK");

/** "LKR 15,000" */
export function formatMoney(amount: number, precise = false) {
  return (precise ? lkrPrecise : lkr).format(amount).replace(/ /g, " ");
}

/** "1.2M" — for axis ticks and dense tiles */
export function formatCompact(n: number) {
  return compact.format(n);
}

export function formatNumber(n: number) {
  return integer.format(n);
}

export function formatPercent(n: number, digits = 0) {
  return `${n.toFixed(digits)}%`;
}

function toDate(value: string | Date) {
  return typeof value === "string" ? parseISO(value) : value;
}

/** "24 Oct 2026" */
export function formatDate(value: string | Date) {
  return format(toDate(value), "d MMM yyyy");
}

/** "24 Oct 2026, 10:30" */
export function formatDateTime(value: string | Date) {
  return format(toDate(value), "d MMM yyyy, HH:mm");
}

/** "Oct 2026" from "2026-10" */
export function formatPeriod(period: string) {
  return format(parseISO(`${period}-01`), "MMM yyyy");
}

export function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
