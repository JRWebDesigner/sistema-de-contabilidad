ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';

BEGIN;

CREATE TABLE "Branch" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "code" VARCHAR(30) NOT NULL,
  "address" VARCHAR(250),
  "phone" VARCHAR(30),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductStock" (
  "id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "productId" TEXT NOT NULL,
  "branchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductStock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockTransfer" (
  "id" TEXT NOT NULL,
  "number" VARCHAR(30) NOT NULL,
  "fromBranchId" TEXT,
  "toBranchId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Sale" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Proforma" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "branchId" TEXT;
ALTER TABLE "CashAccount" ADD COLUMN "branchId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "branchId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "transferId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "branchId" TEXT;

INSERT INTO "ProductStock" ("id", "quantity", "productId", "branchId", "updatedAt")
SELECT 'legacy-stock-' || "id", "currentStock", "id", NULL, CURRENT_TIMESTAMP
FROM "Product";

CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");
CREATE INDEX "Branch_isActive_idx" ON "Branch"("isActive");
CREATE UNIQUE INDEX "ProductStock_branchId_productId_key" ON "ProductStock"("branchId", "productId");
CREATE INDEX "ProductStock_productId_idx" ON "ProductStock"("productId");
CREATE UNIQUE INDEX "StockTransfer_number_key" ON "StockTransfer"("number");
CREATE INDEX "StockTransfer_fromBranchId_createdAt_idx" ON "StockTransfer"("fromBranchId", "createdAt");
CREATE INDEX "StockTransfer_toBranchId_createdAt_idx" ON "StockTransfer"("toBranchId", "createdAt");
CREATE INDEX "Sale_branchId_createdAt_idx" ON "Sale"("branchId", "createdAt");
CREATE INDEX "Proforma_branchId_createdAt_idx" ON "Proforma"("branchId", "createdAt");
CREATE INDEX "Purchase_branchId_createdAt_idx" ON "Purchase"("branchId", "createdAt");
CREATE INDEX "CashAccount_branchId_idx" ON "CashAccount"("branchId");
CREATE INDEX "InventoryMovement_branchId_createdAt_idx" ON "InventoryMovement"("branchId", "createdAt");
CREATE INDEX "InventoryMovement_transferId_idx" ON "InventoryMovement"("transferId");
CREATE INDEX "JournalEntry_branchId_entryDate_idx" ON "JournalEntry"("branchId", "entryDate");

ALTER TABLE "ProductStock" ADD CONSTRAINT "ProductStock_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductStock" ADD CONSTRAINT "ProductStock_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromBranchId_fkey"
  FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toBranchId_fkey"
  FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Proforma" ADD CONSTRAINT "Proforma_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashAccount" ADD CONSTRAINT "CashAccount_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
