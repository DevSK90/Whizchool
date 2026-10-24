"use client";

// shadcn-style date inputs (Popover + Calendar with month/year dropdowns).
// Values are ISO strings ("yyyy-MM-dd", "yyyy-MM", "HH:mm") so they drop into existing forms and URL state.
import { useState } from "react";
import { endOfYear, format, isValid, parseISO, startOfYear } from "date-fns";
import { CalendarIcon, ChevronDown, Clock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MONTHS = Array.from({ length: 12 }, (_, i) => format(new Date(2026, i, 1), "MMMM"));

export function parseDate(value?: string) {
  if (!value) return undefined;
  const d = parseISO(value);
  return isValid(d) ? d : undefined;
}

export interface DateRangeLimits {
  /** Earliest selectable date (yyyy-MM-dd) */
  min?: string;
  /** Latest selectable date (yyyy-MM-dd) */
  max?: string;
  /** Year range shown in the year dropdown */
  fromYear?: number;
  toYear?: number;
}

/** Calendar popover body shared by both pickers. */
function CalendarPanel({
  value,
  onSelect,
  min,
  max,
  fromYear,
  toYear,
}: DateRangeLimits & { value?: string; onSelect: (iso: string) => void }) {
  const selected = parseDate(value);
  const minDate = parseDate(min);
  const maxDate = parseDate(max);
  const now = new Date();
  const startMonth = fromYear ? startOfYear(new Date(fromYear, 0, 1)) : (minDate ?? startOfYear(new Date(now.getFullYear() - 20, 0, 1)));
  const endMonth = toYear ? endOfYear(new Date(toYear, 0, 1)) : (maxDate ?? endOfYear(new Date(now.getFullYear() + 2, 0, 1)));
  const disabled = [...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])];
  return (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      selected={selected}
      defaultMonth={selected ?? maxDate ?? undefined}
      startMonth={startMonth}
      endMonth={endMonth}
      disabled={disabled}
      onSelect={(d) => d && onSelect(format(d, "yyyy-MM-dd"))}
      autoFocus
    />
  );
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder,
  className,
  invalid,
  disabled,
  clearable,
  align = "start",
  ...limits
}: DateRangeLimits & {
  id?: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  align?: "start" | "center" | "end";
}) {
  const t = useTranslations("common.a11y");
  const [open, setOpen] = useState(false);
  const date = parseDate(value);
  const showClear = clearable && !!date && !disabled;
  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid}
            data-empty={!date}
            className={cn("w-full justify-start gap-2 px-2.5 font-normal data-[empty=true]:text-muted-foreground", showClear && "pr-8")}
          >
            <CalendarIcon className="text-muted-foreground" />
            <span className="flex-1 truncate text-left">{date ? format(date, "d MMM yyyy") : (placeholder ?? t("pickDate"))}</span>
            {!showClear && <ChevronDown className="text-muted-foreground" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align={align}>
          <CalendarPanel
            value={value}
            {...limits}
            onSelect={(iso) => {
              onChange(iso);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {showClear && (
        <button
          type="button"
          aria-label={t("clearDate")}
          onClick={() => onChange("")}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Month + year selects for month-only values ("yyyy-MM"). */
export function MonthPicker({
  value,
  onChange,
  fromYear = new Date().getFullYear() - 2,
  toYear = new Date().getFullYear() + 1,
  allLabel,
  className,
  ariaLabel,
}: {
  value?: string;
  onChange: (value: string) => void;
  fromYear?: number;
  toYear?: number;
  /** When set, an empty value is allowed and shown with this label */
  allLabel?: string;
  className?: string;
  ariaLabel: string;
}) {
  const t = useTranslations("common.a11y");
  const [y, m] = value ? value.split("-") : ["", ""];
  const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => String(toYear - i));
  const NONE = "__none";
  const set = (year: string, month: string) => onChange(year && month ? `${year}-${month}` : "");
  return (
    <div className={cn("flex gap-2", className)} role="group" aria-label={ariaLabel}>
      <Select
        value={m || NONE}
        onValueChange={(v) => (v === NONE ? onChange("") : set(y || String(new Date().getFullYear()), v))}
      >
        <SelectTrigger className="w-full min-w-32" aria-label={t("month", { label: ariaLabel })}>
          <CalendarIcon className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value={NONE}>{allLabel}</SelectItem>}
          {MONTHS.map((name, i) => (
            <SelectItem key={name} value={String(i + 1).padStart(2, "0")}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={y || undefined} onValueChange={(v) => set(v, m || "01")} disabled={!m && !!allLabel}>
        <SelectTrigger className="w-28" aria-label={t("year", { label: ariaLabel })}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => (
            <SelectItem key={year} value={year}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Time slot select ("HH:mm") between `from` and `to` hours. */
export function TimeSelect({
  id,
  value,
  onChange,
  from = 7,
  to = 17,
  stepMinutes = 30,
  placeholder,
  invalid,
  className,
}: {
  id?: string;
  value?: string;
  onChange: (value: string) => void;
  from?: number;
  to?: number;
  stepMinutes?: number;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}) {
  const t = useTranslations("common.a11y");
  const slots: string[] = [];
  for (let mins = from * 60; mins <= to * 60; mins += stepMinutes) {
    slots.push(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
  }
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} aria-invalid={invalid} className={cn("w-full", className)}>
        <Clock className="text-muted-foreground" />
        <SelectValue placeholder={placeholder ?? t("time")} />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {slots.map((s) => (
          <SelectItem key={s} value={s}>
            {format(parseISO(`2026-01-01T${s}`), "h:mm a")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { CalendarPanel };
