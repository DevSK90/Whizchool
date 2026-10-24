import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label/value pairs; empty values are skipped. */
export function DetailList({ items, className }: { items: { label: ReactNode; value?: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {items
        .filter((i) => i.value !== undefined && i.value !== null && i.value !== "")
        .map((i, idx) => (
          <div key={idx} className="min-w-0">
            <dt className="text-muted-foreground">{i.label}</dt>
            <dd className="mt-0.5 break-words font-medium">{i.value}</dd>
          </div>
        ))}
    </dl>
  );
}
