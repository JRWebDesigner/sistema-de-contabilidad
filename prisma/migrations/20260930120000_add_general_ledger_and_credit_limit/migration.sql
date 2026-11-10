BEGIN;

CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

ALTER TABLE "Customer" ADD COLUMN "creditLimit" DECIMAL(12,2);

CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" VARCHAR(120),
    "closeNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountingPeriod_dates_check" CHECK ("startDate" <= "endDate")
);

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "sourceType" VARCHAR(40),
    "sourceId" VARCHAR(120),
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "periodId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "description" VARCHAR(250),
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JournalLine_one_side_check" CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
);

CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");
CREATE INDEX "LedgerAccount_type_isActive_idx" ON "LedgerAccount"("type", "isActive");
CREATE UNIQUE INDEX "AccountingPeriod_code_key" ON "AccountingPeriod"("code");
CREATE INDEX "AccountingPeriod_startDate_endDate_status_idx" ON "AccountingPeriod"("startDate", "endDate", "status");
CREATE UNIQUE INDEX "JournalEntry_number_key" ON "JournalEntry"("number");
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key" ON "JournalEntry"("sourceType", "sourceId");
CREATE INDEX "JournalEntry_entryDate_periodId_idx" ON "JournalEntry"("entryDate", "periodId");
CREATE INDEX "JournalLine_accountId_entryId_idx" ON "JournalLine"("accountId", "entryId");

INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "isSystem", "updatedAt") VALUES
('ledger-1000', '1000', 'Caja y bancos', 'ASSET', true, CURRENT_TIMESTAMP),
('ledger-1200', '1200', 'Cuentas por cobrar', 'ASSET', true, CURRENT_TIMESTAMP),
('ledger-1300', '1300', 'Inventario', 'ASSET', true, CURRENT_TIMESTAMP),
('ledger-2100', '2100', 'Cuentas por pagar', 'LIABILITY', true, CURRENT_TIMESTAMP),
('ledger-3000', '3000', 'Capital y saldos iniciales', 'EQUITY', true, CURRENT_TIMESTAMP),
('ledger-4000', '4000', 'Ventas', 'INCOME', true, CURRENT_TIMESTAMP),
('ledger-4100', '4100', 'Devoluciones y descuentos sobre ventas', 'EXPENSE', true, CURRENT_TIMESTAMP),
('ledger-4900', '4900', 'Otros ingresos', 'INCOME', true, CURRENT_TIMESTAMP),
('ledger-5000', '5000', 'Costo de ventas', 'EXPENSE', true, CURRENT_TIMESTAMP),
('ledger-5100', '5100', 'Ajustes y mermas de inventario', 'EXPENSE', true, CURRENT_TIMESTAMP),
('ledger-6000', '6000', 'Gastos generales', 'EXPENSE', true, CURRENT_TIMESTAMP);

DO $$
DECLARE
    cutover_date DATE := CURRENT_DATE;
    period_id TEXT := 'period-' || to_char(CURRENT_DATE, 'YYYY-MM');
    opening_entry_id TEXT := 'opening-entry-' || to_char(CURRENT_DATE, 'YYYY-MM');
    cash_balance DECIMAL(14,2);
    receivable_balance DECIMAL(14,2);
    inventory_value DECIMAL(14,2);
    payable_balance DECIMAL(14,2);
    equity_balance DECIMAL(14,2);
BEGIN
    INSERT INTO "AccountingPeriod" ("id", "code", "startDate", "endDate")
    VALUES (
        period_id,
        to_char(cutover_date, 'YYYY-MM'),
        cutover_date,
        (date_trunc('month', cutover_date) + INTERVAL '1 month - 1 day')::date
    );

    SELECT COALESCE(SUM("balance"), 0) INTO cash_balance FROM "CashAccount";
    SELECT COALESCE(SUM("balance"), 0) INTO receivable_balance FROM "AccountReceivable" WHERE "status" <> 'CANCELLED';
    SELECT COALESCE(SUM("currentStock" * "cost"), 0) INTO inventory_value FROM "Product";
    SELECT COALESCE(SUM("balance"), 0) INTO payable_balance FROM "AccountPayable" WHERE "status" <> 'CANCELLED';
    equity_balance := cash_balance + receivable_balance + inventory_value - payable_balance;

    INSERT INTO "JournalEntry" ("id", "number", "entryDate", "description", "sourceType", "sourceId", "periodId")
    VALUES ('opening-entry-' || to_char(cutover_date, 'YYYY-MM'), 'AS-OPEN-' || to_char(cutover_date, 'YYYYMM'), cutover_date, 'Saldos de apertura al inicio del libro mayor', 'OPENING_BALANCE', to_char(cutover_date, 'YYYY-MM-DD'), period_id);

    INSERT INTO "JournalLine" ("id", "entryId", "accountId", "debit", "credit")
    SELECT 'opening-line-' || code, opening_entry_id, ledger_id, amount, 0
    FROM (
        VALUES
            ('1000', 'ledger-1000', cash_balance),
            ('1200', 'ledger-1200', receivable_balance),
            ('1300', 'ledger-1300', inventory_value)
    ) AS opening(code, ledger_id, amount)
    WHERE amount > 0;

    IF payable_balance > 0 THEN
        INSERT INTO "JournalLine" ("id", "entryId", "accountId", "debit", "credit")
        VALUES ('opening-line-2100', opening_entry_id, 'ledger-2100', 0, payable_balance);
    END IF;

    IF equity_balance > 0 THEN
        INSERT INTO "JournalLine" ("id", "entryId", "accountId", "debit", "credit")
        VALUES ('opening-line-3000', opening_entry_id, 'ledger-3000', 0, equity_balance);
    ELSIF equity_balance < 0 THEN
        INSERT INTO "JournalLine" ("id", "entryId", "accountId", "debit", "credit")
        VALUES ('opening-line-3000', opening_entry_id, 'ledger-3000', ABS(equity_balance), 0);
    END IF;
END $$;

COMMIT;