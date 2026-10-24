// Grading rules for term-test results (Sri Lankan A/B/C/S/W scale by default; bands are configurable).
import type { GradeBand, MarkValue } from "@/lib/api/types";

export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { grade: "A", min: 75, max: 100, label: "Distinction", pass: true },
  { grade: "B", min: 65, max: 74, label: "Very good", pass: true },
  { grade: "C", min: 50, max: 64, label: "Credit", pass: true },
  { grade: "S", min: 35, max: 49, label: "Simple pass", pass: true },
  { grade: "W", min: 0, max: 34, label: "Weak", pass: false },
];

export function gradeFor(mark: MarkValue, bands: GradeBand[] = DEFAULT_GRADE_BANDS) {
  if (mark === null) return "—";
  if (mark === "AB") return "AB";
  return bands.find((b) => mark >= b.min && mark <= b.max)?.grade ?? "—";
}

/** Absent counts as 0 towards the average; subjects without a mark are excluded. */
export function summarizeMarks(marks: MarkValue[]) {
  const counted = marks.filter((m): m is number | "AB" => m !== null);
  const total = counted.reduce<number>((sum, m) => sum + (m === "AB" ? 0 : m), 0);
  const average = counted.length ? total / counted.length : 0;
  return { total, average: Math.round(average * 100) / 100, subjects: counted.length };
}

/** Standard competition ranking: equal averages share a rank (1, 2, 2, 4). */
export function rankByAverage<T extends { average: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.average - a.average);
  let rank = 0;
  let prev: number | undefined;
  return sorted.map((row, i) => {
    if (row.average !== prev) rank = i + 1;
    prev = row.average;
    return { ...row, rank };
  });
}

export function validateBands(bands: GradeBand[]): string | null {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  if (sorted[0]?.max !== 100) return "The top band must end at 100.";
  if (sorted[sorted.length - 1]?.min !== 0) return "The lowest band must start at 0.";
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].min !== sorted[i + 1].max + 1) {
      return `Bands ${sorted[i + 1].grade} and ${sorted[i].grade} must be contiguous.`;
    }
    if (sorted[i].min > sorted[i].max) return `Band ${sorted[i].grade} has min greater than max.`;
  }
  return null;
}
