BEGIN;

CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'COMPLETED');

CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceListItem" (
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("priceListId", "productId")
);

CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionProduct" (
    "promotionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "PromotionProduct_pkey" PRIMARY KEY ("promotionId", "productId")
);

CREATE TABLE "CustomerFollowUp" (
    "id" TEXT NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerFollowUp_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Customer" ADD COLUMN "priceListId" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "promotionName" VARCHAR(120);
ALTER TABLE "ProformaItem" ADD COLUMN "promotionName" VARCHAR(120);

CREATE UNIQUE INDEX "PriceList_name_key" ON "PriceList"("name");
CREATE INDEX "PriceList_isActive_idx" ON "PriceList"("isActive");
CREATE INDEX "PriceListItem_productId_idx" ON "PriceListItem"("productId");
CREATE INDEX "Promotion_isActive_startsAt_endsAt_idx" ON "Promotion"("isActive", "startsAt", "endsAt");
CREATE INDEX "PromotionProduct_productId_idx" ON "PromotionProduct"("productId");
CREATE INDEX "CustomerFollowUp_status_dueAt_idx" ON "CustomerFollowUp"("status", "dueAt");
CREATE INDEX "CustomerFollowUp_customerId_createdAt_idx" ON "CustomerFollowUp"("customerId", "createdAt");
CREATE INDEX "Customer_priceListId_idx" ON "Customer"("priceListId");

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_priceListId_fkey"
FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceListItem"
ADD CONSTRAINT "PriceListItem_priceListId_fkey"
FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriceListItem"
ADD CONSTRAINT "PriceListItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_promotionId_fkey"
FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerFollowUp"
ADD CONSTRAINT "CustomerFollowUp_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
