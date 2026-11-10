ALTER TYPE "ReceivableStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "PayableStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "CashMovement" ADD COLUMN "purchaseId" TEXT;
ALTER TABLE "PurchaseItem" ADD COLUMN "previousUnitCost" DECIMAL(12,2);

UPDATE "CashMovement" AS movement
SET "purchaseId" = purchase."id"
FROM "Purchase" AS purchase
WHERE movement."reference" = purchase."number"
	AND movement."type" = 'OUT'
	AND movement."purchaseId" IS NULL;

UPDATE "PurchaseItem" AS current_item
SET "previousUnitCost" = COALESCE(
	(
		SELECT previous_item."unitCost"
		FROM "PurchaseItem" AS previous_item
		JOIN "Purchase" AS previous_purchase ON previous_purchase."id" = previous_item."purchaseId"
		JOIN "Purchase" AS current_purchase ON current_purchase."id" = current_item."purchaseId"
		WHERE previous_item."productId" = current_item."productId"
			AND previous_purchase."status" = 'RECEIVED'
			AND (previous_purchase."createdAt", previous_purchase."id") < (current_purchase."createdAt", current_purchase."id")
		ORDER BY previous_purchase."createdAt" DESC, previous_purchase."id" DESC
		LIMIT 1
	),
	(
		SELECT movement."unitCost"
		FROM "InventoryMovement" AS movement
		WHERE movement."productId" = current_item."productId"
			AND movement."type" = 'INITIAL'
		ORDER BY movement."createdAt" ASC
		LIMIT 1
	)
)
WHERE current_item."previousUnitCost" IS NULL;

CREATE INDEX "CashMovement_purchaseId_idx" ON "CashMovement"("purchaseId");

ALTER TABLE "CashMovement"
ADD CONSTRAINT "CashMovement_purchaseId_fkey"
FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;