-- Phase 9 recalculation (#624), as payroll-schema.md §5, §6, and §10 have it.
-- A National Payroll Rule Version loaded after a calculation's rule snapshot
-- never recalculates a period silently (#328 D6 #13). Loading one marks every
-- period it affects, by status:
--
--   CALCULATING, FOR_REVIEW  a BLOCKING exception, so the running or queued
--                            calculation returns to DRAFT and certification is
--                            refused until the period is calculated again;
--   CERTIFIED, APPROVED      a WARNING: the snapshot stands and the period is
--                            flagged;
--   DRAFT                    nothing: the next calculation's snapshot uses it;
--   FINALIZED, VOIDED        nothing: a Payroll Adjustment corrects a
--                            finalized payroll.
--
-- A period is affected when the version is in effect on any date of it. A new
-- version is in no snapshot yet, so the dates alone decide.

-- The marking runs as the table owner, across Agencies, a deliberate
-- exception to Agency isolation like payroll_calculations_due. These policies
-- expose only the periods a load can affect, admit only row locks on them
-- (FOR UPDATE needs an UPDATE policy; WITH CHECK refuses every real update),
-- and admit only this exception type.
CREATE POLICY "payroll_periods_rule_load_select" ON "payroll_periods"
  FOR SELECT TO CURRENT_USER
  USING ("status" IN ('CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'APPROVED'));

CREATE POLICY "payroll_periods_rule_load_lock" ON "payroll_periods"
  FOR UPDATE TO CURRENT_USER
  USING ("status" IN ('CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'APPROVED'))
  WITH CHECK (false);

CREATE POLICY "payroll_exceptions_rule_load_insert" ON "payroll_exceptions"
  FOR INSERT TO CURRENT_USER
  WITH CHECK ("exception_type" = 'RULE_VERSION_LOADED_AFTER_SNAPSHOT');

-- Only the load writes this type; the calculation never does.
DROP POLICY "payroll_exceptions_insert" ON "payroll_exceptions";
CREATE POLICY "payroll_exceptions_insert" ON "payroll_exceptions"
  FOR INSERT WITH CHECK (
    "agency_id" = app_agency_id()
    AND "exception_type" <> 'RULE_VERSION_LOADED_AFTER_SNAPSHOT'
  );

-- An exception joins the running calculation of its version, as before
-- (migration 0162). A load's mark joins the period's current version while it
-- is past DRAFT and not yet FINALIZED, names no Employee, and blocks exactly
-- until certification.
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
  ELSIF period_status IS DISTINCT FROM 'CALCULATING'
        OR period_version IS DISTINCT FROM NEW."calculation_version" THEN
    RAISE EXCEPTION '% rows are written only by the running calculation of their version', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "payroll_exceptions_insert_trigger" ON "payroll_exceptions";
CREATE TRIGGER "payroll_exceptions_insert_trigger"
  BEFORE INSERT ON "payroll_exceptions"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_exception_insert();

-- The load and a snapshot serialize on one advisory lock: a calculation start
-- holds it shared while it freezes its snapshot (payroll-rule-snapshots.ts),
-- and a load takes it exclusively. A snapshot frozen before the load commits
-- is on a period the load then sees; one frozen after references the version.
-- Locking each affected period waits out a running calculation, so the mark
-- lands on what it committed: FOR_REVIEW is marked, and DRAFT drops out.
CREATE OR REPLACE FUNCTION mark_payroll_periods_for_rule_version()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  period record;
  severity text;
  message text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_rule_snapshots', 0));
  FOR period IN
    SELECT p."agency_id", p."id", p."status", p."calculation_version"
    FROM "payroll_periods" p
    WHERE p."status" IN ('CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'APPROVED')
      AND p."period_from" <= COALESCE(NEW."effective_to", 'infinity'::date)
      AND p."period_to" >= NEW."effective_from"
    ORDER BY p."id"
    FOR UPDATE
  LOOP
    IF period."status" IN ('CERTIFIED', 'APPROVED') THEN
      severity := 'WARNING';
      message := format(
        '%s %s was loaded after this calculation''s rule snapshot and is in effect in the period. The %s snapshot stands; return the period or correct it later.',
        NEW."rule_kind", NEW."code", lower(period."status")
      );
    ELSE
      severity := 'BLOCKING';
      message := format(
        '%s %s was loaded after this calculation''s rule snapshot and is in effect in the period. Certification is refused until the period is calculated again.',
        NEW."rule_kind", NEW."code"
      );
    END IF;
    INSERT INTO "payroll_exceptions" (
      "agency_id", "payroll_period_id", "calculation_version", "employee_id",
      "exception_type", "severity", "status", "details"
    )
    VALUES (
      period."agency_id", period."id", period."calculation_version", NULL,
      'RULE_VERSION_LOADED_AFTER_SNAPSHOT', severity, 'OPEN',
      jsonb_build_object(
        'message', message,
        'nationalPayrollRuleVersionId', NEW."id",
        'ruleKind', NEW."rule_kind",
        'code', NEW."code",
        'effectiveFrom', NEW."effective_from",
        'effectiveTo', NEW."effective_to"
      )
    );
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION mark_payroll_periods_for_rule_version() FROM PUBLIC;

CREATE TRIGGER "national_payroll_rule_versions_mark_periods_trigger"
  AFTER INSERT ON "national_payroll_rule_versions"
  FOR EACH ROW EXECUTE FUNCTION mark_payroll_periods_for_rule_version();

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_exceptions_insert_trigger',
                     'national_payroll_rule_versions_mark_periods_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Payroll recalculation trigger verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; marks are
-- retained payroll history.
-- Verification: pnpm db:policies payroll_exceptions
