ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TABLE "Sale"
ADD COLUMN "requiresInvoice" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CashAccount"
ADD COLUMN "custodianId" TEXT;

ALTER TABLE "CashAccount"
ADD CONSTRAINT "CashAccount_custodianId_fkey"
FOREIGN KEY ("custodianId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CashAccount_custodianId_idx" ON "CashAccount"("custodianId");
