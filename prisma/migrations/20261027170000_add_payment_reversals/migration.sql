ALTER TABLE "ReceivablePayment"
ADD COLUMN "reversedAt" TIMESTAMP(3),
ADD COLUMN "reversalReason" VARCHAR(500);

ALTER TABLE "PayablePayment"
ADD COLUMN "reversedAt" TIMESTAMP(3),
ADD COLUMN "reversalReason" VARCHAR(500);
