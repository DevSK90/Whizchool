"use client";

import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const ALL = "__all";

/** A compact filter select where an empty value means "all". */
export function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel?: string;
  options: { value: string; label: ReactNode }[];
  className?: string;
  ariaLabel: string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger className={cn("w-full sm:w-44", className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>{children}</div>;
}
