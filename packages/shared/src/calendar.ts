// Academic calendar rules shared by the API and the demo API.

export interface TermDates {
  id: string;
  number: number;
  name: string;
  /** yyyy-mm-dd */
  startDate: string;
  endDate: string;
}

export interface TermProblem {
  termId: string;
  field: "startDate" | "endDate";
  message: string;
}

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Terms must sit inside their academic year, run forwards and follow each other without
 * overlapping. Checked over the whole set, so adjacent terms can be moved together.
 */
export function validateTerms(year: { name: string; startDate: string; endDate: string }, terms: TermDates[]): TermProblem | null {
  const sorted = [...terms].sort((a, b) => a.number - b.number);
  for (const [i, t] of sorted.entries()) {
    if (t.endDate < t.startDate) return { termId: t.id, field: "endDate", message: "Must be after the start date." };
    if (t.startDate < year.startDate || t.endDate > year.endDate) {
      return {
        termId: t.id,
        field: t.startDate < year.startDate ? "startDate" : "endDate",
        message: `Must fall within ${year.name} (${day(year.startDate)} – ${day(year.endDate)}).`,
      };
    }
    const previous = sorted[i - 1];
    if (previous && t.startDate <= previous.endDate) {
      return { termId: t.id, field: "startDate", message: `Must start after ${previous.name} ends (${day(previous.endDate)}).` };
    }
  }
  return null;
}
