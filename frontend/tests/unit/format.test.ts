import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, formatPercent, formatPeriod, initials, toISODate } from "@/lib/format";

describe("format", () => {
  it("formats rupees with a plain space and no cents by default", () => {
    expect(formatMoney(15000)).toBe("LKR 15,000");
    expect(formatMoney(1234.5, true)).toBe("LKR 1,234.50");
  });

  it("formats dates the same way everywhere", () => {
    expect(formatDate("2026-10-24")).toBe("24 Oct 2026");
    expect(formatDateTime("2026-10-24T10:30:00")).toBe("24 Oct 2026, 10:30");
    expect(formatPeriod("2026-11")).toBe("Nov 2026");
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("formats percentages and initials", () => {
    expect(formatPercent(93.456, 1)).toBe("93.5%");
    expect(initials("kavindu  nimesh perera")).toBe("KN");
    expect(initials("")).toBe("");
  });
});
