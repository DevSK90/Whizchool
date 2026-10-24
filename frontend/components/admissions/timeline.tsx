"use client";

import { useTranslations } from "next-intl";
import type { ApplicationStage } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ApplicationTimeline({
  items,
}: {
  items: { stage: ApplicationStage; at: string; by?: string; note?: string }[];
}) {
  const t = useTranslations("status.application");
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {items.map((item, i) => (
        <li key={`${item.stage}-${i}`} className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute top-1 -left-[25px] size-2.5 rounded-full ring-4 ring-background",
              i === items.length - 1 ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <p className="text-sm font-medium">{t(item.stage)}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(item.at)}
            {item.by && ` · ${item.by}`}
          </p>
          {item.note && <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>}
        </li>
      ))}
    </ol>
  );
}
