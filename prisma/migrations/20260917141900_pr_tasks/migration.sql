
-- CreateTable
CREATE TABLE "PrTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "eventId" TEXT,
    "guestTarget" INTEGER,
    "dueAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" DATETIME,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PrTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrTask_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrTaskRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrTaskRecipient_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "PrTask" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrTaskRecipient_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PrTask_tenantId_status_createdAt_idx" ON "PrTask"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrTask_id_tenantId_key" ON "PrTask"("id", "tenantId");

-- CreateIndex
CREATE INDEX "PrTaskRecipient_tenantId_membershipId_idx" ON "PrTaskRecipient"("tenantId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PrTaskRecipient_taskId_membershipId_key" ON "PrTaskRecipient"("taskId", "membershipId");

