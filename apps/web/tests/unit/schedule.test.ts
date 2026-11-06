import { describe, expect, it } from "vitest";
import { scheduleCell, scheduleColumns } from "@whizchool/shared/schedule";

const subjects = [
  { subjectId: "eng", name: "English", average: 60 },
  { subjectId: "bus", name: "Business & Accounting Studies", optionGroup: "basket1", average: 70 },
  { subjectId: "geo", name: "Geography", optionGroup: "basket1", average: 65 },
  { subjectId: "bud", name: "Buddhism", optionGroup: "religion", average: 80 },
  { subjectId: "mat", name: "Mathematics", average: 55 },
];

describe("the mark schedule's columns", () => {
  it("has the compulsory subjects, then one column per choice in the usual order", () => {
    expect(scheduleColumns(subjects, 0).map((c) => c.key)).toEqual(["eng", "mat", "religion:0", "basket1:0"]);
  });

  it("gives each A/L option a column of its own", () => {
    const al = [
      { subjectId: "acc", name: "Accounting", optionGroup: "options", average: 0 },
      { subjectId: "bst", name: "Business Studies", optionGroup: "options", average: 0 },
      { subjectId: "eco", name: "Economics", optionGroup: "options", average: 0 },
      { subjectId: "ict", name: "ICT", optionGroup: "options", average: 0 },
    ];
    const columns = scheduleColumns(al, 3);
    expect(columns.map((c) => c.key)).toEqual(["options:0", "options:1", "options:2"]);
    const marks = [
      { subjectId: "ict", mark: 70, grade: "B" },
      { subjectId: "acc", mark: 80, grade: "A" },
      { subjectId: "eco", mark: "AB" as const, grade: "AB" },
    ];
    expect(columns.map((c) => scheduleCell(c, marks)?.subjectId)).toEqual(["acc", "eco", "ict"]);
  });

  it("puts each student's chosen subject in the group's column, and nothing when they haven't chosen", () => {
    const basket = scheduleColumns(subjects, 0).find((c) => c.key === "basket1:0")!;
    expect(scheduleCell(basket, [{ subjectId: "geo", mark: 72, grade: "B" }])).toEqual({ subjectId: "geo", mark: 72, grade: "B" });
    expect(scheduleCell(basket, [{ subjectId: "eng", mark: 50, grade: "C" }])).toBeUndefined();
  });
});
