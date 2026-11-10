BEGIN;

ALTER TABLE "Product" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "InventoryMovement" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Sale" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Proforma" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "CashAccount" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "CashMovement" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "AccountReceivable" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "ReceivablePayment" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Purchase" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "AccountPayable" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "PayablePayment" ALTER COLUMN "currency" DROP DEFAULT;

ALTER TYPE "Currency" RENAME TO "Currency_old";
CREATE TYPE "Currency" AS ENUM ('USD', 'BOB');

ALTER TABLE "Product" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "InventoryMovement" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "Sale" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "Proforma" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "CashAccount" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "CashMovement" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "AccountReceivable" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "ReceivablePayment" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "Purchase" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "AccountPayable" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";
ALTER TABLE "PayablePayment" ALTER COLUMN "currency" TYPE "Currency" USING 'BOB'::"Currency";

DROP TYPE "Currency_old";

ALTER TABLE "Product" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "InventoryMovement" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "Sale" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "Proforma" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "CashAccount" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "CashMovement" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "AccountReceivable" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "ReceivablePayment" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "Purchase" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "AccountPayable" ALTER COLUMN "currency" SET DEFAULT 'BOB';
ALTER TABLE "PayablePayment" ALTER COLUMN "currency" SET DEFAULT 'BOB';

ALTER TABLE "Sale" ALTER COLUMN "taxRate" SET DEFAULT 0;
ALTER TABLE "Proforma" ALTER COLUMN "taxRate" SET DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "taxRate" SET DEFAULT 0;

COMMIT;
