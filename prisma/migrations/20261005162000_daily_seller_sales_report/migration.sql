BEGIN;

ALTER TABLE "Sale"
ADD COLUMN "sellerId" TEXT;

CREATE INDEX "Sale_sellerId_idx" ON "Sale"("sellerId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Sale" AS sale
SET "sellerId" = (
  SELECT audit."userId"
  FROM "AuditLog" AS audit
  WHERE audit."entity" = 'Sale'
    AND audit."entityId" = sale."id"
    AND audit."action" = 'CREATE'
    AND audit."userId" IS NOT NULL
  ORDER BY audit."createdAt" ASC
  LIMIT 1
)
WHERE sale."sellerId" IS NULL;

UPDATE "Sale" AS sale
SET "sellerId" = (
  SELECT audit."userId"
  FROM "AuditLog" AS audit
  WHERE audit."entity" = 'Proforma'
    AND audit."entityId" = sale."proformaId"
    AND audit."action" = 'ACCEPT'
    AND audit."userId" IS NOT NULL
  ORDER BY audit."createdAt" ASC
  LIMIT 1
)
WHERE sale."sellerId" IS NULL
  AND sale."proformaId" IS NOT NULL;

COMMIT;
