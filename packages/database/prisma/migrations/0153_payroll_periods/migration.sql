-- Phase 9 Payroll Periods, their payroll-function actors, and rule snapshots
-- (#333), as payroll-schema.md §5 and §6 have them. A Payroll Period is one
-- payroll run of one Agency; a regular period is one calendar month (ADR 0015).
-- A person acts in one payroll function per period (#330). Each calculation
-- version freezes one immutable snapshot of the National Payroll Rule Versions
-- in effect on the period's dates (#328).
--
-- `payroll_rule_snapshot_items` carries only its National Payroll Rule Version
-- reference. `agency_payroll_applicability_id` (#618) and
-- `authorized_payroll_component_input_id` (#346) arrive with their tables: each
-- adds its column, foreign key, and UNIQUE, and replaces
-- `payroll_rule_snapshot_items_one_source_check` with one that counts it.

CREATE TABLE "payroll_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" CITEXT NOT NULL,
  "run_type" TEXT NOT NULL,
  "period_from" DATE NOT NULL,
  "period_to" DATE NOT NULL,
  "cutoff_at" TIMESTAMPTZ(6) NOT NULL,
  "payment_date" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "carries_adjustments" BOOLEAN NOT NULL DEFAULT false,
  "calculation_version" INTEGER NOT NULL DEFAULT 0,
  "finalized_at" TIMESTAMPTZ(6),
  "void_requested_by_membership_id" UUID,
  "void_requested_at" TIMESTAMPTZ(6),
  "void_reason" TEXT,
  "void_document_version_id" UUID,
  "voided_by_membership_id" UUID,
  "voided_at" TIMESTAMPTZ(6),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_periods_run_type_check" CHECK ("run_type" IN ('REGULAR', 'SPECIAL')),
  CONSTRAINT "payroll_periods_status_check"
    CHECK ("status" IN (
      'DRAFT', 'CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'APPROVED', 'FINALIZED', 'VOIDED'
    )),
  CONSTRAINT "payroll_periods_calculation_version_check" CHECK ("calculation_version" >= 0),
  CONSTRAINT "payroll_periods_dates_check" CHECK ("period_to" >= "period_from"),
  CONSTRAINT "payroll_periods_carries_adjustments_check"
    CHECK (NOT "carries_adjustments" OR "run_type" = 'SPECIAL'),
  CONSTRAINT "payroll_periods_void_request_check"
    CHECK (("void_requested_at" IS NULL) = ("void_requested_by_membership_id" IS NULL)),
  CONSTRAINT "payroll_periods_voided_check"
    CHECK (("status" = 'VOIDED') = ("voided_at" IS NOT NULL)),
  CONSTRAINT "payroll_periods_void_reason_check"
    CHECK ("status" <> 'VOIDED'
           OR ("voided_by_membership_id" IS NOT NULL AND btrim("void_reason") <> '')),
  CONSTRAINT "payroll_periods_void_separation_check"
    CHECK ("void_requested_by_membership_id" IS NULL
           OR "void_requested_by_membership_id" <> "voided_by_membership_id"),
  CONSTRAINT "payroll_periods_regular_month_check"
    CHECK ("run_type" <> 'REGULAR'
           OR ("period_from" = date_trunc('month', "period_from")::date
               AND "period_to" = ("period_from" + interval '1 month - 1 day')::date)),
  CONSTRAINT "payroll_periods_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_periods_void_requested_by_fkey"
    FOREIGN KEY ("agency_id", "void_requested_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_periods_voided_by_fkey"
    FOREIGN KEY ("agency_id", "voided_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_periods_void_document_version_fkey"
    FOREIGN KEY ("agency_id", "void_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_periods_agency_id_code_key" UNIQUE ("agency_id", "code"),
  CONSTRAINT "payroll_periods_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A duplicate is a second regular period, not VOIDED, for a covered month.
CREATE UNIQUE INDEX "payroll_periods_regular_month_key"
  ON "payroll_periods" ("agency_id", "period_from")
  WHERE "run_type" = 'REGULAR' AND "status" <> 'VOIDED';

-- An Agency has at most one regular period that is not FINALIZED or VOIDED.
CREATE UNIQUE INDEX "payroll_periods_one_open_regular_key"
  ON "payroll_periods" ("agency_id")
  WHERE "run_type" = 'REGULAR' AND "status" NOT IN ('FINALIZED', 'VOIDED');

CREATE TABLE "payroll_period_components" (
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "pay_component_id" UUID NOT NULL,
  CONSTRAINT "payroll_period_components_pkey" PRIMARY KEY ("payroll_period_id", "pay_component_id"),
  CONSTRAINT "payroll_period_components_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_period_components_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_period_components_pay_component_fkey"
    FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id") ON DELETE RESTRICT
);

CREATE TABLE "payroll_period_actors" (
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "payroll_function" TEXT NOT NULL,
  "first_acted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_period_actors_pkey" PRIMARY KEY ("payroll_period_id", "membership_id"),
  CONSTRAINT "payroll_period_actors_payroll_function_check"
    CHECK ("payroll_function" IN (
      'PREPARATION', 'HR_CERTIFICATION', 'BUDGET_REVIEW',
      'ACCOUNTING_REVIEW', 'APPROVAL', 'DISBURSEMENT'
    )),
  CONSTRAINT "payroll_period_actors_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_period_actors_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_period_actors_membership_fkey"
    FOREIGN KEY ("agency_id", "membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "payroll_rule_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "cutoff_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_rule_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_rule_snapshots_calculation_version_check" CHECK ("calculation_version" > 0),
  CONSTRAINT "payroll_rule_snapshots_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_rule_snapshots_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_rule_snapshots_period_version_key"
    UNIQUE ("payroll_period_id", "calculation_version"),
  CONSTRAINT "payroll_rule_snapshots_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "payroll_rule_snapshot_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_rule_snapshot_id" UUID NOT NULL,
  "national_payroll_rule_version_id" UUID,
  CONSTRAINT "payroll_rule_snapshot_items_pkey" PRIMARY KEY ("id"),
  -- Each item references exactly one source. Later sources join this count.
  CONSTRAINT "payroll_rule_snapshot_items_one_source_check"
    CHECK (num_nonnulls("national_payroll_rule_version_id") = 1),
  CONSTRAINT "payroll_rule_snapshot_items_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_rule_snapshot_items_snapshot_fkey"
    FOREIGN KEY ("agency_id", "payroll_rule_snapshot_id")
    REFERENCES "payroll_rule_snapshots"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_rule_snapshot_items_rule_version_fkey"
    FOREIGN KEY ("national_payroll_rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_rule_snapshot_items_rule_version_key"
    UNIQUE ("payroll_rule_snapshot_id", "national_payroll_rule_version_id")
);

-- §4: the inbox's consuming period gets its foreign key now that periods exist.
ALTER TABLE "payroll_inputs"
  ADD CONSTRAINT "payroll_inputs_agency_id_consumed_by_payroll_period_id_fkey"
  FOREIGN KEY ("agency_id", "consumed_by_payroll_period_id")
  REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT;

-- A period is created DRAFT and never deleted. Its run, dates, and adjustment
-- carriage are fixed; the cutoff moves only in DRAFT; the status follows
-- hris-controls.md §5.20; and a calculation version starts only as calculation
-- starts. A special period names a component, or carries adjustments, before
-- its first calculation.
CREATE OR REPLACE FUNCTION guard_payroll_period_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  starts_calculation boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Periods are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."calculation_version" <> 0 THEN
      RAISE EXCEPTION 'A Payroll Period is created as DRAFT with no calculation'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'A voided Payroll Period is final'
      USING ERRCODE = '55000';
  END IF;

  IF (NEW."id", NEW."agency_id", NEW."code", NEW."run_type", NEW."period_from",
      NEW."period_to", NEW."carries_adjustments")
     IS DISTINCT FROM
     (OLD."id", OLD."agency_id", OLD."code", OLD."run_type", OLD."period_from",
      OLD."period_to", OLD."carries_adjustments") THEN
    RAISE EXCEPTION 'A Payroll Period keeps its code, run type, and dates'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."cutoff_at" IS DISTINCT FROM OLD."cutoff_at" AND OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'The cutoff of a Payroll Period moves only while it is DRAFT'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND (OLD."status", NEW."status") NOT IN (
    ('DRAFT', 'CALCULATING'), ('DRAFT', 'VOIDED'),
    ('CALCULATING', 'FOR_REVIEW'), ('CALCULATING', 'DRAFT'),
    ('FOR_REVIEW', 'DRAFT'), ('FOR_REVIEW', 'CERTIFIED'),
    ('CERTIFIED', 'FOR_REVIEW'), ('CERTIFIED', 'APPROVED'),
    ('APPROVED', 'FOR_REVIEW'), ('APPROVED', 'FINALIZED'),
    ('FINALIZED', 'VOIDED')
  ) THEN
    RAISE EXCEPTION 'A Payroll Period cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  starts_calculation := OLD."status" = 'DRAFT' AND NEW."status" = 'CALCULATING';
  IF starts_calculation <> (NEW."calculation_version" = OLD."calculation_version" + 1)
     OR (NOT starts_calculation AND NEW."calculation_version" <> OLD."calculation_version") THEN
    RAISE EXCEPTION 'A Payroll Period gains one calculation version as each calculation starts'
      USING ERRCODE = '55000';
  END IF;

  IF starts_calculation AND NEW."run_type" = 'SPECIAL' AND NOT NEW."carries_adjustments"
     AND NOT EXISTS (
       SELECT 1 FROM "payroll_period_components" c WHERE c."payroll_period_id" = NEW."id"
     ) THEN
    RAISE EXCEPTION 'A special Payroll Period names a component before calculation'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_periods_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_periods"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_period_mutation();

-- Only a special period names components, and only while it is DRAFT.
CREATE OR REPLACE FUNCTION guard_payroll_period_component_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."run_type" = 'SPECIAL'
      AND p."status" = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Only a DRAFT special Payroll Period names the components it pays'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_period_components_insert_trigger"
  BEFORE INSERT ON "payroll_period_components"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_period_component_insert();

-- Actors, snapshots, and snapshot items are written once and kept.
CREATE OR REPLACE FUNCTION reject_payroll_record_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "payroll_period_actors_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_period_actors"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

CREATE TRIGGER "payroll_rule_snapshots_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_rule_snapshots"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

CREATE TRIGGER "payroll_rule_snapshot_items_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_rule_snapshot_items"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- An item joins its snapshot only in the transaction that takes the snapshot,
-- so a frozen snapshot cannot gain items later.
CREATE OR REPLACE FUNCTION guard_payroll_rule_snapshot_item_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_rule_snapshots" s
    WHERE s."agency_id" = NEW."agency_id"
      AND s."id" = NEW."payroll_rule_snapshot_id"
      AND s."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A rule snapshot item joins its snapshot only in the transaction that takes it'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_rule_snapshot_items_insert_trigger"
  BEFORE INSERT ON "payroll_rule_snapshot_items"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_rule_snapshot_item_insert();

-- REVOKE first: the migrator's default privileges would give `hris_app` UPDATE
-- on every table. Only the period itself changes.
REVOKE ALL ON TABLE "payroll_periods", "payroll_period_components", "payroll_period_actors",
  "payroll_rule_snapshots", "payroll_rule_snapshot_items" FROM hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "payroll_periods" TO hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_period_components", "payroll_period_actors",
  "payroll_rule_snapshots", "payroll_rule_snapshot_items" TO hris_app;

ALTER TABLE "payroll_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_period_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_period_components" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_period_actors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_period_actors" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_rule_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_rule_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_rule_snapshot_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_rule_snapshot_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payroll_periods_select" ON "payroll_periods"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_periods_insert" ON "payroll_periods"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_periods_update" ON "payroll_periods"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "payroll_period_components_select" ON "payroll_period_components"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_period_components_insert" ON "payroll_period_components"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "payroll_period_actors_select" ON "payroll_period_actors"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_period_actors_insert" ON "payroll_period_actors"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "payroll_rule_snapshots_select" ON "payroll_rule_snapshots"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_rule_snapshots_insert" ON "payroll_rule_snapshots"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "payroll_rule_snapshot_items_select" ON "payroll_rule_snapshot_items"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_rule_snapshot_items_insert" ON "payroll_rule_snapshot_items"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.periods.create', 'payroll', 'HIGH',
  'Create Payroll Periods, move a draft cutoff, and cancel a draft period'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.periods.create` to the Payroll Preparer only.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.periods.create'
WHERE r."code" = 'payroll_preparer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_class
    WHERE relname IN ('payroll_periods', 'payroll_period_components', 'payroll_period_actors',
                      'payroll_rule_snapshots', 'payroll_rule_snapshot_items')
      AND relforcerowsecurity
  ) <> 5 THEN
    RAISE EXCEPTION 'Payroll Period forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_periods_mutation_trigger', 'payroll_period_actors_immutable_trigger',
                     'payroll_rule_snapshots_immutable_trigger',
                     'payroll_rule_snapshot_items_immutable_trigger')
  ) <> 4 THEN
    RAISE EXCEPTION 'Payroll Period mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; periods,
-- actors, and snapshots are retained payroll history.
-- Verification: pnpm db:policies payroll_periods
