-- CreateTable
CREATE TABLE "MenuConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "backgroundColor" TEXT NOT NULL DEFAULT '#080808',
    "themeStyle" TEXT NOT NULL DEFAULT 'MINIMAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" REAL NOT NULL,
    "image" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuItem_categoryId_tenantId_fkey" FOREIGN KEY ("categoryId", "tenantId") REFERENCES "MenuCategory" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

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

