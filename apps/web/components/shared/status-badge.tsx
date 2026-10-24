"use client";

import { AlertTriangle, CheckCircle2, Circle, Clock, MinusCircle, XCircle, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE: Record<Tone, { className: string; icon: LucideIcon }> = {
  success: { className: "bg-success/12 text-success ring-success/20", icon: CheckCircle2 },
  warning: { className: "bg-warning/15 text-warning-foreground ring-warning/30 dark:text-warning", icon: Clock },
  danger: { className: "bg-destructive/10 text-destructive ring-destructive/20", icon: AlertTriangle },
  info: { className: "bg-info/10 text-info ring-info/20", icon: Circle },
  neutral: { className: "bg-muted text-muted-foreground ring-border", icon: MinusCircle },
};

/** Status pill: color always paired with an icon and a text label. */
export function Pill({ tone, children, icon, className }: { tone: Tone; children: React.ReactNode; icon?: LucideIcon; className?: string }) {
  const Icon = icon ?? TONE[tone].icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE[tone].className,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

const MAPS = {
  student: { active: "success", left: "neutral", graduated: "info", expelled: "danger" },
  application: { new: "info", interview: "warning", accepted: "success", rejected: "danger", enrolled: "success", withdrawn: "neutral" },
  attendance: { present: "success", absent: "danger", late: "warning", excused: "neutral" },
  exam: { scheduled: "neutral", marks_entry: "warning", review: "info", released: "success" },
  reportCard: { pending_marks: "neutral", draft: "warning", approved: "info", released: "success" },
  invoice: { unpaid: "warning", partial: "info", paid: "success", void: "neutral", overdue: "danger" },
  payment: { completed: "success", pending: "warning", failed: "danger", reversed: "neutral" },
  user: { invited: "warning", active: "success", deactivated: "neutral" },
  message: { queued: "neutral", sending: "info", sent: "success", partial: "warning", failed: "danger" },
} as const satisfies Record<string, Record<string, Tone>>;

type Kind = keyof typeof MAPS;

const ICONS: Partial<Record<string, LucideIcon>> = {
  rejected: XCircle,
  failed: XCircle,
  absent: XCircle,
};

export function StatusBadge<K extends Kind>({ kind, status, className }: { kind: K; status: keyof (typeof MAPS)[K] & string; className?: string }) {
  const t = useTranslations("status");
  const tone = (MAPS[kind] as Record<string, Tone>)[status] ?? "neutral";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const label = t(`${kind}.${status}` as any);
  return (
    <Pill tone={tone} icon={ICONS[status]} className={className}>
      {label}
    </Pill>
  );
}
