-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "relatesTo" TEXT;

-- AlterTable
ALTER TABLE "MessageDelivery" ADD COLUMN     "body" TEXT,
ADD COLUMN     "guardianId" TEXT,
ADD COLUMN     "lastAttemptAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "Message_relatesTo_idx" ON "Message"("relatesTo");
