
-- CreateTable
CREATE TABLE "MenuCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuCampaign_imageAssetId_tenantId_fkey" FOREIGN KEY ("imageAssetId", "tenantId") REFERENCES "MenuAsset" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "MenuCampaign_perkId_tenantId_fkey" FOREIGN KEY ("perkId", "tenantId") REFERENCES "Perk" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "MenuCampaign_venueId_tenantId_fkey" FOREIGN KEY ("venueId", "tenantId") REFERENCES "Venue" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MenuCampaign_tenantId_key" ON "MenuCampaign"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCampaign_id_tenantId_key" ON "MenuCampaign"("id", "tenantId");

