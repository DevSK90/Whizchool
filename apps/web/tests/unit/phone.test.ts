import { describe, expect, it } from "vitest";
import { mobileDigits, toInternationalPhone, toLocalPhone } from "@whizchool/shared/phone";

describe("phone", () => {
  it.each(["77 123 4567", "077 123 4567", "0771234567", "+94 77 123 4567", "94771234567", "(077) 123-4567"])("normalizes %s", (input) => {
    expect(mobileDigits(input)).toBe("771234567");
  });

  it.each(["", "12345", "077 123 456", "011 234 5678", "+1 415 555 0100", "0094771234567"])("rejects %s", (input) => {
    expect(mobileDigits(input)).toBeNull();
  });

  it("formats local and international forms", () => {
    expect(toLocalPhone("771234567")).toBe("077 123 4567");
    expect(toInternationalPhone("771234567")).toBe("+94 77 123 4567");
  });
});
