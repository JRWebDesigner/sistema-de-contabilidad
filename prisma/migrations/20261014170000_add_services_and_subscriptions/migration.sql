CREATE TYPE "ProductType" AS ENUM ('PRODUCT', 'SERVICE');

CREATE TYPE "ServiceBillingPeriod" AS ENUM ('ONE_TIME', 'MONTHLY', 'ANNUAL');

CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

ALTER TABLE "Product"
ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'PRODUCT',
ADD COLUMN "serviceBillingPeriod" "ServiceBillingPeriod";

CREATE INDEX "Product_type_serviceBillingPeriod_isActive_idx"
ON "Product"("type", "serviceBillingPeriod", "isActive");

CREATE TABLE "ServiceSubscription" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingPeriod" "ServiceBillingPeriod" NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextBillingDate" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceProductId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceSubscription_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Sale"
ADD COLUMN "subscriptionId" TEXT,
ADD COLUMN "subscriptionPeriodStart" TIMESTAMP(3);

CREATE UNIQUE INDEX "ServiceSubscription_number_key"
ON "ServiceSubscription"("number");

CREATE INDEX "ServiceSubscription_status_nextBillingDate_idx"
ON "ServiceSubscription"("status", "nextBillingDate");

CREATE INDEX "ServiceSubscription_customerId_status_idx"
ON "ServiceSubscription"("customerId", "status");

CREATE INDEX "ServiceSubscription_branchId_status_idx"
ON "ServiceSubscription"("branchId", "status");

CREATE UNIQUE INDEX "Sale_subscriptionId_subscriptionPeriodStart_key"
ON "Sale"("subscriptionId", "subscriptionPeriodStart");

ALTER TABLE "ServiceSubscription"
ADD CONSTRAINT "ServiceSubscription_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceSubscription"
ADD CONSTRAINT "ServiceSubscription_serviceProductId_fkey"
FOREIGN KEY ("serviceProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceSubscription"
ADD CONSTRAINT "ServiceSubscription_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "ServiceSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
