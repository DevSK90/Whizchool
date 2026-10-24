import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiError, errorMessage } from "@/lib/api/client";

/**
 * Maps API validation errors (422 with `fields`) onto form fields; anything else becomes a toast.
 * Returns true when at least one field error was applied.
 */
export function applyServerErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>) {
  if (error instanceof ApiError && error.fields) {
    const entries = Object.entries(error.fields).filter(([, msg]) => !!msg);
    entries.forEach(([field, message], i) => setError(field as Path<T>, { type: "server", message }, { shouldFocus: i === 0 }));
    if (entries.length) return true;
  }
  toast.error(errorMessage(error));
  return false;
}
