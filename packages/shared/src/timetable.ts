// Timetable rules, shared by the API, the demo API and the builder (which shows clashes while dragging).
// A timetable is one weekly pattern per class per academic year. Times are minutes since midnight.
import type {
  ClassTimetableView,
  PlacedBlock,
  StudentTimetable,
  TeacherTimetable,
  TimetableBlock,
  TimetableBlockInput,
  TimetableClash,
  TimetableOverviewRow,
  TimetableSubject,
  TimetableVersion,
} from "./types";

export const TIMETABLE_DAYS = [1, 2, 3, 4, 5] as const;
export const TIMETABLE_STEP = 5;
export const DEFAULT_SCHOOL_DAY = { start: 7 * 60 + 30, end: 13 * 60 + 30 };

/** "07:30" → 450; null when it isn't a 24-hour time. */
export function parseTime(s: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 450 → "07:30", the form an <input type="time"> uses. */
export const toTimeValue = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** 450 → "7:30 am", 810 → "1:30 pm". */
export function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export const formatTimeRange = (start: number, end: number) => `${formatTime(start)} – ${formatTime(end)}`;

const overlaps = (a: { day: number; start: number; end: number }, b: { day: number; start: number; end: number }) => a.day === b.day && a.start < b.end && b.start < a.end;

/** What a class's board may hold: the first problem found, or null. */
export function timetableProblem(
  blocks: TimetableBlockInput[],
  opts: { hours: { start: number; end: number }; subjects: TimetableSubject[] },
): { index: number; message: string } | null {
  const subjects = new Map(opts.subjects.map((s) => [s.id, s]));
  for (const [index, b] of blocks.entries()) {
    const fail = (message: string) => ({ index, message });
    if (!TIMETABLE_DAYS.includes(b.day as 1)) return fail("Choose a weekday.");
    if (b.start % TIMETABLE_STEP || b.end % TIMETABLE_STEP) return fail(`Times must be in ${TIMETABLE_STEP}-minute steps.`);
    if (b.end <= b.start) return fail("The end time must be after the start time.");
    if (b.start < opts.hours.start || b.end > opts.hours.end) return fail(`Times must be within the school day (${formatTimeRange(opts.hours.start, opts.hours.end)}).`);
    if (b.kind === "lesson" && !subjects.has(b.classSubjectId ?? "")) return fail("Choose one of this class's subjects.");
    if (b.kind !== "lesson" && !b.label?.trim()) return fail("Give this block a name.");
  }
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (!overlaps(a, b)) continue;
      const sa = a.kind === "lesson" ? subjects.get(a.classSubjectId ?? "") : undefined;
      const sb = b.kind === "lesson" ? subjects.get(b.classSubjectId ?? "") : undefined;
      const name = (x: TimetableBlockInput, s?: TimetableSubject) => s?.subjectName ?? x.label ?? "Block";
      const sameBasket = sa?.basket != null && sa.basket === sb?.basket && sa.id !== sb?.id;
      if (!sameBasket) return { index: j, message: `${name(b, sb)} overlaps ${name(a, sa)}. Only O/L subjects from the same basket can run together.` };
      if (sa!.teacherId && sa!.teacherId === sb!.teacherId) return { index: j, message: `${sa!.teacherName ?? "This teacher"} can't teach ${sa!.subjectName} and ${sb!.subjectName} at the same time.` };
    }
  }
  return null;
}

/**
 * Teacher and room clashes between `mine` and blocks of other classes. The same teacher, subject and
 * grade at once is one combined lesson (e.g. Art for 10-A and 10-B together), not a clash.
 */
export function findClashes(mine: PlacedBlock[], others: PlacedBlock[]): TimetableClash[] {
  const index = new Map<string, PlacedBlock[]>();
  const add = (key: string, b: PlacedBlock) => (index.get(key) ?? index.set(key, []).get(key)!).push(b);
  for (const o of others) {
    if (o.teacherId) add(`t|${o.teacherId}|${o.day}`, o);
    if (o.room) add(`r|${o.room.toLowerCase()}|${o.day}`, o);
  }
  const clashes = new Map<string, TimetableClash>();
  const check = (b: PlacedBlock, kind: TimetableClash["kind"], key: string, who: (o: PlacedBlock) => string) => {
    for (const o of index.get(key) ?? []) {
      if (o.classId === b.classId || !overlaps(b, o)) continue;
      if (b.subjectId && b.subjectId === o.subjectId && b.gradeId === o.gradeId && b.teacherId === o.teacherId) continue;
      const id = `${b.id}|${kind}|${o.classId}|${o.start}|${o.end}`;
      const existing = clashes.get(id);
      // The same block can appear in another class's draft and published versions; published is what counts.
      if (existing && (existing.source === "published" || o.version === "draft")) continue;
      clashes.set(id, {
        blockId: b.id,
        kind,
        day: b.day,
        start: b.start,
        end: b.end,
        otherClassId: o.classId,
        otherClassName: o.className,
        otherStart: o.start,
        otherEnd: o.end,
        source: o.version,
        message: `${who(o)} ${o.className}${o.version === "draft" ? " (draft)" : ""}, ${formatTimeRange(o.start, o.end)}`,
      });
    }
  };
  for (const b of mine) {
    if (b.teacherId) check(b, "teacher", `t|${b.teacherId}|${b.day}`, () => `${b.teacherName ?? "This teacher"} is in`);
    if (b.room) check(b, "room", `r|${b.room.toLowerCase()}|${b.day}`, () => `Room ${b.room} is used by`);
  }
  return [...clashes.values()];
}

// ── A school year's timetables, however they were loaded ──

export interface TimetableClassInfo {
  id: string;
  name: string;
  gradeId: string;
  gradeNumber: number;
  room?: string;
  classTeacherName?: string;
}

export interface StoredTimetable {
  classId: string;
  revision: number;
  publishedRevision?: number;
  publishedAt?: string;
  publishedBy?: string;
  savedBy?: string;
}

export interface StoredBlock extends TimetableBlockInput {
  id: string;
  classId: string;
  version: TimetableVersion;
}

export interface YearTimetables {
  hours: { start: number; end: number };
  classes: TimetableClassInfo[];
  /** Every class subject of the year, with `classId`. */
  subjects: (TimetableSubject & { classId: string })[];
  timetables: StoredTimetable[];
  blocks: StoredBlock[];
}

function toBlock(y: YearTimetables, b: StoredBlock, subjects = new Map(y.subjects.map((s) => [s.id, s]))): TimetableBlock {
  const s = b.kind === "lesson" ? subjects.get(b.classSubjectId ?? "") : undefined;
  return {
    id: b.id,
    day: b.day,
    start: b.start,
    end: b.end,
    kind: b.kind,
    ...(b.classSubjectId ? { classSubjectId: b.classSubjectId } : {}),
    ...(b.label ? { label: b.label } : {}),
    ...(b.room ? { room: b.room } : {}),
    ...(s ? { subjectId: s.subjectId, subjectName: s.subjectName, subjectCode: s.subjectCode } : {}),
    ...(s?.basket != null ? { basket: s.basket } : {}),
    ...(s?.teacherId ? { teacherId: s.teacherId } : {}),
    ...(s?.teacherName ? { teacherName: s.teacherName } : {}),
  };
}

const byTime = (a: { day: number; start: number; id: string }, b: { day: number; start: number; id: string }) => a.day - b.day || a.start - b.start || a.id.localeCompare(b.id);

/** A block with what the clash checks need. A lesson is in its class's room unless it says otherwise; intervals use no room. */
export function placeBlock(
  block: Pick<TimetableBlock, "id" | "day" | "start" | "end" | "kind" | "room" | "subjectId" | "teacherId" | "teacherName">,
  cls: Pick<TimetableClassInfo, "id" | "name" | "gradeId" | "room">,
  version: TimetableVersion,
): PlacedBlock {
  const room = block.kind === "interval" ? undefined : (block.room ?? (block.kind === "lesson" ? cls.room : undefined));
  return {
    id: block.id,
    classId: cls.id,
    className: cls.name,
    gradeId: cls.gradeId,
    version,
    day: block.day,
    start: block.start,
    end: block.end,
    ...(block.subjectId ? { subjectId: block.subjectId } : {}),
    ...(block.teacherId ? { teacherId: block.teacherId } : {}),
    ...(block.teacherName ? { teacherName: block.teacherName } : {}),
    ...(room ? { room } : {}),
  };
}

function placedRows(y: YearTimetables) {
  const subjects = new Map(y.subjects.map((s) => [s.id, s]));
  const classes = new Map(y.classes.map((c) => [c.id, c]));
  return y.blocks.flatMap((b) => {
    const cls = classes.get(b.classId);
    return cls && b.kind !== "interval" ? [placeBlock(toBlock(y, b, subjects), cls, b.version)] : [];
  });
}

/** One class's board. Editors also get what they need to see clashes: everyone else's busy times. */
export function classTimetableView(y: YearTimetables, classId: string, version: TimetableVersion): ClassTimetableView {
  const cls = y.classes.find((c) => c.id === classId)!;
  const t = y.timetables.find((x) => x.classId === classId);
  const blocks = y.blocks.filter((b) => b.classId === classId && b.version === version).map((b) => toBlock(y, b)).sort(byTime);
  const busy = version === "draft" ? placedRows(y).filter((b) => b.classId !== classId) : [];
  const revision = t?.revision ?? 0;
  return {
    classId,
    className: cls.name,
    gradeId: cls.gradeId,
    ...(cls.room ? { room: cls.room } : {}),
    hours: y.hours,
    version,
    blocks,
    subjects: y.subjects.filter((s) => s.classId === classId).map(({ classId: _, ...s }) => s),
    busy,
    clashes: findClashes(blocks.map((b) => placeBlock(b, cls, version)), busy),
    revision,
    ...(t?.publishedRevision != null ? { publishedRevision: t.publishedRevision } : {}),
    ...(t?.publishedAt ? { publishedAt: t.publishedAt } : {}),
    ...(t?.publishedBy ? { publishedBy: t.publishedBy } : {}),
    ...(t?.savedBy ? { savedBy: t.savedBy } : {}),
    hasUnpublishedChanges: revision > 0 && revision !== t?.publishedRevision,
  };
}

/** Every class's progress: what's published, what's waiting, and what clashes. */
export function timetableOverview(y: YearTimetables): TimetableOverviewRow[] {
  const placed = placedRows(y);
  return [...y.classes]
    .sort((a, b) => a.gradeNumber - b.gradeNumber || a.name.localeCompare(b.name))
    .map((c) => {
      const t = y.timetables.find((x) => x.classId === c.id);
      const count = (version: TimetableVersion) => y.blocks.filter((b) => b.classId === c.id && b.version === version && b.kind === "lesson").length;
      const revision = t?.revision ?? 0;
      const mine = placed.filter((b) => b.classId === c.id && b.version === "draft");
      const clashes = findClashes(mine, placed.filter((b) => b.classId !== c.id));
      return {
        classId: c.id,
        className: c.name,
        gradeNumber: c.gradeNumber,
        ...(c.classTeacherName ? { classTeacherName: c.classTeacherName } : {}),
        lessons: count("draft"),
        publishedLessons: count("published"),
        ...(t?.publishedAt ? { publishedAt: t.publishedAt } : {}),
        hasUnpublishedChanges: revision > 0 && revision !== t?.publishedRevision,
        clashes: clashes.length,
      };
    });
}

/**
 * Which of these classes can go live together. A class's draft mustn't clash with what would be live
 * afterwards: the drafts of the others going live, and the published versions of everything else.
 * Holding a class back can make its old published version clash with another draft, so it repeats until stable.
 */
export function settlePublish(y: YearTimetables, classIds: string[]) {
  const placed = placedRows(y);
  const going = new Set(classIds);
  const blocked = new Map<string, TimetableClash[]>();
  for (let changed = true; changed; ) {
    changed = false;
    const live = placed.filter((b) => (going.has(b.classId) ? b.version === "draft" : b.version === "published"));
    // Two classes clashing with each other both wait: picking one of them would be arbitrary.
    for (const id of [...going]) {
      const clashes = findClashes(live.filter((b) => b.classId === id), live.filter((b) => b.classId !== id));
      if (clashes.length) {
        going.delete(id);
        blocked.set(id, clashes);
        changed = true;
      }
    }
  }
  return { publishable: [...going], blocked };
}

/** The clash, if any, from giving this class subject to a teacher: their published week against its published lessons. */
export function reassignmentClash(y: YearTimetables, classSubjectId: string, teacherId: string, teacherName: string): TimetableClash | undefined {
  const subject = y.subjects.find((s) => s.id === classSubjectId);
  if (!subject) return undefined;
  const moved: YearTimetables = { ...y, subjects: y.subjects.map((s) => (s.id === classSubjectId ? { ...s, teacherId, teacherName } : s)) };
  const placed = placedRows(moved).filter((b) => b.version === "published");
  const lessons = new Set(y.blocks.filter((b) => b.version === "published" && b.classSubjectId === classSubjectId).map((b) => b.id));
  return findClashes(placed.filter((b) => lessons.has(b.id)), placed.filter((b) => b.classId !== subject.classId))[0];
}

/** A teacher's published week: their lessons, each with its class. */
export function teacherTimetable(y: YearTimetables, staff: { id: string; name: string }): TeacherTimetable {
  const classes = new Map(y.classes.map((c) => [c.id, c]));
  const subjects = new Map(y.subjects.map((s) => [s.id, s]));
  return {
    staffId: staff.id,
    staffName: staff.name,
    hours: y.hours,
    blocks: y.blocks
      .filter((b) => b.version === "published" && b.kind === "lesson" && subjects.get(b.classSubjectId ?? "")?.teacherId === staff.id)
      .map((b) => {
        const cls = classes.get(b.classId)!;
        const room = b.room ?? cls.room;
        return { ...toBlock(y, b, subjects), classId: cls.id, className: cls.name, ...(room ? { room } : {}) };
      })
      .sort(byTime),
  };
}

/** A student's published week: O/L basket subjects only when they take them. */
export function studentTimetable(y: YearTimetables, student: { id: string; classId: string; electiveSubjectIds: string[] }): StudentTimetable {
  const cls = y.classes.find((c) => c.id === student.classId)!;
  const t = y.timetables.find((x) => x.classId === cls.id);
  const electives = new Set(student.electiveSubjectIds);
  return {
    studentId: student.id,
    classId: cls.id,
    className: cls.name,
    hours: y.hours,
    ...(t?.publishedAt ? { publishedAt: t.publishedAt } : {}),
    blocks: y.blocks
      .filter((b) => b.classId === cls.id && b.version === "published")
      .map((b) => toBlock(y, b))
      .filter((b) => b.basket == null || electives.has(b.subjectId ?? ""))
      .map((b) => (b.kind === "lesson" && !b.room && cls.room ? { ...b, room: cls.room } : b))
      .sort(byTime),
  };
}
