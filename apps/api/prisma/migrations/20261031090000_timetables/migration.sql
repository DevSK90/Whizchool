-- CreateEnum
CREATE TYPE "TimetableVersion" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "TimetableBlockKind" AS ENUM ('lesson', 'interval', 'activity');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "timetableEnd" INTEGER NOT NULL DEFAULT 810,
ADD COLUMN     "timetableStart" INTEGER NOT NULL DEFAULT 450;

-- CreateTable
CREATE TABLE "ClassTimetable" (
    "classId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "publishedRevision" INTEGER,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedBy" TEXT,
    "savedBy" TEXT,

    CONSTRAINT "ClassTimetable_pkey" PRIMARY KEY ("classId")
);

-- CreateTable
CREATE TABLE "TimetableBlock" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "version" "TimetableVersion" NOT NULL,
    "day" INTEGER NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "kind" "TimetableBlockKind" NOT NULL,
    "classSubjectId" TEXT,
    "label" TEXT,
    "room" TEXT,

    CONSTRAINT "TimetableBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableBlock_classId_version_idx" ON "TimetableBlock"("classId", "version");

-- CreateIndex
CREATE INDEX "TimetableBlock_classSubjectId_idx" ON "TimetableBlock"("classSubjectId");

-- AddForeignKey
ALTER TABLE "ClassTimetable" ADD CONSTRAINT "ClassTimetable_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableBlock" ADD CONSTRAINT "TimetableBlock_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableBlock" ADD CONSTRAINT "TimetableBlock_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "ClassSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Built-in roles in existing databases get the new permissions (new schools get them from their seed).
UPDATE "Role" SET "permissions" = array_append("permissions", 'timetable.view')
  WHERE "name" IN ('Admin', 'Principal', 'Class Teacher', 'Subject Teacher', 'Office Staff') AND NOT 'timetable.view' = ANY("permissions");
UPDATE "Role" SET "permissions" = array_append("permissions", 'timetable.edit')
  WHERE "name" IN ('Admin', 'Principal') AND NOT 'timetable.edit' = ANY("permissions");
