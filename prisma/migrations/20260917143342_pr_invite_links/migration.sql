
-- CreateTable
CREATE TABLE "PrInviteLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrInviteLink_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrInviteLink_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PrInviteLink_code_key" ON "PrInviteLink"("code");

-- CreateIndex
CREATE INDEX "PrInviteLink_tenantId_eventId_membershipId_idx" ON "PrInviteLink"("tenantId", "eventId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PrInviteLink_id_tenantId_key" ON "PrInviteLink"("id", "tenantId");

