ALTER TABLE "Supplier"
  ADD COLUMN "contactName" VARCHAR(180),
  ADD COLUMN "contactPhone" VARCHAR(30),
  ADD COLUMN "city" VARCHAR(100),
  ADD COLUMN "paymentTerms" VARCHAR(250),
  ADD COLUMN "estimatedDeliveryDays" INTEGER,
  ADD COLUMN "observations" VARCHAR(500);
