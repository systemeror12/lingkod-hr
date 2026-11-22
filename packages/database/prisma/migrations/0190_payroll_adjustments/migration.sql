-- Phase 9 Payroll Adjustments (#356), as payroll-schema.md §7, §8, §10, and
-- §11 have them (#330, ADR 0016). A Payroll Adjustment is Payroll's
-- recalculation of one Employee's result for one FINALIZED Payroll Period. It
-- holds no amount: the period that carries it writes the line-by-line
-- difference as Payroll Lines linked to it, and that period's finalization
-- posts it. An Employee and past period have at most one OPEN adjustment, and
-- a later cause joins it, so a difference is counted once.
--
-- This migration adds the `RECALCULATION` cause, which a user with
-- `payroll.inputs.adjust` writes, and the `PAYROLL_HOLD` cause, which the
-- finalization of a period with an active Payroll Hold writes. It also adds
-- `payroll_holds`, which the cause references; the command that places and
-- lifts a hold is not built yet, so `hris_app` may only read holds.
-- `SOURCE_CORRECTION` (#650), cancelling on void (#358), and carrying a
-- negative difference (#648) come later.

-- §7: a Payroll Hold leaves one Employee with a blocking exception out of a
-- DRAFT period.
CREATE TABLE "payroll_holds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "payroll_exception_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "placed_by_membership_id" UUID NOT NULL,
  "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "lifted_by_membership_id" UUID,
  "lifted_at" TIMESTAMPTZ(6),

  CONSTRAINT "payroll_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_holds_reason_check" CHECK (btrim("reason") <> ''),
  CONSTRAINT "payroll_holds_lifted_check"
    CHECK (("lifted_at" IS NULL) = ("lifted_by_membership_id" IS NULL)),
  CONSTRAINT "payroll_holds_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_holds_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_holds_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_holds_exception_fkey"
    FOREIGN KEY ("agency_id", "payroll_exception_id")
    REFERENCES "payroll_exceptions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_holds_placed_by_fkey"
    FOREIGN KEY ("agency_id", "placed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_holds_lifted_by_fkey"
    FOREIGN KEY ("agency_id", "lifted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_holds_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "payroll_holds_one_active_key"
  ON "payroll_holds" ("payroll_period_id", "employee_id")
  WHERE "lifted_at" IS NULL;

-- A hold is placed only while its period is DRAFT, against a BLOCKING
-- exception of that period naming its Employee, and only lifted after, in
-- DRAFT, once. It is never deleted.
CREATE OR REPLACE FUNCTION guard_payroll_hold_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Holds are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."status" = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'A Payroll Hold is placed or lifted only while its period is DRAFT'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."lifted_at" IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM "payroll_exceptions" x
      WHERE x."agency_id" = NEW."agency_id"
        AND x."id" = NEW."payroll_exception_id"
        AND x."payroll_period_id" = NEW."payroll_period_id"
        AND x."employee_id" = NEW."employee_id"
        AND x."severity" = 'BLOCKING'
    ) THEN
      RAISE EXCEPTION 'A Payroll Hold rests on a blocking exception of its period naming its Employee'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD."lifted_at" IS NOT NULL
     OR (to_jsonb(NEW) - 'lifted_at' - 'lifted_by_membership_id')
        IS DISTINCT FROM (to_jsonb(OLD) - 'lifted_at' - 'lifted_by_membership_id') THEN
    RAISE EXCEPTION 'A Payroll Hold changes only as it is lifted, once'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_holds_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_holds"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_hold_mutation();

-- §10: one adjustment per Employee and past period while it is OPEN.
CREATE TABLE "payroll_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "original_payroll_period_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "posted_by_payroll_period_id" UUID,
  "posted_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),

  CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_adjustments_status_check"
    CHECK ("status" IN ('OPEN', 'POSTED', 'CANCELLED')),
  CONSTRAINT "payroll_adjustments_posted_by_check"
    CHECK (("status" = 'POSTED') = ("posted_by_payroll_period_id" IS NOT NULL)),
  CONSTRAINT "payroll_adjustments_posted_at_check"
    CHECK (("status" = 'POSTED') = ("posted_at" IS NOT NULL)),
  CONSTRAINT "payroll_adjustments_cancelled_at_check"
    CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)),
  CONSTRAINT "payroll_adjustments_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustments_original_period_fkey"
    FOREIGN KEY ("agency_id", "original_payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustments_posted_by_period_fkey"
    FOREIGN KEY ("agency_id", "posted_by_payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustments_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustments_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "payroll_adjustments_one_open_key"
  ON "payroll_adjustments" ("original_payroll_period_id", "employee_id")
  WHERE "status" = 'OPEN';
CREATE INDEX "payroll_adjustments_open_idx"
  ON "payroll_adjustments" ("agency_id", "status");

-- An adjustment opens OPEN, only against a FINALIZED period. Only its status
-- and posting columns change, once, from OPEN: to POSTED in the transaction
-- that finalizes the later period carrying it. Cancelling arrives with the
-- void (#358). It is never deleted.
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
  IF (to_jsonb(NEW) - 'status' - 'posted_by_payroll_period_id' - 'posted_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'posted_by_payroll_period_id' - 'posted_at') THEN
    RAISE EXCEPTION 'Only the status of a Payroll Adjustment changes' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'A % Payroll Adjustment is immutable', OLD."status" USING ERRCODE = '55000';
  END IF;
  IF NEW."status" <> 'POSTED'
     OR NEW."posted_by_payroll_period_id" = NEW."original_payroll_period_id"
     OR NOT EXISTS (
       SELECT 1 FROM "payroll_periods" p
       WHERE p."agency_id" = NEW."agency_id"
         AND p."id" = NEW."posted_by_payroll_period_id"
         AND p."status" = 'FINALIZED'
         AND p."xmin" = pg_current_xact_id()::xid
     ) THEN
    RAISE EXCEPTION 'A Payroll Adjustment is posted only by the finalization of a later period carrying it'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_adjustments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_adjustments"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_adjustment_mutation();

-- §10: why an adjustment opened. A later cause joins the OPEN adjustment.
CREATE TABLE "payroll_adjustment_causes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_adjustment_id" UUID NOT NULL,
  "origin" TEXT NOT NULL,
  "payroll_input_id" UUID,
  "source_correction_key" CITEXT,
  "payroll_hold_id" UUID,
  "reason" TEXT,
  "opened_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "payroll_adjustment_causes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_adjustment_causes_origin_check"
    CHECK ("origin" IN ('SOURCE_CORRECTION', 'PAYROLL_HOLD', 'RECALCULATION')),
  CONSTRAINT "payroll_adjustment_causes_source_correction_check"
    CHECK (("origin" = 'SOURCE_CORRECTION')
           = ("payroll_input_id" IS NOT NULL AND "source_correction_key" IS NOT NULL)),
  CONSTRAINT "payroll_adjustment_causes_hold_check"
    CHECK (("origin" = 'PAYROLL_HOLD') = ("payroll_hold_id" IS NOT NULL)),
  CONSTRAINT "payroll_adjustment_causes_recalculation_check"
    CHECK (("origin" = 'RECALCULATION')
           = ("opened_by_membership_id" IS NOT NULL AND COALESCE(btrim("reason"), '') <> '')),
  CONSTRAINT "payroll_adjustment_causes_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustment_causes_adjustment_fkey"
    FOREIGN KEY ("agency_id", "payroll_adjustment_id")
    REFERENCES "payroll_adjustments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustment_causes_input_fkey"
    FOREIGN KEY ("agency_id", "payroll_input_id")
    REFERENCES "payroll_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustment_causes_hold_fkey"
    FOREIGN KEY ("agency_id", "payroll_hold_id")
    REFERENCES "payroll_holds"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustment_causes_opened_by_fkey"
    FOREIGN KEY ("agency_id", "opened_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_adjustment_causes_correction_key" UNIQUE ("agency_id", "source_correction_key")
);

CREATE INDEX "payroll_adjustment_causes_adjustment_idx"
  ON "payroll_adjustment_causes" ("agency_id", "payroll_adjustment_id");

-- A cause joins only an OPEN adjustment, which it locks so a concurrent
-- posting waits for it or it for the posting. A hold cause is written only by
-- the finalization of the held period, naming that period's active hold of
-- the adjustment's Employee. A cause never changes and is never deleted.
CREATE OR REPLACE FUNCTION guard_payroll_adjustment_cause_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  adjustment record;
BEGIN
  SELECT a."status", a."original_payroll_period_id", a."employee_id"
  INTO adjustment
  FROM "payroll_adjustments" a
  WHERE a."agency_id" = NEW."agency_id"
    AND a."id" = NEW."payroll_adjustment_id"
  FOR SHARE;
  IF adjustment."status" IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'A cause joins only an OPEN Payroll Adjustment' USING ERRCODE = '55000';
  END IF;
  IF NEW."origin" = 'PAYROLL_HOLD' AND NOT EXISTS (
    SELECT 1
    FROM "payroll_holds" h
    JOIN "payroll_periods" p ON p."agency_id" = h."agency_id" AND p."id" = h."payroll_period_id"
    WHERE h."agency_id" = NEW."agency_id"
      AND h."id" = NEW."payroll_hold_id"
      AND h."payroll_period_id" = adjustment."original_payroll_period_id"
      AND h."employee_id" = adjustment."employee_id"
      AND h."lifted_at" IS NULL
      AND p."status" = 'FINALIZED'
      AND p."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Payroll Hold opens an adjustment only as its period is finalized'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_adjustment_causes_insert_trigger"
  BEFORE INSERT ON "payroll_adjustment_causes"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_adjustment_cause_insert();

CREATE TRIGGER "payroll_adjustment_causes_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_adjustment_causes"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- §6: the carrying version's snapshot names each OPEN adjustment it carries,
-- beside the rules, applicability records, and authorized inputs in effect on
-- the original period's dates.
ALTER TABLE "payroll_rule_snapshot_items"
  ADD COLUMN "payroll_adjustment_id" UUID;

ALTER TABLE "payroll_rule_snapshot_items"
  DROP CONSTRAINT "payroll_rule_snapshot_items_one_source_check";

ALTER TABLE "payroll_rule_snapshot_items"
  ADD CONSTRAINT "payroll_rule_snapshot_items_one_source_check"
    CHECK (num_nonnulls(
      "national_payroll_rule_version_id",
      "agency_payroll_applicability_id",
      "authorized_payroll_component_input_id",
      "payroll_adjustment_id"
    ) = 1),
  ADD CONSTRAINT "payroll_rule_snapshot_items_adjustment_fkey"
    FOREIGN KEY ("agency_id", "payroll_adjustment_id")
    REFERENCES "payroll_adjustments"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payroll_rule_snapshot_items_adjustment_key"
    UNIQUE ("payroll_rule_snapshot_id", "payroll_adjustment_id");

CREATE INDEX "payroll_rule_snapshot_items_adjustment_idx"
  ON "payroll_rule_snapshot_items" ("agency_id", "payroll_adjustment_id")
  WHERE "payroll_adjustment_id" IS NOT NULL;

-- §8: a line with `payroll_adjustment_id` carries the past period's component
-- and the signed difference.
ALTER TABLE "payroll_lines"
  ADD COLUMN "payroll_adjustment_id" UUID,
  ADD CONSTRAINT "payroll_lines_adjustment_fkey"
    FOREIGN KEY ("agency_id", "payroll_adjustment_id")
    REFERENCES "payroll_adjustments"("agency_id", "id") ON DELETE RESTRICT;

CREATE INDEX "payroll_lines_adjustment_idx"
  ON "payroll_lines" ("agency_id", "payroll_adjustment_id")
  WHERE "payroll_adjustment_id" IS NOT NULL;

-- A line joins its result only in the transaction that writes the result
-- (migration 0162). An adjustment line also carries an OPEN adjustment of its
-- result's Employee that its version's snapshot names.
CREATE OR REPLACE FUNCTION guard_payroll_line_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_employees" e
    WHERE e."agency_id" = NEW."agency_id"
      AND e."id" = NEW."payroll_employee_id"
      AND e."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Payroll Line joins its result only in the transaction that writes it'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."payroll_adjustment_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "payroll_employees" e
    JOIN "payroll_adjustments" a
      ON a."agency_id" = e."agency_id" AND a."employee_id" = e."employee_id"
    JOIN "payroll_rule_snapshots" s
      ON s."agency_id" = e."agency_id"
     AND s."payroll_period_id" = e."payroll_period_id"
     AND s."calculation_version" = e."calculation_version"
    JOIN "payroll_rule_snapshot_items" i
      ON i."agency_id" = s."agency_id"
     AND i."payroll_rule_snapshot_id" = s."id"
     AND i."payroll_adjustment_id" = a."id"
    WHERE e."agency_id" = NEW."agency_id"
      AND e."id" = NEW."payroll_employee_id"
      AND a."id" = NEW."payroll_adjustment_id"
      AND a."status" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'A Payroll Line carries only an OPEN adjustment of its Employee that its version''s snapshot names'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- REVOKE first: the migrator's default privileges would give `hris_app` more.
REVOKE ALL ON TABLE "payroll_holds", "payroll_adjustments", "payroll_adjustment_causes" FROM hris_app;
GRANT SELECT ON TABLE "payroll_holds" TO hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_adjustments", "payroll_adjustment_causes" TO hris_app;
GRANT UPDATE ("status", "posted_by_payroll_period_id", "posted_at")
  ON TABLE "payroll_adjustments" TO hris_app;

ALTER TABLE "payroll_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_holds" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_adjustments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_adjustment_causes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_adjustment_causes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payroll_holds_select" ON "payroll_holds"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_adjustments_select" ON "payroll_adjustments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_adjustments_insert" ON "payroll_adjustments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_adjustments_update" ON "payroll_adjustments"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_adjustment_causes_select" ON "payroll_adjustment_causes"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_adjustment_causes_insert" ON "payroll_adjustment_causes"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_class
    WHERE relname IN ('payroll_holds', 'payroll_adjustments', 'payroll_adjustment_causes')
      AND relrowsecurity AND relforcerowsecurity
  ) <> 3 THEN
    RAISE EXCEPTION 'Payroll Adjustment RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_holds_mutation_trigger', 'payroll_adjustments_mutation_trigger',
                     'payroll_adjustment_causes_insert_trigger',
                     'payroll_adjustment_causes_immutable_trigger')
  ) <> 4 THEN
    RAISE EXCEPTION 'Payroll Adjustment guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; adjustments,
-- their causes, and the lines that carried them are retained payroll history.
-- Verification: pnpm db:policies payroll_adjustments; pnpm db:policies
-- payroll_adjustment_causes; pnpm db:policies payroll_holds
