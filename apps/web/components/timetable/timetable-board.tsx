"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Coffee, MapPin, User } from "lucide-react";
import {
  TIMETABLE_DAYS,
  formatTime,
  formatTimeRange,
} from "@whizchool/shared/timetable";
import type { TimetableBlock } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Vertical scale of every board: a 40-minute lesson is 80px tall, room for three lines. */
export const PX_PER_MINUTE = 2;

export type BoardBlock = TimetableBlock & { className?: string };

/** Today as 1 (Monday) to 5 (Friday) and the minutes since midnight, once in the browser; null on weekends. */
export function useSchoolClock() {
  const [now, setNow] = useState<{
    day: number | null;
    minutes: number;
  } | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const day = d.getDay();
      setNow({
        day: day >= 1 && day <= 5 ? day : null,
        minutes: d.getHours() * 60 + d.getMinutes(),
      });
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A steady colour per subject across every view, mixed with the card colour so it works in light and dark. */
function subjectHue(subjectId: string) {
  let h = 0;
  for (const ch of subjectId) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return Math.round(h / 30) * 30;
}

export function blockStyle(
  block: Pick<TimetableBlock, "kind" | "subjectId">,
): CSSProperties {
  if (block.kind !== "lesson" || !block.subjectId) return {};
  const accent = `oklch(0.62 0.15 ${subjectHue(block.subjectId)})`;
  return {
    background: `color-mix(in oklab, ${accent} 16%, var(--card))`,
    borderLeftColor: accent,
  };
}

export interface LaidOutBlock<T extends BoardBlock = BoardBlock> {
  key: string;
  /** More than one when an interval or activity runs across consecutive days as one bar. */
  blocks: T[];
  day: number;
  span: number;
  lane: number;
  lanes: number;
}

/** Joins same-time intervals on neighbouring days into bars, and puts overlapping lessons (subjects students choose between) side by side. */
export function layoutBlocks<T extends BoardBlock>(
  blocks: T[],
): LaidOutBlock<T>[] {
  const laid: LaidOutBlock<T>[] = [];
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.day - b.day);
  const bars = new Map<string, LaidOutBlock<T>>();
  for (const b of sorted) {
    if (b.kind !== "lesson") {
      const key = `${b.kind}|${b.label}|${b.start}|${b.end}`;
      const bar = bars.get(key);
      if (bar && bar.day + bar.span === b.day) {
        bar.blocks.push(b);
        bar.span++;
        continue;
      }
      const item = {
        key: b.id,
        blocks: [b],
        day: b.day,
        span: 1,
        lane: 0,
        lanes: 1,
      };
      bars.set(key, item);
      laid.push(item);
    }
  }
  for (const day of TIMETABLE_DAYS) {
    const lessons = sorted.filter((b) => b.kind === "lesson" && b.day === day);
    let cluster: LaidOutBlock<T>[] = [];
    let laneEnds: number[] = [];
    const close = () => {
      for (const item of cluster) item.lanes = laneEnds.length;
      cluster = [];
      laneEnds = [];
    };
    for (const b of lessons) {
      if (laneEnds.length && laneEnds.every((end) => end <= b.start)) close();
      let lane = laneEnds.findIndex((end) => end <= b.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = b.end;
      const item = { key: b.id, blocks: [b], day, span: 1, lane, lanes: 1 };
      cluster.push(item);
      laid.push(item);
    }
    close();
  }
  return laid;
}

/** Where a laid-out block sits on the board. */
export function blockPosition(
  item: LaidOutBlock,
  hours: { start: number },
  gapPx = 3,
): CSSProperties {
  const first = item.blocks[0]!;
  const columnPct = 100 / TIMETABLE_DAYS.length;
  const left =
    (item.day - 1) * columnPct + (item.lane * columnPct) / item.lanes;
  const width = (item.span * columnPct) / item.lanes;
  return {
    position: "absolute",
    top: (first.start - hours.start) * PX_PER_MINUTE + 1,
    height: (first.end - first.start) * PX_PER_MINUTE - 2,
    left: `calc(${left}% + ${gapPx}px)`,
    width: `calc(${width}% - ${gapPx * 2}px)`,
  };
}

/** The look of one block; the builder wraps it to make it draggable. */
/** `narrow` is for lessons side by side: the subject's short name only, with the rest in the tooltip. */
export function BlockCard({
  block,
  clash,
  narrow,
  className,
  children,
}: {
  block: BoardBlock;
  clash?: "blocking" | "warning";
  narrow?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const height = (block.end - block.start) * PX_PER_MINUTE;
  const title =
    (narrow ? block.subjectCode : block.subjectName) ?? block.label ?? "";
  const lesson = block.kind === "lesson";
  const who = block.className ?? block.teacherName;
  return (
    <div
      className={cn(
        "relative flex h-full flex-col justify-center overflow-hidden rounded-lg border px-2 text-xs leading-tight",
        narrow
          ? "items-center border-l-2 px-0 text-center text-[10px] text-foreground"
          : lesson
            ? "border-l-4 text-foreground"
            : "items-center bg-muted/70 text-center text-muted-foreground",
        block.kind === "activity" && "border-dashed",
        clash === "blocking" && "ring-2 ring-destructive",
        clash === "warning" && "ring-2 ring-amber-500",
        className,
      )}
      style={blockStyle(block)}
    >
      <p className="flex items-center gap-1 truncate font-medium">
        {block.kind === "interval" && (
          <Coffee className="size-3 shrink-0" aria-hidden />
        )}
        {clash && (
          <AlertTriangle
            className={cn(
              "size-3 shrink-0",
              clash === "blocking" ? "text-destructive" : "text-amber-600",
            )}
            aria-hidden
          />
        )}
        <span className="truncate">{title}</span>
      </p>
      {lesson && !narrow && height >= 44 && who && (
        <p className="truncate text-muted-foreground">{who}</p>
      )}
      {lesson && !narrow && height >= 60 && block.room && (
        <p className="truncate text-muted-foreground">{block.room}</p>
      )}
      {children}
    </div>
  );
}

/** The empty board: weekday columns over half-hour lines. Blocks are positioned inside it as children. */
export function TimetableGrid({
  hours,
  today,
  nowMinutes,
  boardRef,
  children,
}: {
  hours: { start: number; end: number };
  today?: number | null;
  nowMinutes?: number;
  boardRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const t = useTranslations("academics.timetables");
  const height = (hours.end - hours.start) * PX_PER_MINUTE;
  const ticks: number[] = [];
  for (let m = hours.start; m <= hours.end; m += 30) ticks.push(m);
  return (
    <div className="overflow-x-auto rounded-xl border bg-card print:overflow-visible print:border-0">
      <div className="min-w-176">
        <div className="grid grid-cols-[4.5rem_1fr] border-b">
          <div />
          <div className="grid grid-cols-5">
            {TIMETABLE_DAYS.map((d) => (
              <div
                key={d}
                className={cn(
                  "px-2 py-2 text-center text-sm font-medium",
                  d === today && "text-primary",
                )}
              >
                {t(`days.${d}`)}
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[4.5rem_1fr]">
          <div className="relative" style={{ height }}>
            {ticks.map((m) => (
              <span
                key={m}
                className="tabular absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground first:translate-y-0 last:-translate-y-full"
                style={{ top: (m - hours.start) * PX_PER_MINUTE }}
              >
                {formatTime(m)}
              </span>
            ))}
          </div>
          <div
            ref={boardRef}
            className="relative select-none border-l"
            style={{ height }}
          >
            <div className="absolute inset-0 grid grid-cols-5" aria-hidden>
              {TIMETABLE_DAYS.map((d) => (
                <div
                  key={d}
                  className={cn(
                    "border-r last:border-r-0",
                    d === today ? "bg-primary/5" : d % 2 === 0 && "bg-muted/30",
                  )}
                />
              ))}
            </div>
            {ticks.slice(1, -1).map((m) => (
              <div
                key={m}
                className="absolute inset-x-0 border-t border-border/60"
                style={{ top: (m - hours.start) * PX_PER_MINUTE }}
                aria-hidden
              />
            ))}
            {children}
            {today != null &&
              nowMinutes != null &&
              nowMinutes >= hours.start &&
              nowMinutes <= hours.end && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-primary print:hidden"
                  style={{ top: (nowMinutes - hours.start) * PX_PER_MINUTE }}
                  aria-label={t("now")}
                >
                  <span
                    className="absolute -top-1 size-2 -translate-x-1/2 rounded-full bg-primary"
                    style={{
                      left: `${((today - 1) * 100) / TIMETABLE_DAYS.length}%`,
                    }}
                  />
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A read-only week: the "now" line and today's column come from the browser's clock. */
export function TimetableBoard({
  hours,
  blocks,
  live = true,
}: {
  hours: { start: number; end: number };
  blocks: BoardBlock[];
  live?: boolean;
}) {
  const now = useSchoolClock();
  return (
    <TimetableGrid
      hours={hours}
      today={live ? now?.day : undefined}
      nowMinutes={live && now?.day ? now.minutes : undefined}
    >
      {layoutBlocks(blocks).map((item) => (
        <div
          key={item.key}
          style={blockPosition(item, hours)}
          title={describeBlock(item.blocks[0]!)}
        >
          <BlockCard block={item.blocks[0]!} narrow={item.lanes > 1} />
        </div>
      ))}
    </TimetableGrid>
  );
}

export function describeBlock(b: BoardBlock) {
  return [
    b.subjectName ?? b.label,
    formatTimeRange(b.start, b.end),
    b.className ?? b.teacherName,
    b.room,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One day at a time, for phones. */
export function TimetableDayList({ blocks }: { blocks: BoardBlock[] }) {
  const t = useTranslations("academics.timetables");
  const now = useSchoolClock();
  const [chosen, setChosen] = useState<number | null>(null);
  const day = chosen ?? now?.day ?? 1;
  const today = [...blocks]
    .filter((b) => b.day === day)
    .sort((a, b) => a.start - b.start);
  return (
    <div>
      <div
        className="mb-3 grid grid-cols-5 gap-1"
        role="group"
        aria-label={t("chooseDay")}
      >
        {TIMETABLE_DAYS.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={d === day ? "default" : "outline"}
            aria-pressed={d === day}
            onClick={() => setChosen(d)}
          >
            {t(`daysShort.${d}`)}
          </Button>
        ))}
      </div>
      {today.length ? (
        <ul className="space-y-2">
          {today.map((b) => (
            <li
              key={b.id}
              className={cn(
                "rounded-lg border px-3 py-2",
                b.kind === "lesson"
                  ? "border-l-4"
                  : "bg-muted/70 text-muted-foreground",
              )}
              style={blockStyle(b)}
            >
              <p className="tabular text-xs text-muted-foreground">
                {formatTimeRange(b.start, b.end)}
              </p>
              <p className="font-medium">{b.subjectName ?? b.label}</p>
              {b.kind === "lesson" && (
                <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  {(b.className ?? b.teacherName) && (
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3" aria-hidden />{" "}
                      {b.className ?? b.teacherName}
                    </span>
                  )}
                  {b.room && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden /> {b.room}
                    </span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("nothingThisDay")}
        </p>
      )}
    </div>
  );
}

/** The week on larger screens and for printing, one day at a time on phones. */
export function ResponsiveTimetable({
  hours,
  blocks,
}: {
  hours: { start: number; end: number };
  blocks: BoardBlock[];
}) {
  return (
    <>
      <div className="hidden md:block print:block">
        <TimetableBoard hours={hours} blocks={blocks} />
      </div>
      <div className="md:hidden print:hidden">
        <TimetableDayList blocks={blocks} />
      </div>
    </>
  );
}
