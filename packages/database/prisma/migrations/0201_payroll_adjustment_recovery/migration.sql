-- Phase 9 recovery of a negative Payroll Adjustment (#648, ADR 0017), as
-- payroll-schema.md §9 and §10 have it. A negative adjustment is recovered
-- only under a final and executory COA decision (FY 2026 GAA sec. 62 item (b);
-- salary-overpayment-recovery-authorities.md R6, R8). A user with
-- `payroll.deductions.manage` records that decision as a Deduction Obligation
-- payable to NATIONAL_GOVERNMENT_COA_DECISION that names the adjustment, and
-- the same transaction posts the adjustment. From then on the obligation
-- carries the balance, which the #634 calculation applies by priority and
-- floor.
--
-- The obligation also names the PAYROLL_ADJUSTMENT_NEGATIVE warning its
-- balance comes from: the recorder does not enter the balance, Payroll's
-- calculation found it.

-- §10: the obligation's foreign key keeps its Employee the adjustment's.
ALTER TABLE "payroll_adjustments"
  ADD CONSTRAINT "payroll_adjustments_agency_id_id_employee_id_key"
    UNIQUE ("agency_id", "id", "employee_id");

-- §10: an adjustment a recovery posts has no posting period, because no
-- period's lines carry it.
ALTER TABLE "payroll_adjustments"
  DROP CONSTRAINT "payroll_adjustments_posted_by_check";
ALTER TABLE "payroll_adjustments"
  ADD CONSTRAINT "payroll_adjustments_posted_by_check"
    CHECK ("posted_by_payroll_period_id" IS NULL OR "status" = 'POSTED');

-- §9: the adjustment an obligation recovers, and the warning its balance is.
ALTER TABLE "deduction_obligations"
  ADD COLUMN "payroll_adjustment_id" UUID,
  ADD COLUMN "payroll_exception_id" UUID,
  ADD CONSTRAINT "deduction_obligations_recovery_check"
    CHECK (
      ("payroll_adjustment_id" IS NULL) = ("payroll_exception_id" IS NULL)
      AND ("payroll_adjustment_id" IS NULL
           OR "payee_category" = 'NATIONAL_GOVERNMENT_COA_DECISION')
    ),
  ADD CONSTRAINT "deduction_obligations_payroll_adjustment_fkey"
    FOREIGN KEY ("agency_id", "payroll_adjustment_id", "employee_id")
    REFERENCES "payroll_adjustments"("agency_id", "id", "employee_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "deduction_obligations_payroll_exception_fkey"
    FOREIGN KEY ("agency_id", "payroll_exception_id")
    REFERENCES "payroll_exceptions"("agency_id", "id") ON DELETE RESTRICT;

-- One obligation per adjustment: its first version names it, and each change
-- is a successor in the same chain.
CREATE UNIQUE INDEX "deduction_obligations_one_per_adjustment_key"
  ON "deduction_obligations" ("payroll_adjustment_id")
  WHERE "payroll_adjustment_id" IS NOT NULL AND "supersedes_obligation_id" IS NULL;

-- A first version that names an adjustment locks it and needs it OPEN, and
-- rests on a PAYROLL_ADJUSTMENT_NEGATIVE warning naming it and its Employee,
-- from the current calculation version of its period; the balance is that
-- warning's negative net difference. A successor keeps its predecessor's
-- adjustment and warning. The mutation guard of migration 0158 already keeps
-- both columns fixed after insert.
CREATE OR REPLACE FUNCTION guard_deduction_obligation_recovery()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  predecessor record;
  adjustment record;
BEGIN
  IF NEW."supersedes_obligation_id" IS NOT NULL THEN
    SELECT o."payroll_adjustment_id", o."payroll_exception_id"
    INTO predecessor
    FROM "deduction_obligations" o
    WHERE o."agency_id" = NEW."agency_id" AND o."id" = NEW."supersedes_obligation_id";
    IF (predecessor."payroll_adjustment_id", predecessor."payroll_exception_id")
       IS DISTINCT FROM (NEW."payroll_adjustment_id", NEW."payroll_exception_id") THEN
      RAISE EXCEPTION 'A changed Deduction Obligation keeps the Payroll Adjustment it recovers'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."payroll_adjustment_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a."status"
  INTO adjustment
  FROM "payroll_adjustments" a
  WHERE a."agency_id" = NEW."agency_id" AND a."id" = NEW."payroll_adjustment_id"
  FOR UPDATE;
  IF adjustment."status" IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'A recovery is recorded only for an OPEN Payroll Adjustment'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_exceptions" x
    JOIN "payroll_periods" p
      ON p."agency_id" = x."agency_id" AND p."id" = x."payroll_period_id"
     AND p."calculation_version" = x."calculation_version"
    WHERE x."agency_id" = NEW."agency_id"
      AND x."id" = NEW."payroll_exception_id"
      AND x."exception_type" = 'PAYROLL_ADJUSTMENT_NEGATIVE'
      AND x."employee_id" = NEW."employee_id"
      AND x."details" ->> 'payrollAdjustmentId' = NEW."payroll_adjustment_id"::text
      AND NEW."outstanding_balance" = -((x."details" ->> 'netDifference')::numeric)
  ) THEN
    RAISE EXCEPTION 'A recovery''s balance is the negative difference a current calculation found for its Payroll Adjustment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "deduction_obligations_recovery_trigger"
  BEFORE INSERT ON "deduction_obligations"
  FOR EACH ROW EXECUTE FUNCTION guard_deduction_obligation_recovery();

-- §10: OPEN -> POSTED with no posting period is the recovery's posting. It
-- changes only the status and `posted_at`, in the transaction that records
-- the first version of the obligation naming the adjustment. Every other
-- change still goes through guard_payroll_adjustment_mutation (migration
-- 0190), which this migration leaves as it is: the trigger is split so the
-- recovery case never reaches it.
CREATE OR REPLACE FUNCTION guard_payroll_adjustment_recovery_posting()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'posted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'posted_at') THEN
    RAISE EXCEPTION 'Only the status of a Payroll Adjustment changes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "deduction_obligations" o
    WHERE o."agency_id" = NEW."agency_id"
      AND o."payroll_adjustment_id" = NEW."id"
      AND o."supersedes_obligation_id" IS NULL
      AND o."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Payroll Adjustment is posted with no period only as the COA obligation that recovers it is recorded'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "payroll_adjustments_mutation_trigger" ON "payroll_adjustments";

CREATE TRIGGER "payroll_adjustments_mutation_trigger"
  BEFORE INSERT OR DELETE ON "payroll_adjustments"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_adjustment_mutation();

CREATE TRIGGER "payroll_adjustments_update_trigger"
  BEFORE UPDATE ON "payroll_adjustments"
  FOR EACH ROW
  WHEN (NOT (OLD."status" = 'OPEN' AND NEW."status" = 'POSTED'
             AND NEW."posted_by_payroll_period_id" IS NULL))
  EXECUTE FUNCTION guard_payroll_adjustment_mutation();

CREATE TRIGGER "payroll_adjustments_recovery_trigger"
  BEFORE UPDATE ON "payroll_adjustments"
  FOR EACH ROW
  WHEN (OLD."status" = 'OPEN' AND NEW."status" = 'POSTED'
        AND NEW."posted_by_payroll_period_id" IS NULL)
  EXECUTE FUNCTION guard_payroll_adjustment_recovery_posting();

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_adjustments_mutation_trigger', 'payroll_adjustments_update_trigger',
                     'payroll_adjustments_recovery_trigger', 'deduction_obligations_recovery_trigger')
  ) <> 4 THEN
    RAISE EXCEPTION 'Payroll Adjustment recovery guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; a recovery,
-- its obligation versions, and the adjustment it posted are retained payroll
-- history.
-- Verification: pnpm db:policies deduction_obligations; pnpm db:policies
-- payroll_adjustments
