// Loading a year's timetables and writing them. The rules themselves are in @whizchool/shared/timetable.
import type { TimetableBlockKind, TimetableVersion } from "@whizchool/shared/types";
import type { StoredBlock, YearTimetables } from "@whizchool/shared/timetable";
import { omitNulls } from "../http/list";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";

type Tx = Prisma.TransactionClient;
type Client = Db | Tx;

/** Timetable writes wait their turn: clashes span classes, so no database constraint can catch two at once. */
export const lockTimetables = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('timetables'))`;

/** Everything about one year's timetables, in plain queries: this is a few thousand rows for a big school. */
export async function loadYear(db: Client, yearId: string): Promise<YearTimetables> {
  // One after another, as `db` may be a transaction.
  const school = await db.school.findUniqueOrThrow({ where: { id: "school" }, select: { timetableStart: true, timetableEnd: true } });
  const classes = await db.$queryRaw<{ id: string; name: string; gradeId: string; gradeNumber: number; room: string | null; classTeacherName: string | null }[]>`
    SELECT c."id", c."name", c."gradeId", g."number" AS "gradeNumber", c."room", t."name" AS "classTeacherName"
    FROM "Class" c JOIN "Grade" g ON g."id" = c."gradeId" LEFT JOIN "Staff" t ON t."id" = c."classTeacherId"
    WHERE c."yearId" = ${yearId}`;
  const subjects = await db.$queryRaw<{ id: string; classId: string; subjectId: string; subjectName: string; subjectCode: string; basket: number | null; teacherId: string | null; teacherName: string | null }[]>`
    SELECT cs."id", cs."classId", cs."subjectId", s."name" AS "subjectName", s."code" AS "subjectCode", s."basket", cs."teacherId", t."name" AS "teacherName"
    FROM "ClassSubject" cs JOIN "Class" c ON c."id" = cs."classId" JOIN "Subject" s ON s."id" = cs."subjectId" LEFT JOIN "Staff" t ON t."id" = cs."teacherId"
    WHERE c."yearId" = ${yearId} ORDER BY s."basket" NULLS FIRST, s."name"`;
  const timetables = await db.$queryRaw<{ classId: string; revision: number; publishedRevision: number | null; publishedAt: Date | null; publishedBy: string | null; savedBy: string | null }[]>`
    SELECT t."classId", t."revision", t."publishedRevision", t."publishedAt", t."publishedBy", t."savedBy"
    FROM "ClassTimetable" t JOIN "Class" c ON c."id" = t."classId" WHERE c."yearId" = ${yearId}`;
  const blocks = await db.$queryRaw<{ id: string; classId: string; version: TimetableVersion; day: number; start: number; end: number; kind: TimetableBlockKind; classSubjectId: string | null; label: string | null; room: string | null }[]>`
    SELECT b."id", b."classId", b."version"::text AS "version", b."day", b."start", b."end", b."kind"::text AS "kind", b."classSubjectId", b."label", b."room"
    FROM "TimetableBlock" b JOIN "Class" c ON c."id" = b."classId" WHERE c."yearId" = ${yearId}`;
  return {
    hours: { start: school.timetableStart, end: school.timetableEnd },
    classes: classes.map(omitNulls),
    subjects: subjects.map(omitNulls),
    timetables: timetables.map((t) => omitNulls({ ...t, publishedAt: t.publishedAt?.toISOString() ?? null })),
    blocks: blocks.map(omitNulls) as StoredBlock[],
  };
}

/** Makes a class's draft the version teachers and parents see. */
export async function publishClass(tx: Tx, classId: string, by: string) {
  await tx.timetableBlock.deleteMany({ where: { classId, version: "published" } });
  const drafts = await tx.timetableBlock.findMany({ where: { classId, version: "draft" } });
  await tx.timetableBlock.createMany({
    data: drafts.map(({ id: _, ...b }) => ({ ...b, version: "published" as const })),
  });
  const t = await tx.classTimetable.findUniqueOrThrow({ where: { classId } });
  await tx.classTimetable.update({ where: { classId }, data: { publishedRevision: t.revision, publishedAt: new Date(), publishedBy: by } });
}

/** Next year's class starts from a copy of this year's draft, unpublished, matching its subjects. */
export async function copyTimetable(tx: Tx, fromClassId: string, toClassId: string) {
  const blocks = await tx.timetableBlock.findMany({ where: { classId: fromClassId, version: "draft" }, include: { classSubject: { select: { subjectId: true } } } });
  if (!blocks.length) return;
  const target = new Map((await tx.classSubject.findMany({ where: { classId: toClassId } })).map((cs) => [cs.subjectId, cs.id]));
  await tx.timetableBlock.createMany({
    data: blocks.map(({ id: _, classSubject, classId: __, classSubjectId: ___, ...b }) => ({
      ...b,
      classId: toClassId,
      classSubjectId: classSubject ? (target.get(classSubject.subjectId) ?? null) : null,
    })),
  });
  await tx.classTimetable.create({ data: { classId: toClassId, revision: 1 } });
}
