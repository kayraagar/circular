
-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN "description" TEXT;

-- CreateTable
CREATE TABLE "MenuAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MenuAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MenuConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuConfig_logoAssetId_tenantId_fkey" FOREIGN KEY ("logoAssetId", "tenantId") REFERENCES "MenuAsset" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "MenuConfig_coverAssetId_tenantId_fkey" FOREIGN KEY ("coverAssetId", "tenantId") REFERENCES "MenuAsset" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_MenuConfig" ("backgroundColor", "createdAt", "id", "logoUrl", "tenantId", "themeStyle", "updatedAt") SELECT "backgroundColor", "createdAt", "id", "logoUrl", "tenantId", "themeStyle", "updatedAt" FROM "MenuConfig";
DROP TABLE "MenuConfig";
ALTER TABLE "new_MenuConfig" RENAME TO "MenuConfig";
CREATE UNIQUE INDEX "MenuConfig_tenantId_key" ON "MenuConfig"("tenantId");
CREATE UNIQUE INDEX "MenuConfig_id_tenantId_key" ON "MenuConfig"("id", "tenantId");
CREATE TABLE "new_MenuItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" REAL NOT NULL,
    "image" TEXT,
    "imageAssetId" TEXT,
    "badges" TEXT NOT NULL DEFAULT '',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuItem_categoryId_tenantId_fkey" FOREIGN KEY ("categoryId", "tenantId") REFERENCES "MenuCategory" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuItem_imageAssetId_tenantId_fkey" FOREIGN KEY ("imageAssetId", "tenantId") REFERENCES "MenuAsset" ("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_MenuItem" ("categoryId", "createdAt", "description", "id", "image", "isAvailable", "name", "order", "price", "tenantId", "updatedAt") SELECT "categoryId", "createdAt", "description", "id", "image", "isAvailable", "name", "order", "price", "tenantId", "updatedAt" FROM "MenuItem";
DROP TABLE "MenuItem";
ALTER TABLE "new_MenuItem" RENAME TO "MenuItem";
CREATE INDEX "MenuItem_tenantId_categoryId_order_idx" ON "MenuItem"("tenantId", "categoryId", "order");
CREATE UNIQUE INDEX "MenuItem_id_tenantId_key" ON "MenuItem"("id", "tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MenuAsset_tenantId_kind_createdAt_idx" ON "MenuAsset"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuAsset_id_tenantId_key" ON "MenuAsset"("id", "tenantId");

