import { describe, expect, it } from "vitest";
import { decodeCsv, detectDelimiter, parseCsv, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("parses quoted fields, escaped quotes and CRLF line endings", () => {
    const text = 'name,address\r\n"Perera, K.","12 ""Lake"" Rd"\r\nSilva,Kandy\n';
    expect(parseCsv(text)).toEqual([
      ["name", "address"],
      ["Perera, K.", '12 "Lake" Rd'],
      ["Silva", "Kandy"],
    ]);
  });

  it("keeps newlines inside quotes and skips blank lines", () => {
    expect(parseCsv('a,"line 1\nline 2"\n\n,\n')).toEqual([["a", "line 1\nline 2"]]);
  });

  it("round-trips through toCsv", () => {
    const rows = [["id", "note"], ["1", 'says "hi", twice'], ["2", "multi\nline"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(toCsv([[1, undefined, "x"]])).toBe("1,,x");
  });

  it("detects semicolon and tab delimiters from the header line", () => {
    expect(detectDelimiter("First Name;Last Name;Phone\nA;B;C")).toBe(";");
    expect(detectDelimiter("First Name\tLast Name\nA\tB")).toBe("\t");
    expect(detectDelimiter('"Name; with semicolon",Class\nA,B')).toBe(",");
    expect(detectDelimiter("OnlyOneColumn")).toBe(",");
    expect(parseCsv("a;b\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("decodes UTF-8 with or without a BOM, UTF-16 and Windows-1252", () => {
    const utf8 = new TextEncoder().encode("Name\nකවිඳු");
    expect(decodeCsv(utf8)).toEqual({ text: "Name\nකවිඳු", encoding: "utf-8" });
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])).text).toBe("Name\nකවිඳු");
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from("Hi").flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeCsv(utf16)).toEqual({ text: "Hi", encoding: "utf-16le" });
    // "Café" saved by old Excel: é is the single byte 0xE9, which isn't valid UTF-8.
    expect(decodeCsv(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toEqual({ text: "Café", encoding: "windows-1252" });
  });

  it("defuses cells that spreadsheets would run as formulas", () => {
    expect(toCsv([["=HYPERLINK(\"x\")", "+94 77", "-1", "@sum", "safe"]])).toBe(`"'=HYPERLINK(""x"")",'+94 77,'-1,'@sum,safe`);
    expect(toCsv([[-5]])).toBe("-5");
  });
});
