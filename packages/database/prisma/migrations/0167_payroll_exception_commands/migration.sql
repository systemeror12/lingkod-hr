-- Phase 9 payroll checks and exception commands (#623), as payroll-schema.md
-- §10 has it. The calculation's checks write their exceptions through the
-- grants of migration 0162. This adds the acknowledge and resolve commands:
-- `hris_app` may now change an exception's status, reason, and actor, once,
-- from OPEN, and nothing else. There is no WAIVED status (#328).

-- An OPEN exception has no reason and no actor; an acknowledged or resolved
-- one has both. The IS NOT NULL keeps a NULL reason from passing the check.
ALTER TABLE "payroll_exceptions"
  ADD CONSTRAINT "payroll_exceptions_decision_check"
  CHECK (
    ("status" = 'OPEN' AND "reason" IS NULL AND "resolved_by_membership_id" IS NULL)
    OR ("status" <> 'OPEN' AND "reason" IS NOT NULL AND btrim("reason") <> ''
        AND "resolved_by_membership_id" IS NOT NULL)
  );

-- An exception is decided once, from OPEN, and only on its period's current
-- calculation version, because an earlier version's exceptions are history.
-- A warning is acknowledged while the period is DRAFT or FOR_REVIEW. Any
-- exception is resolved only while the period is DRAFT: resolving records that
-- the cause was fixed before the next calculation, which checks it again, so a
-- resolution never lifts a block on a period that has moved on. The period row
-- is locked FOR SHARE, so a concurrent start of calculation waits.
CREATE OR REPLACE FUNCTION guard_payroll_exception_update()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  period_status text;
  period_version integer;
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'reason' - 'resolved_by_membership_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'reason' - 'resolved_by_membership_id') THEN
    RAISE EXCEPTION 'Only the status, reason, and actor of a Payroll Exception change'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'OPEN' OR NEW."status" NOT IN ('ACKNOWLEDGED', 'RESOLVED') THEN
    RAISE EXCEPTION 'A Payroll Exception is acknowledged or resolved once, from OPEN'
      USING ERRCODE = '55000';
  END IF;

  SELECT p."status", p."calculation_version"
  INTO period_status, period_version
  FROM "payroll_periods" p
  WHERE p."agency_id" = NEW."agency_id"
    AND p."id" = NEW."payroll_period_id"
  FOR SHARE;

  IF period_version IS DISTINCT FROM NEW."calculation_version" THEN
    RAISE EXCEPTION 'A Payroll Exception of an earlier calculation version is history'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'ACKNOWLEDGED' AND period_status NOT IN ('DRAFT', 'FOR_REVIEW') THEN
    RAISE EXCEPTION 'A warning is acknowledged only while its period is DRAFT or FOR_REVIEW'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'RESOLVED' AND period_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'A Payroll Exception is resolved only while its period is DRAFT'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_exceptions_update_trigger"
  BEFORE UPDATE ON "payroll_exceptions"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_exception_update();

GRANT UPDATE ("status", "reason", "resolved_by_membership_id")
  ON TABLE "payroll_exceptions" TO hris_app;

CREATE POLICY "payroll_exceptions_update" ON "payroll_exceptions"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

-- The exception list reads with `payroll.periods.read`.
INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.periods.read', 'payroll', 'MEDIUM',
  'Read Payroll Periods and their Payroll Exceptions'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.periods.read` to the Payroll
-- Preparer, HR Certifier, Budget Officer, Accounting Reviewer, and Payroll
-- Approver, and read-only to the Cashier and Auditor. Only the roles below
-- exist yet; the HR Admin grant is agency-configurable.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.periods.read'
WHERE r."code" IN ('payroll_preparer', 'budget_officer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_exceptions_update_trigger'
  ) THEN
    RAISE EXCEPTION 'Payroll Exception update guard verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'payroll_exceptions' AND policyname = 'payroll_exceptions_update'
  ) THEN
    RAISE EXCEPTION 'Payroll Exception update policy verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; exceptions
-- and their decisions are retained payroll history.
-- Verification: pnpm db:policies payroll_exceptions
