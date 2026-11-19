-- Phase 9 correction of a Payroll Input an open payroll uses (#649), as
-- payroll-schema.md §4 and §10 have it. A source module's withdrawal of a
-- PENDING input that a live calculation uses cancels the input and marks the
-- period with a BLOCKING `PAYROLL_INPUT_WITHDRAWN` exception on its current
-- version (#330 D11 #15). Paying a cancelled leave monetization while Leave
-- restores the credits would pay twice, so the mark blocks at every status a
-- rule version load only flags. Nothing is invalidated: the period is
-- returned and recalculated, and the next version no longer reads the input.

-- The withdrawal writes the mark in the source's transaction, under the
-- Agency's context, so the existing Agency insert policy admits it. This guard
-- admits it only on the current version of a CALCULATING, FOR_REVIEW,
-- CERTIFIED, or APPROVED period, as BLOCKING, naming the Employee of a
-- cancelled input. Other types keep the rules of migration 0170.
CREATE OR REPLACE FUNCTION guard_payroll_exception_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  period_status text;
  period_version integer;
BEGIN
  SELECT p."status", p."calculation_version"
  INTO period_status, period_version
  FROM "payroll_periods" p
  WHERE p."agency_id" = NEW."agency_id"
    AND p."id" = NEW."payroll_period_id";

  IF NEW."exception_type" = 'RULE_VERSION_LOADED_AFTER_SNAPSHOT' THEN
    IF period_version IS DISTINCT FROM NEW."calculation_version"
       OR NEW."employee_id" IS NOT NULL
       OR NOT (
         (period_status IN ('CALCULATING', 'FOR_REVIEW') AND NEW."severity" = 'BLOCKING')
         OR (period_status IN ('CERTIFIED', 'APPROVED') AND NEW."severity" = 'WARNING')
       ) THEN
      RAISE EXCEPTION 'A rule version load marks only the current version of an affected period'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."exception_type" = 'PAYROLL_INPUT_WITHDRAWN' THEN
    IF period_version IS DISTINCT FROM NEW."calculation_version"
       OR NOT COALESCE(period_status IN ('CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'APPROVED'), false)
       OR NEW."severity" <> 'BLOCKING'
       OR NOT EXISTS (
         SELECT 1 FROM "payroll_inputs" i
         WHERE i."agency_id" = NEW."agency_id"
           AND i."id"::text = NEW."details" ->> 'payrollInputId'
           AND i."employee_id" = NEW."employee_id"
           AND i."status" = 'CANCELLED'
       ) THEN
      RAISE EXCEPTION 'A withdrawn Payroll Input blocks only the current version of a live period'
        USING ERRCODE = '55000';
    END IF;
  ELSIF period_status IS DISTINCT FROM 'CALCULATING'
        OR period_version IS DISTINCT FROM NEW."calculation_version" THEN
    RAISE EXCEPTION '% rows are written only by the running calculation of their version', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Certification, approval, and finalization each move the period forward on
-- its current version. None may while that version has an open blocking
-- exception, which no one can waive (#27, #328). The certify command refuses
-- first with its own code; this holds for every command that moves the
-- status, including approval and finalization before their commands exist.
CREATE OR REPLACE FUNCTION guard_payroll_period_blocking_exceptions()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payroll_exceptions" e
    WHERE e."agency_id" = NEW."agency_id"
      AND e."payroll_period_id" = NEW."id"
      AND e."calculation_version" = NEW."calculation_version"
      AND e."severity" = 'BLOCKING'
      AND e."status" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'A Payroll Period cannot become % while calculation version % has an open blocking exception',
      NEW."status", NEW."calculation_version"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_periods_blocking_exception_trigger"
  BEFORE UPDATE ON "payroll_periods"
  FOR EACH ROW
  WHEN (NEW."status" IS DISTINCT FROM OLD."status"
        AND NEW."status" IN ('CERTIFIED', 'APPROVED', 'FINALIZED'))
  EXECUTE FUNCTION guard_payroll_period_blocking_exceptions();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_periods_blocking_exception_trigger'
  ) THEN
    RAISE EXCEPTION 'Payroll input live correction trigger verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; marks are
-- retained payroll history.
-- Verification: pnpm db:policies payroll_exceptions
