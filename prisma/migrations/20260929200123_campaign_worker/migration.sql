-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignMessage" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

