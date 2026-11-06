// A class's mark schedule: one column per subject everyone takes, and one per choice the students make,
// so an O/L class reads as nine subjects a student rather than every subject the class offers.
import { picksFor } from "./curriculum";
import type { MarkValue } from "./types";

export interface ScheduleSubject {
  subjectId: string;
  name: string;
  optionGroup?: string;
  average: number;
}

export interface ScheduleMark {
  subjectId: string;
  mark: MarkValue;
  grade: string;
}

export type ScheduleColumn =
  | { key: string; kind: "subject"; subjectId: string; name: string; average: number }
  /** The nth subject a student chose in a group (n counts from 0); most groups have one. */
  | { key: string; kind: "group"; group: string; index: number; picks: number; subjectIds: string[] };

const GROUP_ORDER = ["first_language", "religion", "basket1", "basket2", "basket3", "options"];

export function scheduleColumns(subjects: ScheduleSubject[], optionsRequired: number): ScheduleColumn[] {
  const columns: ScheduleColumn[] = subjects
    .filter((s) => !s.optionGroup)
    .map((s) => ({ key: s.subjectId, kind: "subject", subjectId: s.subjectId, name: s.name, average: s.average }));
  const groups = [...new Set(subjects.flatMap((s) => (s.optionGroup ? [s.optionGroup] : [])))].sort(
    (a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99),
  );
  for (const group of groups) {
    const subjectIds = subjects.filter((s) => s.optionGroup === group).map((s) => s.subjectId);
    const picks = Math.max(1, picksFor(group, optionsRequired));
    for (let index = 0; index < picks; index++) columns.push({ key: `${group}:${index}`, kind: "group", group, index, picks, subjectIds });
  }
  return columns;
}

/** A student's entry in a column, or undefined when they don't take it (or haven't chosen yet). */
export function scheduleCell(column: ScheduleColumn, marks: ScheduleMark[]): ScheduleMark | undefined {
  if (column.kind === "subject") return marks.find((m) => m.subjectId === column.subjectId);
  // Chosen subjects in the group's own order (by name), so each fills the next column.
  const chosen = column.subjectIds.flatMap((id) => marks.filter((m) => m.subjectId === id));
  return chosen[column.index];
}
