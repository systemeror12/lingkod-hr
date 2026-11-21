-- Phase 9 payroll finalization (#335), as payroll-schema.md §11 has it. The
-- Payroll Approver finalizes an APPROVED Payroll Period in one transaction:
-- the period and its approved version's Payroll Employee Results become
-- FINALIZED, and the Payroll Inputs and Attendance Payroll Facts that
-- version's lines rest on are consumed. Migration 0153's guard already allows
-- APPROVED → FINALIZED, and migration 0181 refuses it while the version has an
-- open blocking exception. Lines, line sources, tax, contribution, and loan
-- lines, and rule snapshots already reject every UPDATE and DELETE.
--
-- This migration adds what finalization writes: the permission, `status`
-- UPDATE on results, INSERT on consumed attendance facts, an outbox owner, and
-- the guards that let each of those happen only in the finalizing transaction.

-- A period's finalization time is set as it becomes FINALIZED and never moves.
CREATE OR REPLACE FUNCTION guard_payroll_period_finalized_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF OLD."status" = 'APPROVED' AND NEW."status" = 'FINALIZED' THEN
    IF NEW."finalized_at" IS NULL THEN
      RAISE EXCEPTION 'A Payroll Period records when it is finalized'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."finalized_at" IS DISTINCT FROM OLD."finalized_at" THEN
    RAISE EXCEPTION 'A Payroll Period is given its finalization time only as it is finalized'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_periods_finalized_at_trigger"
  BEFORE UPDATE ON "payroll_periods"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_period_finalized_at();

-- Results are append-only and only `status` changes (migration 0162). The one
-- change admitted is to FINALIZED, in the transaction that finalizes the
-- result's period at the result's version, so a FINALIZED or VOIDED result
-- never changes. The void command admits FINALIZED → VOIDED with its period.
CREATE OR REPLACE FUNCTION guard_payroll_employee_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Employee Results are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Only the status of a Payroll Employee Result changes'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('FINALIZED', 'VOIDED') THEN
    RAISE EXCEPTION 'A % Payroll Employee Result is immutable', OLD."status"
      USING ERRCODE = '55000';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND (NEW."status" <> 'FINALIZED' OR NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."status" = 'FINALIZED'
      AND p."calculation_version" = NEW."calculation_version"
      AND p."xmin" = pg_current_xact_id()::xid
  )) THEN
    RAISE EXCEPTION 'A Payroll Employee Result changes status only as it is finalized with its period, at its version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- A Payroll Input is consumed only by the transaction that finalizes the
-- period it names. Migration 0166's guard keeps the other columns fixed.
CREATE OR REPLACE FUNCTION guard_payroll_input_consumption()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."consumed_by_payroll_period_id"
      AND p."status" = 'FINALIZED'
      AND p."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Payroll Input is consumed only by the finalization of its period'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_inputs_consumption_trigger"
  BEFORE UPDATE ON "payroll_inputs"
  FOR EACH ROW
  WHEN (NEW."status" = 'CONSUMED' AND OLD."status" IS DISTINCT FROM 'CONSUMED')
  EXECUTE FUNCTION guard_payroll_input_consumption();

-- An Attendance Payroll Fact is consumed only by the transaction that
-- finalizes the period, and a consumption is never changed or deleted until
-- the void ticket releases it. The live UNIQUE index of migration 0164
-- refuses a second live consumption of one fact.
CREATE OR REPLACE FUNCTION guard_payroll_consumed_attendance_fact_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NEW."released_at" IS NOT NULL OR NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."status" = 'FINALIZED'
      AND p."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'An Attendance Payroll Fact is consumed only by the finalization of its period'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_consumed_attendance_facts_insert_trigger"
  BEFORE INSERT ON "payroll_consumed_attendance_facts"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_consumed_attendance_fact_insert();

CREATE TRIGGER "payroll_consumed_attendance_facts_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_consumed_attendance_facts"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- Payroll finalization joins the owners that may append Outbox Events.
CREATE OR REPLACE FUNCTION guard_outbox_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.leave_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.leave_posting_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.payroll_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Outbox Events require an owning application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT UPDATE ("status") ON TABLE "payroll_employees" TO hris_app;
CREATE POLICY "payroll_employees_update" ON "payroll_employees"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

GRANT INSERT ON TABLE "payroll_consumed_attendance_facts" TO hris_app;
CREATE POLICY "payroll_consumed_attendance_facts_insert" ON "payroll_consumed_attendance_facts"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.periods.finalize', 'payroll', 'HIGH',
  'Finalize an APPROVED Payroll Period, consuming its sources and making its results immutable'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks `payroll.periods.finalize` A for the Payroll Approver alone.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.periods.finalize'
WHERE r."code" = 'payroll_approver'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'payroll_approver' AND p."code" = 'payroll.periods.finalize'
  ) THEN
    RAISE EXCEPTION 'Payroll finalization permission grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_periods_finalized_at_trigger', 'payroll_inputs_consumption_trigger',
                     'payroll_consumed_attendance_facts_insert_trigger',
                     'payroll_consumed_attendance_facts_immutable_trigger')
  ) <> 4 THEN
    RAISE EXCEPTION 'Payroll finalization guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; finalized
-- results and consumed sources are retained payroll history.
-- Verification: pnpm db:policies payroll_employees; pnpm db:policies
-- payroll_consumed_attendance_facts
