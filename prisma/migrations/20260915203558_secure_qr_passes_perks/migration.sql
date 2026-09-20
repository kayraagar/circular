-- DropIndex
DROP INDEX "CheckIn_registrationId_idx";

-- CreateTable
CREATE TABLE "Perk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Perk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Perk_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue" ("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PerkRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "perkId" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "redeemedByUserId" TEXT,
    "redeemedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerkRedemption_perkId_tenantId_fkey" FOREIGN KEY ("perkId", "tenantId") REFERENCES "Perk" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PerkRedemption_passId_tenantId_fkey" FOREIGN KEY ("passId", "tenantId") REFERENCES "Pass" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PerkRedemption_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Pass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "registrationId" TEXT,
    "perkId" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "issuedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pass_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pass_registrationId_tenantId_fkey" FOREIGN KEY ("registrationId", "tenantId") REFERENCES "EventRegistration" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pass_perkId_tenantId_fkey" FOREIGN KEY ("perkId", "tenantId") REFERENCES "Perk" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Pass" ("createdAt", "customerId", "id", "maxUses", "purpose", "registrationId", "revokedAt", "tenantId", "tokenHash", "useCount", "validFrom", "validUntil") SELECT "createdAt", "customerId", "id", "maxUses", "purpose", "registrationId", "revokedAt", "tenantId", "tokenHash", "useCount", "validFrom", "validUntil" FROM "Pass";
DROP TABLE "Pass";
ALTER TABLE "new_Pass" RENAME TO "Pass";
CREATE UNIQUE INDEX "Pass_tokenHash_key" ON "Pass"("tokenHash");
CREATE INDEX "Pass_tenantId_idx" ON "Pass"("tenantId");
CREATE INDEX "Pass_registrationId_idx" ON "Pass"("registrationId");
CREATE INDEX "Pass_customerId_perkId_idx" ON "Pass"("customerId", "perkId");
CREATE UNIQUE INDEX "Pass_id_tenantId_key" ON "Pass"("id", "tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Perk_tenantId_status_idx" ON "Perk"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Perk_id_tenantId_key" ON "Perk"("id", "tenantId");

-- CreateIndex
CREATE INDEX "PerkRedemption_tenantId_redeemedAt_idx" ON "PerkRedemption"("tenantId", "redeemedAt");

-- CreateIndex
CREATE INDEX "PerkRedemption_perkId_customerId_idx" ON "PerkRedemption"("perkId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_registrationId_key" ON "CheckIn"("registrationId");

