import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  className?: string;
}) {
  const body = (
    <Card className={cn("h-full gap-0 py-0 shadow-none transition-colors", href && "hover:border-primary/40", className)}>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{label}</span>
          {Icon && <Icon className="size-4" aria-hidden />}
        </div>
        <div className="text-2xl font-semibold tracking-tight tabular">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
