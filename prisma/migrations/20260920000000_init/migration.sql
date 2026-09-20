-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeTenantId" TEXT,
    "activeVenueId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipVenue" (
    "membershipId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "MembershipVenue_pkey" PRIMARY KEY ("membershipId","venueId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "searchName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birthDate" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "sourceVenueId" TEXT,
    "sourceMembershipId" TEXT,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTag" (
    "customerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTag_pkey" PRIMARY KEY ("customerId","tagId")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "consentTextVersion" TEXT,
    "recordedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "VenueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "registrationOpensAt" TIMESTAMP(3),
    "registrationClosesAt" TIMESTAMP(3),
    "entryClosesAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "channel" TEXT NOT NULL,
    "completionStatus" TEXT NOT NULL DEFAULT 'STAFF_ENTERED',
    "accessStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "prMembershipId" TEXT,
    "addedByUserId" TEXT,
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPrAssignment" (
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPrAssignment_pkey" PRIMARY KEY ("eventId","membershipId")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "admittedCount" INTEGER NOT NULL DEFAULT 1,
    "method" TEXT NOT NULL,
    "passId" TEXT,
    "checkedInByUserId" TEXT,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "registrationId" TEXT,
    "perkId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Perk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Perk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerkRedemption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perkId" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "redeemedByUserId" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerkRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT,
    "eventId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "logoAssetId" TEXT,
    "coverAssetId" TEXT,
    "backgroundColor" TEXT NOT NULL DEFAULT '#080808',
    "themeStyle" TEXT NOT NULL DEFAULT 'MINIMAL',
    "accentColor" TEXT NOT NULL DEFAULT '#f7f7f5',
    "textColor" TEXT,
    "fontPair" TEXT NOT NULL DEFAULT 'GROTESK',
    "cornerStyle" TEXT NOT NULL DEFAULT 'SOFT',
    "surfaceStyle" TEXT NOT NULL DEFAULT 'OUTLINE',
    "density" TEXT NOT NULL DEFAULT 'COMFORTABLE',
    "headerAlign" TEXT NOT NULL DEFAULT 'CENTER',
    "priceStyle" TEXT NOT NULL DEFAULT 'SYMBOL',
    "tagline" TEXT,
    "showImages" BOOLEAN NOT NULL DEFAULT true,
    "showDescriptions" BOOLEAN NOT NULL DEFAULT true,
    "showCategoryNav" BOOLEAN NOT NULL DEFAULT true,
    "showFeatured" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "image" TEXT,
    "imageAssetId" TEXT,
    "badges" TEXT NOT NULL DEFAULT '',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Hemen katıl',
    "imageAssetId" TEXT,
    "perkId" TEXT,
    "venueId" TEXT,
    "delaySeconds" INTEGER NOT NULL DEFAULT 3,
    "privacyUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "eventId" TEXT,
    "guestTarget" INTEGER,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrInviteLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrTaskRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrTaskRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
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
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
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
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusUpdatedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
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
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMessage" (
    "id" TEXT NOT NULL,
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
    "attemptedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingTestRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingTestRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NETGSM',
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT,
    "msgheader" TEXT NOT NULL,
    "legalFooter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "replyTo" TEXT,
    "legalFooter" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTestRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTestRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "connectionMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramAutoReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'EXACT',
    "replyText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastRepliedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAutoReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramReplyLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "mid" TEXT NOT NULL,
    "senderHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramReplyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");

-- CreateIndex
CREATE INDEX "Venue_tenantId_idx" ON "Venue"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_id_tenantId_key" ON "Venue"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_tenantId_key" ON "Membership"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MembershipVenue_venueId_idx" ON "MembershipVenue"("venueId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_createdAt_idx" ON "Customer"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_tenantId_searchName_idx" ON "Customer"("tenantId", "searchName");

-- CreateIndex
CREATE INDEX "Customer_tenantId_source_idx" ON "Customer"("tenantId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_tenantId_key" ON "Customer"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_phone_key" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_email_key" ON "Customer"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_id_tenantId_key" ON "Tag"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenantId_nameKey_key" ON "Tag"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "CustomerTag_tagId_idx" ON "CustomerTag"("tagId");

-- CreateIndex
CREATE INDEX "ContactConsent_tenantId_channel_status_idx" ON "ContactConsent"("tenantId", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactConsent_customerId_channel_key" ON "ContactConsent"("customerId", "channel");

-- CreateIndex
CREATE INDEX "VenueMembership_tenantId_idx" ON "VenueMembership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueMembership_venueId_customerId_key" ON "VenueMembership"("venueId", "customerId");

-- CreateIndex
CREATE INDEX "Event_tenantId_startsAt_idx" ON "Event"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "Event_venueId_startsAt_idx" ON "Event"("venueId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_id_tenantId_key" ON "Event"("id", "tenantId");

-- CreateIndex
CREATE INDEX "EventRegistration_tenantId_createdAt_idx" ON "EventRegistration"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "EventRegistration_customerId_idx" ON "EventRegistration"("customerId");

-- CreateIndex
CREATE INDEX "EventRegistration_tenantId_eventId_prMembershipId_idx" ON "EventRegistration"("tenantId", "eventId", "prMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_customerId_key" ON "EventRegistration"("eventId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_id_tenantId_key" ON "EventRegistration"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CheckIn_tenantId_eventId_idx" ON "CheckIn"("tenantId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_registrationId_key" ON "CheckIn"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_tokenHash_key" ON "Pass"("tokenHash");

-- CreateIndex
CREATE INDEX "Pass_tenantId_idx" ON "Pass"("tenantId");

-- CreateIndex
CREATE INDEX "Pass_registrationId_idx" ON "Pass"("registrationId");

-- CreateIndex
CREATE INDEX "Pass_customerId_perkId_idx" ON "Pass"("customerId", "perkId");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_id_tenantId_key" ON "Pass"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Perk_tenantId_status_idx" ON "Perk"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Perk_id_tenantId_key" ON "Perk"("id", "tenantId");

-- CreateIndex
CREATE INDEX "PerkRedemption_tenantId_redeemedAt_idx" ON "PerkRedemption"("tenantId", "redeemedAt");

-- CreateIndex
CREATE INDEX "PerkRedemption_perkId_customerId_idx" ON "PerkRedemption"("perkId", "customerId");

-- CreateIndex
CREATE INDEX "ActivityLog_tenantId_createdAt_idx" ON "ActivityLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_customerId_createdAt_idx" ON "ActivityLog"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_eventId_createdAt_idx" ON "ActivityLog"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuConfig_tenantId_key" ON "MenuConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuConfig_id_tenantId_key" ON "MenuConfig"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MenuCategory_tenantId_order_idx" ON "MenuCategory"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_id_tenantId_key" ON "MenuCategory"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MenuItem_tenantId_categoryId_order_idx" ON "MenuItem"("tenantId", "categoryId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_id_tenantId_key" ON "MenuItem"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MenuAsset_tenantId_kind_createdAt_idx" ON "MenuAsset"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuAsset_id_tenantId_key" ON "MenuAsset"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCampaign_tenantId_key" ON "MenuCampaign"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCampaign_id_tenantId_key" ON "MenuCampaign"("id", "tenantId");

-- CreateIndex
CREATE INDEX "PrTask_tenantId_status_createdAt_idx" ON "PrTask"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrTask_id_tenantId_key" ON "PrTask"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PrInviteLink_code_key" ON "PrInviteLink"("code");

-- CreateIndex
CREATE INDEX "PrInviteLink_tenantId_eventId_membershipId_idx" ON "PrInviteLink"("tenantId", "eventId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PrInviteLink_id_tenantId_key" ON "PrInviteLink"("id", "tenantId");

-- CreateIndex
CREATE INDEX "PrTaskRecipient_tenantId_membershipId_idx" ON "PrTaskRecipient"("tenantId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PrTaskRecipient_taskId_membershipId_key" ON "PrTaskRecipient"("taskId", "membershipId");

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
CREATE INDEX "CampaignMessage_providerMessageId_idx" ON "CampaignMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "CampaignMessage_campaignId_status_idx" ON "CampaignMessage"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignMessage_tenantId_customerId_acceptedAt_idx" ON "CampaignMessage"("tenantId", "customerId", "acceptedAt");

-- CreateIndex
CREATE INDEX "CampaignMessage_tenantId_createdAt_idx" ON "CampaignMessage"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_campaignId_toPhone_key" ON "CampaignMessage"("campaignId", "toPhone");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_campaignId_toEmail_key" ON "CampaignMessage"("campaignId", "toEmail");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingTestRecipient_tenantId_phone_key" ON "MessagingTestRecipient"("tenantId", "phone");

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

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipVenue" ADD CONSTRAINT "MembershipVenue_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipVenue" ADD CONSTRAINT "MembershipVenue_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTag" ADD CONSTRAINT "CustomerTag_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTag" ADD CONSTRAINT "CustomerTag_tagId_tenantId_fkey" FOREIGN KEY ("tagId", "tenantId") REFERENCES "Tag"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueMembership" ADD CONSTRAINT "VenueMembership_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueMembership" ADD CONSTRAINT "VenueMembership_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_prMembershipId_tenantId_fkey" FOREIGN KEY ("prMembershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPrAssignment" ADD CONSTRAINT "EventPrAssignment_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPrAssignment" ADD CONSTRAINT "EventPrAssignment_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_registrationId_tenantId_fkey" FOREIGN KEY ("registrationId", "tenantId") REFERENCES "EventRegistration"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_registrationId_tenantId_fkey" FOREIGN KEY ("registrationId", "tenantId") REFERENCES "EventRegistration"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_perkId_tenantId_fkey" FOREIGN KEY ("perkId", "tenantId") REFERENCES "Perk"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Perk" ADD CONSTRAINT "Perk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Perk" ADD CONSTRAINT "Perk_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerkRedemption" ADD CONSTRAINT "PerkRedemption_perkId_tenantId_fkey" FOREIGN KEY ("perkId", "tenantId") REFERENCES "Perk"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerkRedemption" ADD CONSTRAINT "PerkRedemption_passId_tenantId_fkey" FOREIGN KEY ("passId", "tenantId") REFERENCES "Pass"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerkRedemption" ADD CONSTRAINT "PerkRedemption_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuConfig" ADD CONSTRAINT "MenuConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuConfig" ADD CONSTRAINT "MenuConfig_logoAssetId_tenantId_fkey" FOREIGN KEY ("logoAssetId", "tenantId") REFERENCES "MenuAsset"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuConfig" ADD CONSTRAINT "MenuConfig_coverAssetId_tenantId_fkey" FOREIGN KEY ("coverAssetId", "tenantId") REFERENCES "MenuAsset"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_tenantId_fkey" FOREIGN KEY ("categoryId", "tenantId") REFERENCES "MenuCategory"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_imageAssetId_tenantId_fkey" FOREIGN KEY ("imageAssetId", "tenantId") REFERENCES "MenuAsset"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuAsset" ADD CONSTRAINT "MenuAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCampaign" ADD CONSTRAINT "MenuCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCampaign" ADD CONSTRAINT "MenuCampaign_imageAssetId_tenantId_fkey" FOREIGN KEY ("imageAssetId", "tenantId") REFERENCES "MenuAsset"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCampaign" ADD CONSTRAINT "MenuCampaign_perkId_tenantId_fkey" FOREIGN KEY ("perkId", "tenantId") REFERENCES "Perk"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCampaign" ADD CONSTRAINT "MenuCampaign_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrTask" ADD CONSTRAINT "PrTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrTask" ADD CONSTRAINT "PrTask_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrInviteLink" ADD CONSTRAINT "PrInviteLink_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrInviteLink" ADD CONSTRAINT "PrInviteLink_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrTaskRecipient" ADD CONSTRAINT "PrTaskRecipient_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "PrTask"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrTaskRecipient" ADD CONSTRAINT "PrTaskRecipient_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "WhatsAppAccount"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_tenantId_fkey" FOREIGN KEY ("templateId", "tenantId") REFERENCES "MessageTemplate"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagingTestRecipient" ADD CONSTRAINT "MessagingTestRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsAccount" ADD CONSTRAINT "SmsAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSettings" ADD CONSTRAINT "EmailSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTestRecipient" ADD CONSTRAINT "EmailTestRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAutoReply" ADD CONSTRAINT "InstagramAutoReply_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramReplyLog" ADD CONSTRAINT "InstagramReplyLog_ruleId_tenantId_fkey" FOREIGN KEY ("ruleId", "tenantId") REFERENCES "InstagramAutoReply"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

