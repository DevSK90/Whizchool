-- AlterTable
ALTER TABLE "ClassSubject" ADD COLUMN     "optionGroup" TEXT;

-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "optionsRequired" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "choiceGroup" TEXT,
ADD COLUMN     "examNo" TEXT;

-- AlterTable
ALTER TABLE "SubjectStream" ADD COLUMN     "optional" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SubjectTeacher" (
    "subjectId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,

    CONSTRAINT "SubjectTeacher_pkey" PRIMARY KEY ("subjectId","staffId")
);

-- CreateIndex
CREATE INDEX "SubjectTeacher_staffId_idx" ON "SubjectTeacher"("staffId");

-- AddForeignKey
ALTER TABLE "SubjectTeacher" ADD CONSTRAINT "SubjectTeacher_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacher" ADD CONSTRAINT "SubjectTeacher_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- O/L classes' elective subjects become a choice in their class. Everything else stays compulsory.
UPDATE "ClassSubject" cs SET "optionGroup" = 'basket' || s."basket"
  FROM "Subject" s, "Class" c, "Grade" g
  WHERE s."id" = cs."subjectId" AND c."id" = cs."classId" AND g."id" = c."gradeId" AND g."level" = 'ol' AND s."basket" IS NOT NULL;

-- Each subject's teacher list starts with whoever teaches it now.
INSERT INTO "SubjectTeacher" ("subjectId", "staffId")
  SELECT DISTINCT "subjectId", "teacherId" FROM "ClassSubject" WHERE "teacherId" IS NOT NULL;
