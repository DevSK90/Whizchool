import { describe, expect, it } from "vitest";
import { nameTokens, sameGuardianName } from "@whizchool/shared/people";

describe("sameGuardianName", () => {
  it("ignores titles, punctuation and case, and lets initials stand for names", () => {
    expect(nameTokens("Mrs. D. Perera")).toEqual(["d", "perera"]);
    expect(sameGuardianName("Mrs. Dilani Perera", "dilani perera")).toBe(true);
    expect(sameGuardianName("Mrs. Dilani Perera", "D. Perera")).toBe(true);
    expect(sameGuardianName("U. Abeysekara", "Mr Upul Abeysekara")).toBe(true);
  });

  it("keeps different people apart, including spouses who share a phone", () => {
    expect(sameGuardianName("Mrs. Kumari Perera", "Mr. Applicant Father")).toBe(false);
    expect(sameGuardianName("Mr. Upul Abeysekara", "Mrs. Gayani Abeysekara")).toBe(false);
    expect(sameGuardianName("Mr. D. P.", "Mr. Dilan Perera")).toBe(false);
    expect(sameGuardianName("", "Mr. Perera")).toBe(false);
  });
});
