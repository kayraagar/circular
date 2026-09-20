-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeTenantId" TEXT,
    "activeVenueId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Venue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipVenue" (
    "membershipId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    PRIMARY KEY ("membershipId", "venueId"),
    CONSTRAINT "MembershipVenue_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MembershipVenue_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerTag" (
    "customerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("customerId", "tagId"),
    CONSTRAINT "CustomerTag_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerTag_tagId_tenantId_fkey" FOREIGN KEY ("tagId", "tenantId") REFERENCES "Tag" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "consentTextVersion" TEXT,
    "recordedByUserId" TEXT,
    "grantedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContactConsent_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VenueMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    CONSTRAINT "VenueMembership_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VenueMembership_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "capacity" INTEGER,
    "registrationOpensAt" DATETIME,
    "registrationClosesAt" DATETIME,
    "entryClosesAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue" ("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventRegistration_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventRegistration_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventPrAssignment" (
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("eventId", "membershipId"),
    CONSTRAINT "EventPrAssignment_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventPrAssignment_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "admittedCount" INTEGER NOT NULL DEFAULT 1,
    "method" TEXT NOT NULL,
    "passId" TEXT,
    "checkedInByUserId" TEXT,
    "checkedInAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckIn_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CheckIn_registrationId_tenantId_fkey" FOREIGN KEY ("registrationId", "tenantId") REFERENCES "EventRegistration" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CheckIn_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "registrationId" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pass_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pass_registrationId_tenantId_fkey" FOREIGN KEY ("registrationId", "tenantId") REFERENCES "EventRegistration" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT,
    "eventId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "EventRegistration_eventId_customerId_key" ON "EventRegistration"("eventId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_id_tenantId_key" ON "EventRegistration"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CheckIn_tenantId_eventId_idx" ON "CheckIn"("tenantId", "eventId");

-- CreateIndex
CREATE INDEX "CheckIn_registrationId_idx" ON "CheckIn"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_tokenHash_key" ON "Pass"("tokenHash");

-- CreateIndex
CREATE INDEX "Pass_tenantId_idx" ON "Pass"("tenantId");

-- CreateIndex
CREATE INDEX "ActivityLog_tenantId_createdAt_idx" ON "ActivityLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_customerId_createdAt_idx" ON "ActivityLog"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_eventId_createdAt_idx" ON "ActivityLog"("eventId", "createdAt");
