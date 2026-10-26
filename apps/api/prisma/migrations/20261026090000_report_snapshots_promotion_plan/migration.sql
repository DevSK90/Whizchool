-- AlterTable
ALTER TABLE "PromotionRun" ADD COLUMN     "decisions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "startedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ReportCard" ADD COLUMN     "classId" TEXT,
ADD COLUMN     "subjects" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRun_fromYearId_key" ON "PromotionRun"("fromYearId");

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

