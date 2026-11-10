CREATE TYPE "ArchivedReportType" AS ENUM (
    'CUSTOMER_STATEMENT_DETAILED',
    'CUSTOMER_STATEMENT_SUMMARY',
    'CUSTOMER_DEBTS',
    'SALES_REPORT',
    'INVENTORY_REPORT',
    'CONTACTS_REPORT',
    'FINANCE_REPORT'
);

CREATE TYPE "ArchivedReportSource" AS ENUM ('GENERATED', 'IMPORTED');

CREATE TABLE "ArchivedReport" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "type" "ArchivedReportType" NOT NULL,
    "source" "ArchivedReportSource" NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "customerId" TEXT,
    "branchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchivedReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArchivedReport_type_createdAt_idx" ON "ArchivedReport"("type", "createdAt");
CREATE INDEX "ArchivedReport_customerId_type_createdAt_idx" ON "ArchivedReport"("customerId", "type", "createdAt");
CREATE INDEX "ArchivedReport_branchId_type_createdAt_idx" ON "ArchivedReport"("branchId", "type", "createdAt");

ALTER TABLE "ArchivedReport"
ADD CONSTRAINT "ArchivedReport_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ArchivedReport"
ADD CONSTRAINT "ArchivedReport_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ArchivedReport"
ADD CONSTRAINT "ArchivedReport_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
