import { describe, expect, it } from "vitest";
import { DEFAULT_GRADE_BANDS, gradeFor, rankByAverage, summarizeMarks, validateBands } from "@/lib/grading";

describe("gradeFor", () => {
  it.each([
    [100, "A"],
    [75, "A"],
    [74, "B"],
    [65, "B"],
    [64, "C"],
    [50, "C"],
    [49, "S"],
    [35, "S"],
    [34, "W"],
    [0, "W"],
  ])("%i → %s", (mark, grade) => expect(gradeFor(mark)).toBe(grade));

  it("shows AB for absent and a dash when there is no mark", () => {
    expect(gradeFor("AB")).toBe("AB");
    expect(gradeFor(null)).toBe("—");
  });

  it("uses custom bands", () => {
    const bands = [
      { grade: "P", min: 40, max: 100, label: "Pass", pass: true },
      { grade: "F", min: 0, max: 39, label: "Fail", pass: false },
    ];
    expect(gradeFor(40, bands)).toBe("P");
    expect(gradeFor(39, bands)).toBe("F");
  });
});

describe("summarizeMarks", () => {
  it("counts AB as 0 and leaves out subjects with no mark", () => {
    expect(summarizeMarks([80, "AB", null, 70])).toEqual({ total: 150, average: 50, subjects: 3 });
  });

  it("rounds the average to 2 decimals", () => {
    expect(summarizeMarks([70, 71, 71]).average).toBe(70.67);
  });

  it("returns zeros when nothing is entered", () => {
    expect(summarizeMarks([null, null])).toEqual({ total: 0, average: 0, subjects: 0 });
  });
});

describe("rankByAverage", () => {
  it("uses competition ranking for ties (1, 2, 2, 4)", () => {
    const ranked = rankByAverage([
      { id: "a", average: 60 },
      { id: "b", average: 80 },
      { id: "c", average: 70 },
      { id: "d", average: 70 },
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["d", 2],
      ["a", 4],
    ]);
  });
});

describe("validateBands", () => {
  it("accepts the default Sri Lankan bands", () => expect(validateBands(DEFAULT_GRADE_BANDS)).toBeNull());

  it("rejects gaps, a top below 100 and a bottom above 0", () => {
    const [a, b, ...rest] = DEFAULT_GRADE_BANDS;
    expect(validateBands([{ ...a, min: 76 }, b, ...rest])).toMatch(/contiguous/);
    expect(validateBands([{ ...a, max: 99 }, b, ...rest])).toMatch(/100/);
    expect(validateBands(DEFAULT_GRADE_BANDS.slice(0, -1))).toMatch(/start at 0/);
  });
});
