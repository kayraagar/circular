-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "connectionMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "accessTokenEnc" TEXT,
    "registrationPinEnc" TEXT,
    "connectedByUserId" TEXT,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "headerText" TEXT,
    "bodyText" TEXT NOT NULL,
    "footerText" TEXT NOT NULL,
    "optOutLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metaTemplateId" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusUpdatedAt" DATETIME,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MessageTemplate_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "WhatsAppAccount" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "mode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "CampaignMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT,
    "toPhone" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignMessage_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignMessage_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessagingTestRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessagingTestRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_tenantId_key" ON "WhatsAppAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_phoneNumberId_key" ON "WhatsAppAccount"("phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_id_tenantId_key" ON "WhatsAppAccount"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_status_idx" ON "MessageTemplate"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MessageTemplate_metaTemplateId_idx" ON "MessageTemplate"("metaTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_id_tenantId_key" ON "MessageTemplate"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_wabaId_name_language_key" ON "MessageTemplate"("wabaId", "name", "language");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_createdAt_idx" ON "Campaign"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_tenantId_key" ON "Campaign"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_wamid_key" ON "CampaignMessage"("wamid");

-- CreateIndex
CREATE INDEX "CampaignMessage_campaignId_status_idx" ON "CampaignMessage"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignMessage_tenantId_customerId_acceptedAt_idx" ON "CampaignMessage"("tenantId", "customerId", "acceptedAt");

-- CreateIndex
CREATE INDEX "CampaignMessage_tenantId_createdAt_idx" ON "CampaignMessage"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_campaignId_toPhone_key" ON "CampaignMessage"("campaignId", "toPhone");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingTestRecipient_tenantId_phone_key" ON "MessagingTestRecipient"("tenantId", "phone");

