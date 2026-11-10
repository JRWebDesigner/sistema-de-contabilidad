ALTER TABLE "ReceivablePayment"
ADD COLUMN "externalReference" VARCHAR(100),
ADD COLUMN "description" VARCHAR(500),
ADD COLUMN "recordedByAlias" VARCHAR(40);
