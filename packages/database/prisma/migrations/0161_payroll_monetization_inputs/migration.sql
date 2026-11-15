-- Leave monetization moves onto the Payroll Input inbox (#339). Payroll now
-- values a Monetization Earning Input itself and stores it in
-- `payroll_inputs` as `MONETIZATION_EARNING` (payroll-schema.md §4). The
-- phase-local `payroll_monetization_earning_inputs` table from 0091 folds into
-- the inbox and is dropped.
--
-- Every row moves with its own identifier, so `monetization_postings`,
-- `monetization_adjustments`, and `payroll_monetization_adjustment_outcomes`
-- keep pointing at the same inputs. The inbox has no SUPERSEDED status: a
-- superseded input becomes CANCELLED, and its successor names it in
-- `replaces_payroll_input_id`, the §4 replacement. The old row's columns that
-- the inbox has no column for, its status included, stay in
-- `payload_snapshot`, so no history is rewritten.
--
-- The inbox records a CONSUMED input only with the period that consumed it.
-- The old table has no period, so a CONSUMED row stops the migration instead of
-- inventing one. No code path ever consumed one.

-- Both tables force RLS, which binds their owner too; the move reads and
-- writes every Agency's rows.
ALTER TABLE "payroll_monetization_earning_inputs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_inputs" DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payroll_monetization_earning_inputs" WHERE "status" = 'CONSUMED'
  ) THEN
    RAISE EXCEPTION 'A consumed Payroll Monetization Earning Input has no consuming Payroll Period to move with it';
  END IF;
END;
$$;

-- One statement, so each successor's `replaces_payroll_input_id` foreign key is
-- checked after its predecessor is in. The inbox accepts an input only as
-- PENDING; the cancellations follow as the one transition its guard allows.
INSERT INTO "payroll_inputs" (
  "id", "agency_id", "employee_id", "source_module", "input_kind", "source_key",
  "source_type", "source_id", "effective_date", "quantity", "amount", "status",
  "payload_snapshot", "payload_hash", "accepted_at", "replaces_payroll_input_id"
)
SELECT
  moved."id",
  moved."agency_id",
  moved."employee_id",
  'LEAVE',
  'MONETIZATION_EARNING',
  moved."source_version_key",
  moved."source_type"::text,
  moved."source_id",
  moved."effective_date",
  moved."quantity",
  moved."amount",
  'PENDING',
  moved."payload",
  encode(sha256(convert_to(moved."payload"::text, 'UTF8')), 'hex'),
  moved."created_at",
  moved."supersedes_input_id"
FROM (
  SELECT
    old.*,
    old."payload_snapshot" || jsonb_build_object(
      'payrollValuation', jsonb_build_object(
        'calculatorKind', old."calculator_kind"::text,
        'factor', old."factor"::text,
        'valuationDate', to_char(old."valuation_date", 'YYYY-MM-DD'),
        'salary', old."salary_source_snapshot",
        'rounding', old."rounding_snapshot",
        'calculation', old."calculation_snapshot"
      ),
      'movedFrom', jsonb_build_object(
        'table', 'payroll_monetization_earning_inputs',
        'status', old."status",
        'sourceVersionKey', old."source_version_key"::text,
        'supersedesInputId', old."supersedes_input_id",
        'createdByMembershipId', old."created_by_membership_id",
        'createdAt', old."created_at"
      )
    ) AS "payload"
  FROM "payroll_monetization_earning_inputs" old
) moved;

UPDATE "payroll_inputs" moved
SET "status" = 'CANCELLED'
FROM "payroll_monetization_earning_inputs" old
WHERE moved."agency_id" = old."agency_id"
  AND moved."id" = old."id"
  AND old."status" IN ('CANCELLED', 'SUPERSEDED');

ALTER TABLE "payroll_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_inputs" FORCE ROW LEVEL SECURITY;

-- Payroll's recorded Monetization Adjustment outcomes stay, now against the
-- moved inputs. Nothing writes them until Monetization Adjustment binds to the
-- inbox (#357), which grants its own writes.
ALTER TABLE "payroll_monetization_adjustment_outcomes"
  DROP CONSTRAINT "payroll_monetization_outcomes_input_fkey",
  DROP CONSTRAINT "payroll_monetization_outcomes_linked_fkey";
ALTER TABLE "payroll_monetization_adjustment_outcomes"
  ADD CONSTRAINT "payroll_monetization_outcomes_input_fkey"
    FOREIGN KEY ("agency_id", "earning_input_id")
    REFERENCES "payroll_inputs"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payroll_monetization_outcomes_linked_fkey"
    FOREIGN KEY ("agency_id", "linked_input_id")
    REFERENCES "payroll_inputs"("agency_id", "id") ON DELETE RESTRICT;
REVOKE INSERT, UPDATE ON TABLE "payroll_monetization_adjustment_outcomes" FROM hris_app;

DROP TABLE "payroll_monetization_earning_inputs";
DROP FUNCTION guard_payroll_monetization_input_mutation();

DO $$
BEGIN
  IF to_regclass('public.payroll_monetization_earning_inputs') IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll Monetization Earning Input table removal verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_monetization_outcomes_input_fkey'
      AND confrelid = 'public.payroll_inputs'::regclass
  ) THEN
    RAISE EXCEPTION 'Payroll Monetization Adjustment Outcome input reference verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'payroll_inputs' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Payroll Input forced RLS verification failed';
  END IF;
END;
$$;
