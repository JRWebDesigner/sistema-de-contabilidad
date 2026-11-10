ALTER TABLE "Customer"
  ADD COLUMN "documentNumber" VARCHAR(30),
  ADD COLUMN "nit" VARCHAR(30),
  ADD COLUMN "alias" VARCHAR(120),
  ADD COLUMN "observation" VARCHAR(500),
  ADD COLUMN "billingData" JSONB,
  ADD COLUMN "branches" JSONB,
  ADD COLUMN "legalRepresentatives" JSONB,
  ADD COLUMN "communicationPhones" JSONB,
  ADD COLUMN "communicationEmails" JSONB,
  ADD COLUMN "socialNetworks" JSONB,
  ADD COLUMN "contacts" JSONB,
  ADD COLUMN "credit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paymentDays" INTEGER,
  ADD COLUMN "firstSale" TIMESTAMP(3),
  ADD COLUMN "accountingReference" VARCHAR(120),
  ADD COLUMN "addresses" JSONB,
  ADD COLUMN "attachments" JSONB;

UPDATE "Customer"
SET "documentNumber" = "document";