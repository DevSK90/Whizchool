import { beforeAll, describe, expect, it } from "vitest";
import { scheduleCell, scheduleColumns } from "@whizchool/shared/schedule";
import { get, login, resetData, type Json } from "./helpers";

let classes: Json[];
const classNamed = (name: string) => classes.find((c) => c.name === name).id as string;
const view = (examId: string, className: string) => get("/report-cards", { examId, classId: classNamed(className) });

beforeAll(async () => {
  await resetData();
  await login("admin");
  classes = await get("/classes");
});

/** Each student's row must carry exactly the marks on their own report card. */
async function expectMatchesCards(examId: string, v: Json) {
  for (const row of v.rows.slice(0, 5)) {
    const card = await get(`/report-cards/${examId}/${row.studentId}`);
    expect(row.marks).toEqual(card.subjects.map((s: Json) => ({ subjectId: s.subjectId, mark: s.mark, grade: s.grade })));
  }
}

describe("the class mark schedule", () => {
  it("has every subject the class offers, and each student's marks as on their report card", async () => {
    const v = await view("exam_2026_3", "10-A");
    const group = (name: string) => v.subjects.find((s: Json) => s.name === name)?.optionGroup;
    expect(group("Mathematics")).toBeUndefined();
    expect(group("Sinhala")).toBe("first_language");
    expect(group("Business & Accounting Studies")).toBe("basket1");
    expect(v.subjects.find((s: Json) => s.name === "Mathematics").average).toEqual(expect.any(Number));
    await expectMatchesCards("exam_2026_3", v);

    // A student sits each compulsory subject, and at most one subject per choice group.
    const columns = scheduleColumns(v.subjects, v.optionsRequired ?? 0);
    expect(columns.filter((c) => c.kind === "group").map((c) => c.key)).toEqual(["first_language:0", "religion:0", "basket1:0", "basket2:0", "basket3:0"]);
    for (const row of v.rows) {
      const shown = columns.map((c) => scheduleCell(c, row.marks)).filter(Boolean);
      expect(shown).toHaveLength(row.marks.length);
    }
  });

  it("reads from the frozen results once report cards are released", async () => {
    const v = await view("exam_2026_2", "10-A");
    expect(v.status).toBe("released");
    expect(v.rows.every((r: Json) => r.marks.length > 0)).toBe(true);
    await expectMatchesCards("exam_2026_2", v);
  });

  it("gives A/L Commerce one column per option a student takes", async () => {
    const v = await view("exam_2026_3", "12-COM");
    expect(v.optionsRequired).toBe(3);
    const columns = scheduleColumns(v.subjects, v.optionsRequired);
    expect(columns.filter((c) => c.kind === "group").map((c) => c.key)).toEqual(["options:0", "options:1", "options:2"]);
    expect(columns.some((c) => c.kind === "subject" && c.name === "General English")).toBe(true);
    await expectMatchesCards("exam_2026_3", v);
  });
});
