CREATE TYPE "CustomerOrderStatus" AS ENUM ('PENDING', 'DELIVERED', 'CANCELLED');

ALTER TABLE "Sale"
ADD COLUMN "customerOrderId" TEXT;

CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(80) NOT NULL,
    "status" "CustomerOrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes" VARCHAR(500),
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sellerId" TEXT,
    "receivedByName" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerOrderItem" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "productType" "ProductType" NOT NULL,
    "serviceBillingPeriod" "ServiceBillingPeriod",
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "promotionName" VARCHAR(120),
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "CustomerOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerOrder_number_key" ON "CustomerOrder"("number");
CREATE INDEX "CustomerOrder_branchId_status_createdAt_idx" ON "CustomerOrder"("branchId", "status", "createdAt");
CREATE INDEX "CustomerOrder_customerId_status_idx" ON "CustomerOrder"("customerId", "status");
CREATE INDEX "CustomerOrder_sellerId_idx" ON "CustomerOrder"("sellerId");
CREATE UNIQUE INDEX "CustomerOrderItem_orderId_productId_key" ON "CustomerOrderItem"("orderId", "productId");
CREATE INDEX "CustomerOrderItem_productId_idx" ON "CustomerOrderItem"("productId");
CREATE INDEX "Sale_customerOrderId_idx" ON "Sale"("customerOrderId");

ALTER TABLE "CustomerOrder"
ADD CONSTRAINT "CustomerOrder_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerOrder"
ADD CONSTRAINT "CustomerOrder_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerOrder"
ADD CONSTRAINT "CustomerOrder_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerOrderItem"
ADD CONSTRAINT "CustomerOrderItem_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerOrderItem"
ADD CONSTRAINT "CustomerOrderItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_customerOrderId_fkey"
FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
