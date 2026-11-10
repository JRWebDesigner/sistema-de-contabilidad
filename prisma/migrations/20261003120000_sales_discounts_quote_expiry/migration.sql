BEGIN;

ALTER TABLE "Sale"
ADD COLUMN "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "proformaId" TEXT;

ALTER TABLE "Proforma"
ADD COLUMN "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "validUntil" TIMESTAMP(3);

UPDATE "Proforma"
SET "validUntil" = "createdAt" + INTERVAL '15 days'
WHERE "validUntil" IS NULL;

ALTER TABLE "Proforma"
ALTER COLUMN "validUntil" SET NOT NULL;

ALTER TABLE "ProformaItem"
ADD COLUMN "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "SaleItem"
ADD COLUMN "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Sale_proformaId_key" ON "Sale"("proformaId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_proformaId_fkey"
FOREIGN KEY ("proformaId") REFERENCES "Proforma"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
