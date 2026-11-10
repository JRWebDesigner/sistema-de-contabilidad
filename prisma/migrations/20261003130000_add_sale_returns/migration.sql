BEGIN;

CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "saleId" TEXT NOT NULL,
    "cashAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleReturnItem" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleReturn_number_key" ON "SaleReturn"("number");
CREATE INDEX "SaleReturn_saleId_createdAt_idx" ON "SaleReturn"("saleId", "createdAt");
CREATE INDEX "SaleReturn_cashAccountId_idx" ON "SaleReturn"("cashAccountId");
CREATE UNIQUE INDEX "SaleReturnItem_saleReturnId_saleItemId_key" ON "SaleReturnItem"("saleReturnId", "saleItemId");
CREATE INDEX "SaleReturnItem_saleItemId_idx" ON "SaleReturnItem"("saleItemId");
CREATE INDEX "SaleReturnItem_productId_idx" ON "SaleReturnItem"("productId");

ALTER TABLE "SaleReturn"
ADD CONSTRAINT "SaleReturn_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleReturn"
ADD CONSTRAINT "SaleReturn_cashAccountId_fkey"
FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey"
FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_saleItemId_fkey"
FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
