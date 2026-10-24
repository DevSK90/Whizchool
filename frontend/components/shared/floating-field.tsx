"use client";

// Outlined fields whose label sits inside like a placeholder and moves onto the border
// (a "notch") when the field is focused or filled.
import { forwardRef, useState, type ComponentProps, type ReactNode } from "react";
import { format } from "date-fns";
import { CalendarIcon, CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarPanel, parseDate, type DateRangeLimits } from "@/components/shared/date-picker";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const BOX =
  "peer w-full rounded-xl border border-input bg-card px-3.5 text-[15px] text-foreground shadow-xs transition-[border-color,box-shadow] outline-none " +
  "placeholder:text-transparent focus:border-primary focus:ring-3 focus:ring-primary/15 " +
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:ring-destructive/15 disabled:opacity-60";

const LABEL_BASE =
  "pointer-events-none absolute left-3 z-[1] max-w-[calc(100%-1.5rem)] truncate rounded px-1 text-[15px] text-muted-foreground transition-all duration-150";

const LABEL =
  LABEL_BASE +
  " " +
  "peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:bg-card peer-focus:text-xs peer-focus:font-medium peer-focus:text-primary " +
  "peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:-translate-y-1/2 peer-[:not(:placeholder-shown)]:bg-card peer-[:not(:placeholder-shown)]:text-xs " +
  "peer-aria-[invalid=true]:text-destructive";

const FLOATED = "top-0 -translate-y-1/2 bg-card text-xs";

export function HelpTip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className="flex size-7 shrink-0 items-center justify-center rounded-full text-primary/80 hover:bg-primary/10 hover:text-primary">
          <CircleHelp className="size-4.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">{children}</TooltipContent>
    </Tooltip>
  );
}

function Messages({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error) {
    return (
      <p id={`${id}-msg`} role="alert" className="mt-1.5 px-1 text-xs text-destructive">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={`${id}-msg`} className="mt-1.5 px-1 text-xs text-muted-foreground">
      {hint}
    </p>
  ) : null;
}

type BaseProps = { id: string; label: string; error?: string; hint?: ReactNode; help?: ReactNode; helpLabel?: string; className?: string };

export const FloatingInput = forwardRef<HTMLInputElement, BaseProps & Omit<ComponentProps<"input">, "id" | "className"> & { floated?: boolean }>(
  function FloatingInput({ id, label, error, hint, help, helpLabel, className, floated, ...props }, ref) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={ref}
              id={id}
              placeholder=" "
              aria-invalid={!!error}
              aria-describedby={error || hint ? `${id}-msg` : undefined}
              className={cn(BOX, "h-12")}
              {...props}
            />
            <label htmlFor={id} className={cn(LABEL, "top-1/2 -translate-y-1/2", floated && FLOATED)}>
              {label}
            </label>
          </div>
          {help && <HelpTip label={helpLabel ?? label}>{help}</HelpTip>}
        </div>
        <Messages id={id} error={error} hint={hint} />
      </div>
    );
  },
);

export const FloatingTextarea = forwardRef<HTMLTextAreaElement, BaseProps & Omit<ComponentProps<"textarea">, "id" | "className">>(
  function FloatingTextarea({ id, label, error, hint, help, helpLabel, className, ...props }, ref) {
    return (
      <div className={className}>
        <div className="flex items-start gap-2">
          <div className="relative flex-1">
            <textarea
              ref={ref}
              id={id}
              placeholder=" "
              aria-invalid={!!error}
              aria-describedby={error || hint ? `${id}-msg` : undefined}
              className={cn(BOX, "min-h-24 resize-y py-3.5")}
              {...props}
            />
            <label htmlFor={id} className={cn(LABEL, "top-3.5")}>
              {label}
            </label>
          </div>
          {help && (
            <div className="pt-2.5">
              <HelpTip label={helpLabel ?? label}>{help}</HelpTip>
            </div>
          )}
        </div>
        <Messages id={id} error={error} hint={hint} />
      </div>
    );
  },
);

export function FloatingSelect({
  id,
  label,
  error,
  hint,
  className,
  value,
  onValueChange,
  onBlur,
  children,
}: BaseProps & { value?: string; onValueChange: (v: string) => void; onBlur?: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const floated = open || !!value;
  return (
    <div className={className}>
      <div className="relative">
        <Select
          value={value || undefined}
          onValueChange={onValueChange}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) onBlur?.();
          }}
        >
          <SelectTrigger
            id={id}
            aria-invalid={!!error}
            aria-describedby={error || hint ? `${id}-msg` : undefined}
            className={cn(
              "h-12! w-full rounded-xl bg-card px-3.5 text-[15px] shadow-xs dark:bg-card",
              open && "border-primary ring-3 ring-primary/15",
              error && "border-destructive",
            )}
          >
            <SelectValue placeholder="" />
          </SelectTrigger>
          <SelectContent>{children}</SelectContent>
        </Select>
        <label
          htmlFor={id}
          className={cn(
            LABEL_BASE,
            floated ? cn(FLOATED, open ? "font-medium text-primary" : "") : "top-1/2 -translate-y-1/2",
            error && "text-destructive",
          )}
        >
          {label}
        </label>
      </div>
      <Messages id={id} error={error} hint={hint} />
    </div>
  );
}

/** Date field in the floating-label style: opens a calendar with month and year dropdowns. */
export function FloatingDatePicker({
  id,
  label,
  error,
  hint,
  className,
  value,
  onChange,
  onBlur,
  ...limits
}: BaseProps & DateRangeLimits & { value?: string; onChange: (value: string) => void; onBlur?: () => void }) {
  const [open, setOpen] = useState(false);
  const date = parseDate(value);
  const floated = open || !!date;
  return (
    <div className={className}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) onBlur?.();
        }}
      >
        <div className="relative">
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id}
              aria-describedby={error || hint ? `${id}-msg` : undefined}
              className={cn(
                BOX,
                "flex h-12 items-center justify-between text-left",
                open && "border-primary ring-3 ring-primary/15",
                error && "border-destructive",
              )}
            >
              <span className={cn(!date && "invisible")}>{date ? format(date, "d MMMM yyyy") : "—"}</span>
              <CalendarIcon className="size-4 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <label
            htmlFor={id}
            className={cn(
              LABEL_BASE,
              floated ? cn(FLOATED, open && "font-medium text-primary") : "top-1/2 -translate-y-1/2",
              error && "text-destructive",
            )}
          >
            {label}
          </label>
        </div>
        <PopoverContent className="w-auto overflow-hidden rounded-xl p-0" align="start">
          <CalendarPanel
            value={value}
            {...limits}
            onSelect={(iso) => {
              onChange(iso);
              setOpen(false);
              onBlur?.();
            }}
          />
        </PopoverContent>
      </Popover>
      <Messages id={id} error={error} hint={hint} />
    </div>
  );
}

/** Mobile number with a fixed country-code box, as in the reference design. */
export const PhoneField = forwardRef<HTMLInputElement, BaseProps & Omit<ComponentProps<"input">, "id" | "className"> & { code: string }>(
  function PhoneField({ code, className, ...props }, ref) {
    return (
      <div className={cn("flex items-start gap-2.5", className)}>
        <span className="flex h-12 shrink-0 items-center gap-2 rounded-xl border border-input bg-card px-3 text-[15px] text-muted-foreground shadow-xs">
          <span aria-hidden className="flex h-3.5 w-5 overflow-hidden rounded-xs">
            {/* simplified Sri Lankan flag colours */}
            <span className="w-1/4 bg-[#00534e]" />
            <span className="w-1/4 bg-[#f7b718]" />
            <span className="flex-1 bg-[#8d153a]" />
          </span>
          {code.replace(/^LK\s*/, "")}
        </span>
        <FloatingInput ref={ref} type="tel" inputMode="tel" className="flex-1" {...props} />
      </div>
    );
  },
);

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mb-4 text-[11px] font-semibold tracking-[0.12em] text-foreground/70 uppercase", className)}>{children}</p>;
}
