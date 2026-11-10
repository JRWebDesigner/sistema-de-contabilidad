DROP INDEX IF EXISTS "Sale_proformaId_key";

CREATE INDEX IF NOT EXISTS "Sale_proformaId_idx" ON "Sale"("proformaId");
