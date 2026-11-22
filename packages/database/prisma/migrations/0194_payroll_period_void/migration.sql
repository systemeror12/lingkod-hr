-- Phase 9 void and replace of a finalized payroll (#358), as hris-controls.md
-- §5.20 and payroll-schema.md §5 have them (#330, ADR 0016). One person
-- requests the void of a FINALIZED Payroll Period with a reason and a
-- supporting Document Version; a different person approves or declines it.
-- Migration 0153 already holds the request columns, their CHECKs, and the
-- FINALIZED → VOIDED transition.
--
-- This migration adds the two permissions and the guards that let the void
-- write what it writes, each only in the transaction that voids the period:
-- results become VOIDED, consumed Payroll Inputs return to PENDING (or become
-- CANCELLED when a source correction was waiting on them), consumed
-- Attendance Payroll Facts are released, Payslips become SUPERSEDED, open
-- Payroll Adjustments against the period are cancelled, and those it posted
-- reopen. Each guard checks that the period row was voided by the current
-- transaction (`xmin`), as migration 0184 does for finalization.

-- A void request and its decline change only the request columns, while the
-- period stays FINALIZED. The approval keeps the open request as it was. A
-- DRAFT is cancelled with no request.
CREATE OR REPLACE FUNCTION guard_payroll_period_void()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  request_before JSONB := jsonb_build_array(
    OLD."void_requested_by_membership_id", OLD."void_requested_at",
    OLD."void_reason", OLD."void_document_version_id"
  );
  request_after JSONB := jsonb_build_array(
    NEW."void_requested_by_membership_id", NEW."void_requested_at",
    NEW."void_reason", NEW."void_document_version_id"
  );
BEGIN
  IF NEW."status" <> 'VOIDED' AND NEW."voided_by_membership_id" IS NOT NULL THEN
    RAISE EXCEPTION 'A Payroll Period names who voided it only as it is voided'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'FINALIZED' AND NEW."status" = 'VOIDED' THEN
    IF OLD."void_requested_at" IS NULL OR request_after IS DISTINCT FROM request_before THEN
      RAISE EXCEPTION 'A finalized Payroll Period is voided only by approving its open void request'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD."status" = 'DRAFT' AND NEW."status" = 'VOIDED' THEN
    IF NEW."void_requested_at" IS NOT NULL OR NEW."void_document_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'A DRAFT Payroll Period is cancelled without a void request'
        USING ERRCODE = '55000';
    END IF;
  ELSIF request_after IS DISTINCT FROM request_before THEN
    IF OLD."status" <> 'FINALIZED' OR NEW."status" <> 'FINALIZED' OR NOT (
      (OLD."void_requested_at" IS NULL
       AND NEW."void_requested_at" IS NOT NULL
       AND NEW."void_document_version_id" IS NOT NULL
       AND COALESCE(btrim(NEW."void_reason"), '') <> '')
      OR (OLD."void_requested_at" IS NOT NULL
          AND request_after = '[null, null, null, null]'::jsonb)
    ) THEN
      RAISE EXCEPTION 'A void is requested, with a reason and a Document Version, or declined, only while the Payroll Period is FINALIZED'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_periods_void_trigger"
  BEFORE UPDATE ON "payroll_periods"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_period_void();

-- The guard of 0184. A result's one other change is FINALIZED → VOIDED, in
-- the transaction that voids its period.
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
  IF OLD."status" = 'FINALIZED' AND NEW."status" = 'VOIDED' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "payroll_periods" p
      WHERE p."agency_id" = NEW."agency_id"
        AND p."id" = NEW."payroll_period_id"
        AND p."status" = 'VOIDED'
        AND p."xmin" = pg_current_xact_id()::xid
    ) THEN
      RAISE EXCEPTION 'A FINALIZED Payroll Employee Result is voided only with its period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
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

-- The guard of 0166, which already admits CONSUMED → PENDING, now also admits
-- CONSUMED → CANCELLED. The release trigger below holds both to the void.
CREATE OR REPLACE FUNCTION guard_payroll_input_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Inputs are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'A Payroll Input is accepted as PENDING'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'consumed_by_payroll_period_id' - 'source_correction_key')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'consumed_by_payroll_period_id' - 'source_correction_key') THEN
    RAISE EXCEPTION 'An accepted Payroll Input changes only its status and consuming period'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('CONSUMED', 'CANCELLED'))
    OR (OLD."status" = 'CONSUMED' AND NEW."status" IN ('PENDING', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'A Payroll Input cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

-- A consumed input leaves CONSUMED only in the transaction that voids the
-- period that consumed it. It returns to PENDING, or becomes CANCELLED under
-- the correction key of a source correction that was waiting on it in a
-- Payroll Adjustment against that period.
CREATE OR REPLACE FUNCTION guard_payroll_input_release()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = OLD."agency_id"
      AND p."id" = OLD."consumed_by_payroll_period_id"
      AND p."status" = 'VOIDED'
      AND p."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A consumed Payroll Input is released only by the void of the payroll that consumed it'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'CANCELLED' AND NOT EXISTS (
    SELECT 1
    FROM "payroll_adjustment_causes" c
    JOIN "payroll_adjustments" a
      ON a."agency_id" = c."agency_id" AND a."id" = c."payroll_adjustment_id"
    WHERE c."agency_id" = NEW."agency_id"
      AND c."origin" = 'SOURCE_CORRECTION'
      AND c."payroll_input_id" = NEW."id"
      AND c."source_correction_key" = NEW."source_correction_key"
      AND a."original_payroll_period_id" = OLD."consumed_by_payroll_period_id"
  ) THEN
    RAISE EXCEPTION 'A voided payroll cancels a consumed Payroll Input only for the source correction waiting on it'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_inputs_release_trigger"
  BEFORE UPDATE ON "payroll_inputs"
  FOR EACH ROW
  WHEN (OLD."status" = 'CONSUMED' AND NEW."status" IS DISTINCT FROM 'CONSUMED')
  EXECUTE FUNCTION guard_payroll_input_release();

-- A consumption is released once, in the transaction that voids its period,
-- by setting `released_at`; it is never otherwise changed or deleted.
CREATE OR REPLACE FUNCTION guard_payroll_consumed_attendance_fact_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Consumed Attendance Payroll Facts are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'released_at') IS DISTINCT FROM (to_jsonb(OLD) - 'released_at')
     OR OLD."released_at" IS NOT NULL
     OR NEW."released_at" IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM "payroll_periods" p
       WHERE p."agency_id" = NEW."agency_id"
         AND p."id" = NEW."payroll_period_id"
         AND p."status" = 'VOIDED'
         AND p."xmin" = pg_current_xact_id()::xid
     ) THEN
    RAISE EXCEPTION 'A consumed Attendance Payroll Fact is released once, only by the void of its payroll'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "payroll_consumed_attendance_facts_immutable_trigger"
  ON "payroll_consumed_attendance_facts";
CREATE TRIGGER "payroll_consumed_attendance_facts_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_consumed_attendance_facts"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_consumed_attendance_fact_mutation();

GRANT UPDATE ("released_at") ON TABLE "payroll_consumed_attendance_facts" TO hris_app;
CREATE POLICY "payroll_consumed_attendance_facts_update" ON "payroll_consumed_attendance_facts"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

-- The guard of 0191, with supersession: a Payslip in any other status becomes
-- SUPERSEDED, changing nothing else, in the transaction that voids its period.
CREATE OR REPLACE FUNCTION guard_payslip_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  changed JSONB;
  actor UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payslips are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'GENERATING'
       OR NEW."document_id" IS NOT NULL
       OR NEW."released_at" IS NOT NULL
       OR NEW."withheld_at" IS NOT NULL
       OR NEW."withhold_reason" IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM "payroll_employees" r
         WHERE r."agency_id" = NEW."agency_id"
           AND r."id" = NEW."payroll_employee_id"
           AND r."status" = 'FINALIZED'
       ) THEN
      RAISE EXCEPTION 'A Payslip is generated, GENERATING, only for a FINALIZED Payroll Employee Result'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  -- The keys whose values the update changed.
  SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key COLLATE "C"), '[]'::jsonb)
  INTO changed
  FROM jsonb_each(to_jsonb(NEW)) n
  JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;

  IF OLD."status" <> 'SUPERSEDED' AND NEW."status" = 'SUPERSEDED' THEN
    IF changed <> '["status"]'::jsonb OR NOT EXISTS (
      SELECT 1
      FROM "payroll_employees" r
      JOIN "payroll_periods" p
        ON p."agency_id" = r."agency_id" AND p."id" = r."payroll_period_id"
      WHERE r."agency_id" = NEW."agency_id"
        AND r."id" = NEW."payroll_employee_id"
        AND p."status" = 'VOIDED'
        AND p."xmin" = pg_current_xact_id()::xid
    ) THEN
      RAISE EXCEPTION 'A Payslip is superseded, changing nothing else, only by the void of its payroll'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'GENERATING' AND NEW."status" = 'READY' THEN
    IF changed <> '["document_id", "status"]'::jsonb OR NEW."document_id" IS NULL THEN
      RAISE EXCEPTION 'A Payslip becomes READY only by naming its Document once'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('READY', 'WITHHELD') AND NEW."status" = 'RELEASED' THEN
    IF changed <> '["released_at", "released_by_membership_id", "status"]'::jsonb THEN
      RAISE EXCEPTION 'Releasing a Payslip records only who released it and when'
        USING ERRCODE = '55000';
    END IF;
    actor := NEW."released_by_membership_id";
  ELSIF OLD."status" = 'READY' AND NEW."status" = 'WITHHELD' THEN
    IF changed <> '["status", "withheld_at", "withheld_by_membership_id", "withhold_reason"]'::jsonb THEN
      RAISE EXCEPTION 'Withholding a Payslip records only who withheld it, when, and why'
        USING ERRCODE = '55000';
    END IF;
    actor := NEW."withheld_by_membership_id";
  ELSE
    RAISE EXCEPTION 'A Payslip changes only GENERATING → READY, READY → RELEASED or WITHHELD, WITHHELD → RELEASED, and to SUPERSEDED when its payroll is voided'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_employees" r
    JOIN "payroll_periods" p
      ON p."agency_id" = r."agency_id" AND p."id" = r."payroll_period_id"
    JOIN "payroll_period_actors" a
      ON a."payroll_period_id" = p."id"
     AND a."membership_id" = actor
     AND a."payroll_function" = 'APPROVAL'
    WHERE r."agency_id" = NEW."agency_id"
      AND r."id" = NEW."payroll_employee_id"
      AND p."status" = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'A Payslip is released or withheld only on a FINALIZED period, by a person acting in its APPROVAL function'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- The guard of 0190, with the void's changes. An OPEN adjustment against the
-- voided period is CANCELLED. A POSTED one the voided period carried reopens,
-- or is CANCELLED when its Employee already has an OPEN adjustment against the
-- same original, whose recalculation then counts the whole difference.
CREATE OR REPLACE FUNCTION guard_payroll_adjustment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Adjustments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'A Payroll Adjustment opens OPEN' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "payroll_periods" p
      WHERE p."agency_id" = NEW."agency_id"
        AND p."id" = NEW."original_payroll_period_id"
        AND p."status" = 'FINALIZED'
    ) THEN
      RAISE EXCEPTION 'A Payroll Adjustment opens only against a FINALIZED Payroll Period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'posted_by_payroll_period_id' - 'posted_at' - 'cancelled_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'posted_by_payroll_period_id' - 'posted_at' - 'cancelled_at') THEN
    RAISE EXCEPTION 'Only the status of a Payroll Adjustment changes' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'OPEN' AND NEW."status" = 'POSTED' THEN
    IF NEW."posted_by_payroll_period_id" = NEW."original_payroll_period_id" OR NOT EXISTS (
      SELECT 1 FROM "payroll_periods" p
      WHERE p."agency_id" = NEW."agency_id"
        AND p."id" = NEW."posted_by_payroll_period_id"
        AND p."status" = 'FINALIZED'
        AND p."xmin" = pg_current_xact_id()::xid
    ) THEN
      RAISE EXCEPTION 'A Payroll Adjustment is posted only by the finalization of a later period carrying it'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD."status" = 'OPEN' AND NEW."status" = 'CANCELLED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "payroll_periods" p
      WHERE p."agency_id" = NEW."agency_id"
        AND p."id" = NEW."original_payroll_period_id"
        AND p."status" = 'VOIDED'
        AND p."xmin" = pg_current_xact_id()::xid
    ) THEN
      RAISE EXCEPTION 'An OPEN Payroll Adjustment is cancelled only by the void of its original period'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD."status" = 'POSTED' AND NEW."status" IN ('OPEN', 'CANCELLED') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "payroll_periods" p
      WHERE p."agency_id" = OLD."agency_id"
        AND p."id" = OLD."posted_by_payroll_period_id"
        AND p."status" = 'VOIDED'
        AND p."xmin" = pg_current_xact_id()::xid
    ) THEN
      RAISE EXCEPTION 'A POSTED Payroll Adjustment changes only by the void of the period that posted it'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'A Payroll Adjustment cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT UPDATE ("cancelled_at") ON TABLE "payroll_adjustments" TO hris_app;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  (
    'payroll.periods.void', 'payroll', 'HIGH',
    'Request the void of a FINALIZED Payroll Period no money has moved on, with a reason and a supporting Document Version'
  ),
  (
    'payroll.periods.approve_void', 'payroll', 'HIGH',
    'Approve or decline another person''s void request of a FINALIZED Payroll Period'
  )
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks both A for the Payroll Approver. The Accounting
-- Reviewer's C on `payroll.periods.void` is agency-configurable and not seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('payroll.periods.void', 'payroll.periods.approve_void')
WHERE r."code" = 'payroll_approver'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'payroll_approver' AND rp."scope_policy" = 'AGENCY'
      AND p."code" IN ('payroll.periods.void', 'payroll.periods.approve_void')
  ) <> 2 THEN
    RAISE EXCEPTION 'Payroll void permission grant verification failed';
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
    WHERE tgname IN ('payroll_periods_void_trigger', 'payroll_inputs_release_trigger',
                     'payroll_consumed_attendance_facts_mutation_trigger')
  ) <> 3 OR EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_consumed_attendance_facts_immutable_trigger'
  ) THEN
    RAISE EXCEPTION 'Payroll void guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; a voided
-- payroll, its results, superseded Payslips, released consumptions, and
-- cancelled adjustments are retained payroll history.
-- Verification: pnpm db:policies payroll_periods; pnpm db:policies
-- payroll_consumed_attendance_facts; pnpm db:policies payroll_adjustments
