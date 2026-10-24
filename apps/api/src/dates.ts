import { z } from "zod";

/** Calendar days travel as "yyyy-mm-dd" and are stored as Postgres `date` (UTC midnight in JS). */
export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

export const fromIsoDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** A real calendar date in "yyyy-mm-dd" form (rejects 2026-02-30). */
export const isoDate = (message = "Enter a valid date") =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, message)
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && toIsoDate(fromIsoDate(s)) === s, message);

