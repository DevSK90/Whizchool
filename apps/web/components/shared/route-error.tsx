"use client";

import { ErrorState } from "./states";

/** Shared body for route-level error.tsx boundaries. */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-10">
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
