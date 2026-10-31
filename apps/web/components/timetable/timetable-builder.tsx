"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors, type DragStartEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, CopyPlus, GripVertical, Plus, Printer, Save, Send } from "lucide-react";
import { ApiError } from "@whizchool/shared/api";
import {
  TIMETABLE_DAYS,
  TIMETABLE_STEP,
  findClashes,
  formatTimeRange,
  parseTime,
  placeBlock,
  timetableProblem,
  toTimeValue,
} from "@whizchool/shared/timetable";
import type { ClassSummary, ClassTimetableView, TimetableBlock, TimetableBlockInput, TimetableClash, TimetableSubject } from "@whizchool/shared/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Pill } from "@/components/shared/status-badge";
import { api } from "@/lib/api/client";
import { useApiMutation, useClasses } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { BlockCard, PX_PER_MINUTE, TimetableDayList, TimetableGrid, blockPosition, blockStyle, describeBlock, layoutBlocks, type LaidOutBlock } from "./timetable-board";

type Hours = ClassTimetableView["hours"];

const DEFAULT_LESSON = 40;

/** What the tray offers: a class subject, or an interval or activity. */
type TrayItem = { key: string; kind: TimetableBlock["kind"]; duration: number; subject?: TimetableSubject; label?: string };
type DragState = { ids: string[]; duration: number; grabMinutes: number; item?: TrayItem; bar: boolean };
type Ghost = { day: number; start: number; end: number; bar: boolean; problem?: string; clash?: string };

let nextKey = 0;
const newId = () => `new-${++nextKey}`;

const toInput = ({ day, start, end, kind, classSubjectId, label, room }: TimetableBlock): TimetableBlockInput => ({ day, start, end, kind, classSubjectId, label, room });

/** A block as the board shows it: the subject's name and teacher come from the class's subjects. */
function resolve(b: TimetableBlockInput & { id: string }, subjects: TimetableSubject[]): TimetableBlock {
  const s = b.kind === "lesson" ? subjects.find((x) => x.id === b.classSubjectId) : undefined;
  return { ...b, subjectId: s?.subjectId, subjectName: s?.subjectName, basket: s?.basket, teacherId: s?.teacherId, teacherName: s?.teacherName };
}

export function TimetableBuilder({ view, classes }: { view: ClassTimetableView; classes: ClassSummary[] }) {
  const t = useTranslations("academics.timetables");
  const router = useRouter();
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["timetable", view.classId, "draft"], [view.classId]);

  const [blocks, setBlocks] = useState<TimetableBlock[]>(view.blocks);
  const [base, setBase] = useState(view.revision);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // A newer revision replaces the board, unless there's unsaved work: then Save reports the conflict instead.
  if (view.revision !== base && !dirty) {
    setBase(view.revision);
    setBlocks(view.blocks);
    setStale(false);
  }

  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [copyDayOpen, setCopyDayOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const cls = useMemo(() => ({ id: view.classId, name: view.className, gradeId: view.gradeId, room: view.room }), [view.classId, view.className, view.gradeId, view.room]);
  const clashesFor = useCallback((list: TimetableBlock[]) => findClashes(list.map((b) => placeBlock(b, cls, "draft")), view.busy), [cls, view.busy]);
  const clashes = useMemo(() => clashesFor(blocks), [clashesFor, blocks]);
  const blocking = clashes.filter((c) => c.source === "published");
  const clashOf = (id: string): "blocking" | "warning" | undefined => (blocking.some((c) => c.blockId === id) ? "blocking" : clashes.some((c) => c.blockId === id) ? "warning" : undefined);

  const problemIn = useCallback((list: TimetableBlockInput[]) => timetableProblem(list, { hours: view.hours, subjects: view.subjects })?.message, [view.hours, view.subjects]);

  /** Applies a change unless it breaks the board's rules; returns the reason if it does. */
  function commit(next: TimetableBlock[]) {
    const problem = problemIn(next);
    if (problem) return problem;
    setBlocks(next);
    setDirty(true);
    return undefined;
  }

  const saveDraft = useApiMutation(() => api.put<ClassTimetableView>(`/classes/${view.classId}/timetable`, { revision: base, blocks: blocks.map(toInput) }), {
    toastError: false,
    invalidate: [["timetables", "overview"]],
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setDirty(false);
      setStale(false);
    },
  });
  const publish = useApiMutation(() => api.post<ClassTimetableView>(`/classes/${view.classId}/timetable/publish`), {
    invalidate: [["timetables"], ["timetable"]],
    success: t("published", { name: view.className }),
    onSuccess: (saved) => qc.setQueryData(queryKey, saved),
  });

  async function save() {
    try {
      await saveDraft.mutateAsync(undefined);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "stale") setStale(true);
      else setSaveError(e instanceof Error ? e.message : t("saveFailed"));
      return false;
    }
  }
  function reload() {
    setDirty(false);
    setStale(false);
    setBase(-1);
    void qc.invalidateQueries({ queryKey });
  }

  const totals = useMemo(() => {
    const n = new Map<string, number>();
    for (const b of blocks) if (b.classSubjectId) n.set(b.classSubjectId, (n.get(b.classSubjectId) ?? 0) + 1);
    return n;
  }, [blocks]);

  // ── Dragging ──
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const suppressClick = useRef(false);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));

  /** The board after dropping here: moved blocks or a new one from the tray. */
  const applied = useCallback(
    (d: DragState, day: number, start: number): TimetableBlock[] => {
      const end = start + d.duration;
      if (d.item) {
        const i = d.item;
        return [...blocks, resolve({ id: newId(), day, start, end, kind: i.kind, ...(i.subject ? { classSubjectId: i.subject.id } : { label: i.label }) }, view.subjects)];
      }
      return blocks.map((b) => (d.ids.includes(b.id) ? { ...b, day: d.bar ? b.day : day, start, end } : b));
    },
    [blocks, view.subjects],
  );

  const place = useCallback(
    (d: DragState, x: number, y: number) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;
      let g: Ghost | null = null;
      if (x >= rect.left && x <= rect.right) {
        const day = Math.min(5, Math.max(1, Math.floor((x - rect.left) / (rect.width / TIMETABLE_DAYS.length)) + 1));
        const raw = view.hours.start + (y - rect.top) / PX_PER_MINUTE - d.grabMinutes;
        const snapped = Math.round(raw / TIMETABLE_STEP) * TIMETABLE_STEP;
        const start = Math.max(view.hours.start, Math.min(view.hours.end - d.duration, snapped));
        const next = applied(d, day, start);
        const moved = d.item ? [next.at(-1)!.id] : d.ids;
        g = {
          day,
          start,
          end: start + d.duration,
          bar: d.bar,
          problem: problemIn(next),
          clash: clashesFor(next.filter((b) => moved.includes(b.id)))[0]?.message,
        };
      }
      ghostRef.current = g;
      setGhost(g);
    },
    [applied, clashesFor, problemIn, view.hours],
  );

  // dnd-kit reports movement relative to where the drag began; the pointer's real position stays right when the page scrolls.
  useEffect(() => {
    if (!drag) return;
    const onPointer = (e: PointerEvent) => place(drag, e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const p = e.touches[0];
      if (p) place(drag, p.clientX, p.clientY);
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [drag, place]);

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { item?: TrayItem; laid?: LaidOutBlock<TimetableBlock> };
    const pointer = e.activatorEvent as MouseEvent | TouchEvent;
    const y = "touches" in pointer ? (pointer.touches[0]?.clientY ?? 0) : pointer.clientY;
    if (data.item) {
      setDrag({ ids: [], duration: data.item.duration, grabMinutes: data.item.duration / 2, item: data.item, bar: false });
      return;
    }
    const first = data.laid!.blocks[0]!;
    const top = e.active.rect.current.initial?.top ?? y;
    setDrag({ ids: data.laid!.blocks.map((b) => b.id), duration: first.end - first.start, grabMinutes: (y - top) / PX_PER_MINUTE, bar: data.laid!.span > 1 });
  }

  function endDrag(drop: boolean) {
    const d = drag;
    const g = ghostRef.current;
    setDrag(null);
    setGhost(null);
    ghostRef.current = null;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 50);
    if (drop && d && g) {
      const problem = commit(applied(d, g.day, g.start));
      if (problem) setSaveError(problem);
      else setSaveError(null);
    }
  }

  // ── Resizing, by the handle along a block's bottom edge ──
  const [resizing, setResizing] = useState<{ ids: string[]; end: number } | null>(null);
  function startResize(e: React.PointerEvent, laid: LaidOutBlock<TimetableBlock>) {
    e.stopPropagation();
    e.preventDefault();
    const first = laid.blocks[0]!;
    const ids = laid.blocks.map((b) => b.id);
    const startY = e.clientY;
    let end = first.end;
    setResizing({ ids, end });
    const move = (m: PointerEvent) => {
      const raw = first.end + (m.clientY - startY) / PX_PER_MINUTE;
      end = Math.max(first.start + TIMETABLE_STEP, Math.min(view.hours.end, Math.round(raw / TIMETABLE_STEP) * TIMETABLE_STEP));
      setResizing({ ids, end });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(null);
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 50);
      if (end !== first.end) setSaveError(commit(blocks.map((b) => (ids.includes(b.id) ? { ...b, end } : b))) ?? null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const shown = resizing ? blocks.map((b) => (resizing.ids.includes(b.id) ? { ...b, end: resizing.end } : b)) : blocks;
  const tray: TrayItem[] = view.subjects.map((s) => ({ key: s.id, kind: "lesson", duration: DEFAULT_LESSON, subject: s }));
  const others: TrayItem[] = [
    { key: "interval", kind: "interval", duration: 30, label: t("interval") },
    { key: "assembly", kind: "activity", duration: 10, label: t("assembly") },
  ];

  /** Where a block added from the keyboard or by clicking starts: after what's already on Monday. */
  const firstFree = () => Math.max(view.hours.start, ...blocks.filter((b) => b.day === 1).map((b) => b.end));
  const openAdd = (item: TrayItem) => {
    const start = Math.min(firstFree(), view.hours.end - item.duration);
    setEditing({ mode: "add", item, day: 1, start, end: start + item.duration });
  };

  const status = !view.publishedAt ? "draft" : dirty || view.hasUnpublishedChanges ? "changes" : "live";

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Select value={view.classId} onValueChange={(id) => (dirty ? setSwitchTo(id) : router.push(`/app/timetables/${id}`))}>
          <SelectTrigger className="w-32" aria-label={t("chooseClass")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Pill tone={status === "live" ? "success" : status === "changes" ? "warning" : "neutral"}>{t(`status.${status}`)}</Pill>
        {dirty && <span className="text-sm text-muted-foreground">{t("unsaved")}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setCopyFromOpen(true)}>
            <Copy /> {t("copyFrom")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCopyDayOpen(true)} disabled={!blocks.length}>
            <CopyPlus /> {t("copyDay")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> {t("print")}
          </Button>
          <Button variant="outline" size="sm" disabled={!dirty || saveDraft.isPending} onClick={() => void save()}>
            {saveDraft.isPending ? <Spinner /> : <Save />} {t("save")}
          </Button>
          <Button size="sm" disabled={!blocks.length || !!blocking.length || publish.isPending} onClick={() => setPublishOpen(true)}>
            <Send /> {t("publish")}
          </Button>
        </div>
      </div>

      {stale && (
        <Alert variant="destructive" className="no-print mb-4">
          <AlertTriangle />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {t("stale")}
            <Button size="sm" variant="outline" onClick={reload}>
              {t("reload")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {saveError && (
        <Alert variant="destructive" className="no-print mb-4" role="alert">
          <AlertTriangle />
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <p className="no-print mb-3 text-sm text-muted-foreground md:hidden">{t("phoneNote")}</p>
      <div className="md:hidden print:hidden">
        <TimetableDayList blocks={blocks} />
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={() => endDrag(true)} onDragCancel={() => endDrag(false)}>
        <div className="hidden gap-4 md:grid md:grid-cols-[14rem_1fr] print:block">
          <aside className="no-print space-y-4 self-start md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t("subjects")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {tray.map((item) => (
                  <TrayCard key={item.key} item={item} count={totals.get(item.key) ?? 0} onClick={() => openAdd(item)} />
                ))}
                {!tray.length && <p className="text-sm text-muted-foreground">{t("noSubjects")}</p>}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t("other")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {others.map((item) => (
                  <TrayCard key={item.key} item={item} onClick={() => openAdd(item)} />
                ))}
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => openAdd({ key: "custom", kind: "activity", duration: DEFAULT_LESSON, label: "" })}>
                  <Plus /> {t("custom")}
                </Button>
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <p className="no-print text-sm text-muted-foreground">{t("hint")}</p>
            <TimetableGrid hours={view.hours} boardRef={boardRef}>
              {layoutBlocks(shown).map((laid) => (
                <DraggableBlock
                  key={laid.key}
                  laid={laid}
                  hours={view.hours}
                  clash={clashOf(laid.blocks[0]!.id)}
                  dragging={!!drag && drag.ids.includes(laid.blocks[0]!.id)}
                  onResize={startResize}
                  onOpen={() => {
                    if (suppressClick.current) return;
                    const first = laid.blocks[0]!;
                    setEditing({ mode: "edit", laid, day: first.day, start: first.start, end: first.end });
                  }}
                />
              ))}
              {ghost && <GhostBlock ghost={ghost} hours={view.hours} />}
            </TimetableGrid>

            {!blocks.length && <p className="no-print text-center text-sm text-muted-foreground">{t("emptyBoard")}</p>}
            {!!clashes.length && <ClashList clashes={clashes} />}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {drag?.item && <div className="w-40 rounded-lg border bg-card px-2 py-1.5 text-xs font-medium shadow-lg" style={blockStyle({ kind: drag.item.kind, subjectId: drag.item.subject?.subjectId })}>{drag.item.subject?.subjectName ?? drag.item.label}</div>}
        </DragOverlay>
      </DndContext>

      {editing && (
        <BlockDialog
          target={editing}
          view={view}
          onClose={() => setEditing(null)}
          onApply={(next) => {
            const problem = commit(next(blocks));
            if (!problem) setEditing(null);
            return problem;
          }}
        />
      )}
      {copyDayOpen && <CopyDayDialog onClose={() => setCopyDayOpen(false)} blocks={blocks} onApply={commit} />}
      {copyFromOpen && <CopyFromDialog view={view} classes={classes} onClose={() => setCopyFromOpen(false)} onApply={commit} />}

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={t("publishTitle", { name: view.className })}
        description={clashes.length ? t("publishWarnings", { count: clashes.length }) : t("publishDescription")}
        confirmLabel={t("publish")}
        onConfirm={async () => {
          if (dirty && !(await save())) return;
          await publish.mutateAsync(undefined).catch(() => undefined);
        }}
      />
      <ConfirmDialog
        open={!!switchTo}
        onOpenChange={(o) => !o && setSwitchTo(null)}
        title={t("discardTitle")}
        description={t("discardDescription")}
        confirmLabel={t("discard")}
        destructive
        onConfirm={async () => {
          setDirty(false);
          router.push(`/app/timetables/${switchTo}`);
        }}
      />
    </>
  );
}

function TrayCard({ item, count, onClick }: { item: TrayItem; count?: number; onClick: () => void }) {
  const t = useTranslations("academics.timetables");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tray:${item.key}`, data: { item } });
  const s = item.subject;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      role={undefined}
      onClick={onClick}
      className={cn("flex w-full cursor-grab touch-manipulation items-start gap-1 rounded-lg border bg-card px-2 py-1.5 text-left text-xs active:cursor-grabbing", s && "border-l-4", !s && "border-dashed", isDragging && "opacity-50")}
      style={blockStyle({ kind: item.kind, subjectId: s?.subjectId })}
    >
      <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {s?.subjectName ?? item.label}
          {s?.basket != null && <span className="ml-1 font-normal text-muted-foreground">{t("basket", { n: s.basket })}</span>}
        </span>
        {s && <span className={cn("block truncate", s.teacherName ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>{s.teacherName ?? t("noTeacher")}</span>}
        {count !== undefined && <span className="block text-muted-foreground">{t("lessons", { count })}</span>}
      </span>
    </button>
  );
}

function DraggableBlock({
  laid,
  hours,
  clash,
  dragging,
  onResize,
  onOpen,
}: {
  laid: LaidOutBlock<TimetableBlock>;
  hours: Hours;
  clash?: "blocking" | "warning";
  dragging: boolean;
  onResize: (e: React.PointerEvent, laid: LaidOutBlock<TimetableBlock>) => void;
  onOpen: () => void;
}) {
  const t = useTranslations("academics.timetables");
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `block:${laid.key}`, data: { laid } });
  const first = laid.blocks[0]!;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={describeBlock(first)}
      title={describeBlock(first)}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn("group z-10 cursor-grab touch-manipulation rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing", dragging && "opacity-40")}
      style={blockPosition(laid, hours)}
    >
      <BlockCard block={first} clash={clash} narrow={laid.lanes > 1} />
      <span
        onPointerDown={(e) => onResize(e, laid)}
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize rounded-b-lg opacity-0 transition-opacity group-hover:bg-foreground/20 group-hover:opacity-100"
        title={t("resize")}
        aria-hidden
      />
    </div>
  );
}

function GhostBlock({ ghost, hours }: { ghost: Ghost; hours: Hours }) {
  const bad = !!ghost.problem;
  const warn = !bad && !!ghost.clash;
  const columnPct = 100 / TIMETABLE_DAYS.length;
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-30 overflow-hidden rounded-lg border-2 border-dashed px-2 py-1 text-[11px] leading-tight font-medium",
        bad ? "border-destructive bg-destructive/15" : warn ? "border-amber-500 bg-amber-500/15" : "border-primary bg-primary/15",
      )}
      style={{
        top: (ghost.start - hours.start) * PX_PER_MINUTE,
        height: Math.max(20, (ghost.end - ghost.start) * PX_PER_MINUTE),
        left: ghost.bar ? 0 : `${(ghost.day - 1) * columnPct}%`,
        width: ghost.bar ? "100%" : `${columnPct}%`,
      }}
    >
      <p className="tabular">{formatTimeRange(ghost.start, ghost.end)}</p>
      {(ghost.problem ?? ghost.clash) && <p>{ghost.problem ?? ghost.clash}</p>}
    </div>
  );
}

function ClashList({ clashes }: { clashes: TimetableClash[] }) {
  const t = useTranslations("academics.timetables");
  const blocking = clashes.filter((c) => c.source === "published").length;
  return (
    <Alert variant={blocking ? "destructive" : "default"} className="no-print">
      <AlertTriangle />
      <AlertDescription>
        <p className="font-medium">{blocking ? t("clashesBlocking", { count: blocking }) : t("clashesWarning", { count: clashes.length })}</p>
        <ul className="mt-1 list-disc pl-4">
          {clashes.slice(0, 8).map((c) => (
            <li key={`${c.blockId}${c.kind}${c.otherClassId}${c.otherStart}`}>
              {t(`days.${c.day as 1 | 2 | 3 | 4 | 5}`)}, {formatTimeRange(c.start, c.end)}: {c.message}
            </li>
          ))}
          {clashes.length > 8 && <li>{t("moreClashes", { count: clashes.length - 8 })}</li>}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

// ── Dialogs ──

type EditTarget =
  | { mode: "add"; item: TrayItem; day: number; start: number; end: number }
  | { mode: "edit"; laid: LaidOutBlock<TimetableBlock>; day: number; start: number; end: number };

/** Exact times, room and name; the way to do everything without dragging. */
function BlockDialog({ target, view, onClose, onApply }: { target: EditTarget; view: ClassTimetableView; onClose: () => void; onApply: (next: (blocks: TimetableBlock[]) => TimetableBlock[]) => string | undefined }) {
  const t = useTranslations("academics.timetables");
  const tc = useTranslations("common");
  const adding = target.mode === "add";
  const first = adding ? undefined : target.laid.blocks[0]!;
  const ids = adding ? [] : target.laid.blocks.map((b) => b.id);
  const bar = !adding && target.laid.span > 1;
  const kind = adding ? target.item.kind : first!.kind;
  const [day, setDay] = useState(target.day);
  const [start, setStart] = useState(toTimeValue(target.start));
  const [end, setEnd] = useState(toTimeValue(target.end));
  const [subjectId, setSubjectId] = useState(adding ? target.item.subject?.id : first!.classSubjectId);
  const [label, setLabel] = useState((adding ? target.item.label : first!.label) ?? "");
  const [room, setRoom] = useState(first?.room ?? "");
  const [error, setError] = useState<string>();

  const times = () => ({ start: parseTime(start) ?? -1, end: parseTime(end) ?? -1 });
  const fields = () => ({
    ...times(),
    ...(kind === "lesson" ? { classSubjectId: subjectId } : { label: label.trim() }),
    room: room.trim() || undefined,
  });
  const details = (b: TimetableBlockInput & { id: string }) => resolve(b, view.subjects);

  function apply(next: (blocks: TimetableBlock[]) => TimetableBlock[]) {
    setError(onApply(next));
  }
  const submit = () =>
    apply((blocks) =>
      adding
        ? [...blocks, details({ id: newId(), day, kind, ...fields() })]
        : blocks.map((b) => (ids.includes(b.id) ? details({ ...toInput(b), id: b.id, day: bar ? b.day : day, kind, ...fields() }) : b)),
    );
  const allDays = () =>
    apply((blocks) => [
      ...blocks.filter((b) => !ids.includes(b.id)),
      ...TIMETABLE_DAYS.map((d) => details({ id: newId(), day: d, kind, ...fields() })),
    ]);
  const remove = () => apply((blocks) => blocks.filter((b) => !ids.includes(b.id)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{adding ? t("addTitle") : t("editTitle")}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          {kind === "lesson" ? (
            <Field>
              <FieldLabel>{t("subject")}</FieldLabel>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger aria-label={t("subject")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.subjectName}
                      {s.teacherName ? ` · ${s.teacherName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="tt-label">{t("name")}</FieldLabel>
              <Input id="tt-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel>{t("day")}</FieldLabel>
              {bar ? (
                <Input value={t("allDays")} disabled />
              ) : (
                <Select value={String(day)} onValueChange={(v) => setDay(Number(v))}>
                  <SelectTrigger aria-label={t("day")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMETABLE_DAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {t(`days.${d}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="tt-start">{t("start")}</FieldLabel>
              <Input id="tt-start" type="time" step={TIMETABLE_STEP * 60} value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="tt-end">{t("end")}</FieldLabel>
              <Input id="tt-end" type="time" step={TIMETABLE_STEP * 60} value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          {kind !== "interval" && (
            <Field>
              <FieldLabel htmlFor="tt-room">{t("room")}</FieldLabel>
              <Input id="tt-room" value={room} maxLength={40} placeholder={kind === "lesson" ? view.room : undefined} onChange={(e) => setRoom(e.target.value)} />
              {kind === "lesson" && <FieldDescription>{t("roomHint")}</FieldDescription>}
            </Field>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </FieldGroup>
        <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex gap-2">
            {!adding && (
              <Button variant="ghost" className="text-destructive" onClick={remove}>
                {tc("delete")}
              </Button>
            )}
            {kind !== "lesson" && !bar && (
              <Button variant="outline" onClick={allDays}>
                {t("applyAllDays")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit}>{adding ? t("add") : t("apply")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Repeats one day's layout on other days, replacing what's there. */
function CopyDayDialog({ blocks, onClose, onApply }: { blocks: TimetableBlock[]; onClose: () => void; onApply: (next: TimetableBlock[]) => string | undefined }) {
  const t = useTranslations("academics.timetables");
  const tc = useTranslations("common");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState<number[]>([]);
  const [error, setError] = useState<string>();
  const targets = TIMETABLE_DAYS.filter((d) => d !== from);
  const run = () => {
    const kept = blocks.filter((b) => !to.includes(b.day));
    const copies = to.flatMap((day) => blocks.filter((b) => b.day === from).map((b) => ({ ...b, id: newId(), day })));
    const problem = onApply([...kept, ...copies]);
    if (problem) setError(problem);
    else onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("copyDay")}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("copyDayFrom")}</FieldLabel>
            <Select
              value={String(from)}
              onValueChange={(v) => {
                setFrom(Number(v));
                setTo([]);
              }}
            >
              <SelectTrigger aria-label={t("copyDayFrom")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMETABLE_DAYS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t(`days.${d}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t("copyDayTo")}</FieldLabel>
            <div className="flex flex-wrap gap-4">
              {targets.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={to.includes(d)} onCheckedChange={(on) => setTo(on ? [...to, d] : to.filter((x) => x !== d))} />
                  {t(`days.${d}`)}
                </label>
              ))}
            </div>
            <FieldDescription>{t("copyDayHint")}</FieldDescription>
          </Field>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button disabled={!to.length} onClick={run}>
            {t("copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Starts this class from another class's layout, matching subjects; a subject this class doesn't have is left out. */
function CopyFromDialog({ view, classes, onClose, onApply }: { view: ClassTimetableView; classes: ClassSummary[]; onClose: () => void; onApply: (next: TimetableBlock[]) => string | undefined }) {
  const t = useTranslations("academics.timetables");
  const tc = useTranslations("common");
  const { data: all } = useClasses();
  const [from, setFrom] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const source = await api.get<ClassTimetableView>(`/classes/${from}/timetable`, { version: "draft" });
      const bySubject = new Map(view.subjects.map((s) => [s.subjectId, s]));
      const next = source.blocks.flatMap((b) => {
        const mine = b.subjectId ? bySubject.get(b.subjectId) : undefined;
        if (b.kind === "lesson" && !mine) return [];
        return [resolve({ ...toInput(b), id: newId(), classSubjectId: mine?.id, room: b.room }, view.subjects)];
      });
      const problem = onApply(next);
      if (problem) setError(problem);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("copyFrom")}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("copyFromClass")}</FieldLabel>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger aria-label={t("copyFromClass")}>
                <SelectValue placeholder={t("chooseClass")} />
              </SelectTrigger>
              <SelectContent>
                {(all ?? classes)
                  .filter((c) => c.id !== view.classId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t("copyFromHint", { name: view.className })}</FieldDescription>
          </Field>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button disabled={!from || busy} onClick={() => void run()}>
            {busy ? <Spinner /> : <CheckCircle2 />} {t("copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
