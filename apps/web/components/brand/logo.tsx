import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M7.5 11.5 11 22l3.2-7.6L17.4 22 21 11.5"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.5" cy="10" r="2.4" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight">Whizchool</span>
        {subtitle && <span className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}
