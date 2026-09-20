
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EventRegistration" (
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
    CONSTRAINT "EventRegistration_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventRegistration_prMembershipId_tenantId_fkey" FOREIGN KEY ("prMembershipId", "tenantId") REFERENCES "Membership" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_EventRegistration" ("accessStatus", "addedByUserId", "cancelledAt", "channel", "completionStatus", "createdAt", "customerId", "eventId", "id", "note", "partySize", "prMembershipId", "tenantId", "updatedAt") SELECT "accessStatus", "addedByUserId", "cancelledAt", "channel", "completionStatus", "createdAt", "customerId", "eventId", "id", "note", "partySize", "prMembershipId", "tenantId", "updatedAt" FROM "EventRegistration";
DROP TABLE "EventRegistration";
ALTER TABLE "new_EventRegistration" RENAME TO "EventRegistration";
CREATE INDEX "EventRegistration_tenantId_createdAt_idx" ON "EventRegistration"("tenantId", "createdAt");
CREATE INDEX "EventRegistration_customerId_idx" ON "EventRegistration"("customerId");
CREATE INDEX "EventRegistration_tenantId_eventId_prMembershipId_idx" ON "EventRegistration"("tenantId", "eventId", "prMembershipId");
CREATE UNIQUE INDEX "EventRegistration_eventId_customerId_key" ON "EventRegistration"("eventId", "customerId");
CREATE UNIQUE INDEX "EventRegistration_id_tenantId_key" ON "EventRegistration"("id", "tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

