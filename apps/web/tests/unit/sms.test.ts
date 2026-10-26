import { describe, expect, it } from "vitest";
import { smsLength } from "@whizchool/shared/sms";

describe("smsLength", () => {
  it("fits 160 English characters in one message and 153 per part after that", () => {
    expect(smsLength("a".repeat(160))).toEqual({ encoding: "GSM-7", units: 160, parts: 1, perPart: 160 });
    expect(smsLength("a".repeat(161))).toMatchObject({ parts: 2, perPart: 153 });
    expect(smsLength("a".repeat(306)).parts).toBe(2);
    expect(smsLength("a".repeat(307)).parts).toBe(3);
  });

  it("counts extended GSM characters twice", () => {
    expect(smsLength("€{}").units).toBe(6);
  });

  it("switches to UCS-2 for Sinhala and Tamil: 70 per message, 67 per part", () => {
    const sinhala = "දෙමාපියන්ට දැනුම් දීමයි";
    expect(smsLength(sinhala)).toMatchObject({ encoding: "UCS-2", parts: 1, perPart: 70 });
    expect(smsLength("அ".repeat(70)).parts).toBe(1);
    expect(smsLength("அ".repeat(71))).toMatchObject({ parts: 2, perPart: 67 });
    // One Sinhala word turns a whole English message into UCS-2.
    expect(smsLength(`${"a".repeat(100)} ශ්‍රී`).parts).toBe(2);
  });

  it("treats an empty message as one part", () => {
    expect(smsLength("")).toMatchObject({ units: 0, parts: 1 });
  });
});
