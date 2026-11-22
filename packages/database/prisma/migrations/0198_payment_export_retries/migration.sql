-- Phase 9 superseding Payment Exports (#643), as payroll-schema.md §12 has
-- it. After a Payment Instruction's latest Disbursement Outcome is REJECTED
-- or RETURNED and its Employee's destination is corrected, an authorized user
-- retries it: a new Payment Export that supersedes the prior attempt's export
-- and holds one new instruction linked to the prior one, with the reason
-- (#28). The prior export and instruction never change and are never resent.
--
-- A retry resends its prior attempt's payee and amount to a different
-- Payroll Bank Account; a payee or amount change is a Payroll Adjustment
-- (ADR 0016), not a retry. Each attempt is retried at most once, so a chain
-- of retries is a line, and its latest attempt is the one not yet retried.

ALTER TABLE "payment_exports"
  ADD COLUMN "supersedes_payment_export_id" UUID,
  ADD CONSTRAINT "payment_exports_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_payment_export_id")
    REFERENCES "payment_exports"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payment_exports_supersedes_self_check"
    CHECK ("supersedes_payment_export_id" IS NULL OR "supersedes_payment_export_id" <> "id");

-- A period still has one original export, which generating again returns;
-- its superseding exports are retries beside it.
ALTER TABLE "payment_exports" DROP CONSTRAINT "payment_exports_period_key";
CREATE UNIQUE INDEX "payment_exports_period_key"
  ON "payment_exports" ("payroll_period_id")
  WHERE "supersedes_payment_export_id" IS NULL;

ALTER TABLE "payment_instructions"
  ADD COLUMN "prior_payment_instruction_id" UUID,
  ADD COLUMN "retry_reason" TEXT,
  ADD CONSTRAINT "payment_instructions_prior_fkey"
    FOREIGN KEY ("agency_id", "prior_payment_instruction_id")
    REFERENCES "payment_instructions"("agency_id", "id") ON DELETE RESTRICT,
  -- A retry gives its reason; an original instruction has none.
  ADD CONSTRAINT "payment_instructions_retry_reason_check" CHECK (
    ("prior_payment_instruction_id" IS NULL) = ("retry_reason" IS NULL)
    AND ("retry_reason" IS NULL OR btrim("retry_reason") <> '')
  ),
  -- An attempt is retried at most once, so two retries at once cannot both land.
  ADD CONSTRAINT "payment_instructions_prior_key" UNIQUE ("prior_payment_instruction_id");

-- An export is written only for a FINALIZED period at its finalized version,
-- a superseding export only beside an export of the same period, and none is
-- ever changed or deleted.
CREATE OR REPLACE FUNCTION guard_payment_export_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payment Exports are immutable and retained'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."status" = 'FINALIZED'
      AND p."calculation_version" = NEW."calculation_version"
  ) THEN
    RAISE EXCEPTION 'A Payment Export is generated only from a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."supersedes_payment_export_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "payment_exports" x
    WHERE x."agency_id" = NEW."agency_id"
      AND x."id" = NEW."supersedes_payment_export_id"
      AND x."payroll_period_id" = NEW."payroll_period_id"
  ) THEN
    RAISE EXCEPTION 'A superseding Payment Export supersedes an export of the same payroll'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- An instruction is written only in the transaction that writes its export.
-- It pays a FINALIZED result of the export's period and version exactly its
-- net, to that Employee's ACTIVE (so verified) Payroll Bank Account effective
-- today in Asia/Manila. An instruction of a superseding export retries one of
-- the superseded export's instructions whose latest Disbursement Outcome is
-- REJECTED or RETURNED: same result, payee, amount, and payment reference, to
-- a different account. It is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_payment_instruction_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  superseded_export_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payment Instructions are immutable and retained; a retry is a linked new instruction'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "payment_exports" x
    JOIN "payroll_employees" e
      ON e."agency_id" = x."agency_id"
     AND e."payroll_period_id" = x."payroll_period_id"
     AND e."calculation_version" = x."calculation_version"
    JOIN "payroll_bank_accounts" a
      ON a."agency_id" = e."agency_id" AND a."employee_id" = e."employee_id"
    WHERE x."agency_id" = NEW."agency_id"
      AND x."id" = NEW."payment_export_id"
      AND x."xmin" = pg_current_xact_id()::xid
      AND e."id" = NEW."payroll_employee_id"
      AND e."status" = 'FINALIZED'
      AND e."net_amount" = NEW."amount"
      AND a."id" = NEW."payroll_bank_account_id"
      AND a."status" = 'ACTIVE'
      AND a."effective_from" <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND (a."effective_to" IS NULL OR a."effective_to" >= (now() AT TIME ZONE 'Asia/Manila')::date)
  ) THEN
    RAISE EXCEPTION 'A Payment Instruction pays a FINALIZED result of its new export its net, to that Employee''s active, verified, effective Payroll Bank Account'
      USING ERRCODE = '55000';
  END IF;

  SELECT x."supersedes_payment_export_id" INTO superseded_export_id
  FROM "payment_exports" x
  WHERE x."agency_id" = NEW."agency_id" AND x."id" = NEW."payment_export_id";
  IF superseded_export_id IS NULL THEN
    IF NEW."prior_payment_instruction_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Only a superseding Payment Export retries a Payment Instruction'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM "payment_instructions" prior
    WHERE prior."agency_id" = NEW."agency_id"
      AND prior."id" = NEW."prior_payment_instruction_id"
      AND prior."payment_export_id" = superseded_export_id
      AND prior."payroll_employee_id" = NEW."payroll_employee_id"
      AND prior."agency_employee_number" = NEW."agency_employee_number"
      AND prior."payee_legal_name" = NEW."payee_legal_name"
      AND prior."amount" = NEW."amount"
      AND prior."payment_reference" = NEW."payment_reference"
      AND prior."payroll_bank_account_id" <> NEW."payroll_bank_account_id"
      AND (
        SELECT o."outcome"
        FROM "disbursement_outcomes" o
        WHERE o."agency_id" = prior."agency_id"
          AND o."payment_instruction_id" = prior."id"
        ORDER BY o."sequence" DESC
        LIMIT 1
      ) IN ('REJECTED', 'RETURNED')
  ) THEN
    RAISE EXCEPTION 'A retried Payment Instruction resends a REJECTED or RETURNED instruction of the superseded export, with the same payee and amount, to a corrected destination'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'payment_exports' AND indexname = 'payment_exports_period_key'
      AND indexdef LIKE '%WHERE (supersedes_payment_export_id IS NULL)%'
  ) THEN
    RAISE EXCEPTION 'Payment Export original-per-period index verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payment_exports_mutation_trigger', 'payment_instructions_mutation_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Payment Export mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; superseding
-- exports and retried instructions are retained payroll history.
-- Verification: pnpm db:policies payment_exports; pnpm db:policies
-- payment_instructions
