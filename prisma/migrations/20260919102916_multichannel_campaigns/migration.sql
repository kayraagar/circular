-- CreateTable
CREATE TABLE "SmsAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NETGSM',
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT,
    "msgheader" TEXT NOT NULL,
    "legalFooter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "connectedByUserId" TEXT,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SmsAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "replyTo" TEXT,
    "legalFooter" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailTestRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailTestRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "tokenExpiresAt" DATETIME,
    "connectionMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "connectedByUserId" TEXT,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstagramAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstagramAutoReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'EXACT',
    "replyText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastRepliedAt" DATETIME,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstagramAutoReply_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstagramReplyLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "mid" TEXT NOT NULL,
    "senderHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstagramReplyLog_ruleId_tenantId_fkey" FOREIGN KEY ("ruleId", "tenantId") REFERENCES "InstagramAutoReply" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "mode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "audienceKind" TEXT NOT NULL,
    "audienceKey" TEXT,
    "audienceLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "recipientCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "exclusionSummary" TEXT,
    "estimatedCostMicroUsd" INTEGER,
    "createdByUserId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Campaign_templateId_tenantId_fkey" FOREIGN KEY ("templateId", "tenantId") REFERENCES "MessageTemplate" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_Campaign" ("audienceKey", "audienceKind", "audienceLabel", "channel", "completedAt", "createdAt", "createdByUserId", "estimatedCostMicroUsd", "excludedCount", "exclusionSummary", "id", "mode", "name", "recipientCount", "startedAt", "status", "templateId", "tenantId", "updatedAt") SELECT "audienceKey", "audienceKind", "audienceLabel", "channel", "completedAt", "createdAt", "createdByUserId", "estimatedCostMicroUsd", "excludedCount", "exclusionSummary", "id", "mode", "name", "recipientCount", "startedAt", "status", "templateId", "tenantId", "updatedAt" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE INDEX "Campaign_tenantId_createdAt_idx" ON "Campaign"("tenantId", "createdAt");
CREATE UNIQUE INDEX "Campaign_id_tenantId_key" ON "Campaign"("id", "tenantId");
CREATE TABLE "new_CampaignMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT,
    "toPhone" TEXT,
    "toEmail" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "skipReason" TEXT,
    "wamid" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "billable" BOOLEAN,
    "pricingCategory" TEXT,
    "attemptedAt" DATETIME,
    "acceptedAt" DATETIME,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    "failedAt" DATETIME,
    "openedAt" DATETIME,
    "clickedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignMessage_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignMessage_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_CampaignMessage" ("acceptedAt", "attemptedAt", "billable", "campaignId", "createdAt", "customerId", "deliveredAt", "errorCode", "errorMessage", "failedAt", "id", "pricingCategory", "readAt", "sentAt", "skipReason", "status", "tenantId", "toPhone", "updatedAt", "wamid") SELECT "acceptedAt", "attemptedAt", "billable", "campaignId", "createdAt", "customerId", "deliveredAt", "errorCode", "errorMessage", "failedAt", "id", "pricingCategory", "readAt", "sentAt", "skipReason", "status", "tenantId", "toPhone", "updatedAt", "wamid" FROM "CampaignMessage";
DROP TABLE "CampaignMessage";
ALTER TABLE "new_CampaignMessage" RENAME TO "CampaignMessage";
CREATE UNIQUE INDEX "CampaignMessage_wamid_key" ON "CampaignMessage"("wamid");
CREATE INDEX "CampaignMessage_providerMessageId_idx" ON "CampaignMessage"("providerMessageId");
CREATE INDEX "CampaignMessage_campaignId_status_idx" ON "CampaignMessage"("campaignId", "status");
CREATE INDEX "CampaignMessage_tenantId_customerId_acceptedAt_idx" ON "CampaignMessage"("tenantId", "customerId", "acceptedAt");
CREATE INDEX "CampaignMessage_tenantId_createdAt_idx" ON "CampaignMessage"("tenantId", "createdAt");
CREATE UNIQUE INDEX "CampaignMessage_campaignId_toPhone_key" ON "CampaignMessage"("campaignId", "toPhone");
CREATE UNIQUE INDEX "CampaignMessage_campaignId_toEmail_key" ON "CampaignMessage"("campaignId", "toEmail");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SmsAccount_tenantId_key" ON "SmsAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSettings_tenantId_key" ON "EmailSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTestRecipient_tenantId_email_key" ON "EmailTestRecipient"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_tenantId_key" ON "InstagramAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_igUserId_key" ON "InstagramAccount"("igUserId");

-- CreateIndex
CREATE INDEX "InstagramAutoReply_tenantId_isActive_idx" ON "InstagramAutoReply"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAutoReply_id_tenantId_key" ON "InstagramAutoReply"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramReplyLog_mid_key" ON "InstagramReplyLog"("mid");

-- CreateIndex
CREATE INDEX "InstagramReplyLog_tenantId_ruleId_senderHash_createdAt_idx" ON "InstagramReplyLog"("tenantId", "ruleId", "senderHash", "createdAt");

