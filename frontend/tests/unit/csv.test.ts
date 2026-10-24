import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";

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
});
