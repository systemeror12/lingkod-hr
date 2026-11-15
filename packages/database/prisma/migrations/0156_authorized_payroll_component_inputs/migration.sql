-- Phase 9 Authorized Payroll Component Inputs (#346), as payroll-schema.md §3
-- has them. An Agency records one approved, effective-dated amount, rate, or
-- quantity for a component national rules leave to Agency authority. It is
-- not a Payroll Input and never enters `payroll_inputs`, and it needs no
-- Agency Payroll Applicability: it carries its own authority, period, and scope.
--
-- `consumed_by_payroll_period_id` keeps its column, but its FOREIGN KEY to
-- `payroll_periods (agency_id, id)` waits for the migration that consumes a
-- `ONCE` input (#626), as `payroll_inputs` did. No input is consumed before then.

CREATE TABLE "authorized_payroll_component_inputs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pay_component_id" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "employee_id" UUID,
  "value_kind" TEXT NOT NULL,
  "value" NUMERIC(19,8) NOT NULL,
  "payment_schedule" TEXT NOT NULL,
  "authority_document_version_id" UUID NOT NULL,
  "source_reference" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "recorded_by_membership_id" UUID NOT NULL,
  "approved_by_membership_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "consumed_by_payroll_period_id" UUID,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "authorized_payroll_component_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "authorized_payroll_component_inputs_scope_check"
    CHECK ("scope" IN ('AGENCY', 'EMPLOYEE')),
  CONSTRAINT "authorized_payroll_component_inputs_value_kind_check"
    CHECK ("value_kind" IN ('AMOUNT', 'RATE', 'QUANTITY')),
  CONSTRAINT "authorized_payroll_component_inputs_value_check" CHECK ("value" > 0),
  CONSTRAINT "authorized_payroll_component_inputs_payment_schedule_check"
    CHECK ("payment_schedule" IN ('ONCE', 'EACH_REGULAR_PERIOD')),
  CONSTRAINT "authorized_payroll_component_inputs_source_reference_check"
    CHECK (btrim("source_reference") <> ''),
  CONSTRAINT "authorized_payroll_component_inputs_status_check"
    CHECK ("status" IN ('RECORDED', 'APPROVED', 'CANCELLED')),
  CONSTRAINT "authorized_payroll_component_inputs_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "authorized_payroll_component_inputs_scope_employee_check"
    CHECK (("scope" = 'EMPLOYEE') = ("employee_id" IS NOT NULL)),
  CONSTRAINT "authorized_payroll_component_inputs_segregation_check"
    CHECK ("approved_by_membership_id" IS DISTINCT FROM "recorded_by_membership_id"),
  CONSTRAINT "authorized_payroll_component_inputs_approval_check"
    CHECK (
      ("status" = 'APPROVED') = ("approved_at" IS NOT NULL)
      AND ("approved_at" IS NULL) = ("approved_by_membership_id" IS NULL)
    ),
  CONSTRAINT "authorized_payroll_component_inputs_consumed_check"
    CHECK (
      "consumed_by_payroll_period_id" IS NULL
      OR ("status" = 'APPROVED' AND "payment_schedule" = 'ONCE')
    ),
  CONSTRAINT "authorized_payroll_component_inputs_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "authorized_payroll_component_inputs_pay_component_id_fkey"
    FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id") ON DELETE RESTRICT,
  CONSTRAINT "authorized_payroll_component_inputs_agency_id_employee_id_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "authorized_payroll_component_inputs_authority_fkey"
    FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "authorized_payroll_component_inputs_recorded_by_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "authorized_payroll_component_inputs_approved_by_fkey"
    FOREIGN KEY ("agency_id", "approved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "authorized_payroll_component_inputs_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- Calculation reads the approved inputs of a component in effect on a date.
CREATE INDEX "authorized_payroll_component_inputs_component_effective_idx"
  ON "authorized_payroll_component_inputs"
  ("agency_id", "pay_component_id", "status", "effective_from");

-- An input is recorded `RECORDED` for a component that accepts one. A
-- different person approves it or it is cancelled; nothing else changes
-- before then. An approved input is never edited: it is ended by an earlier
-- `effective_to`, and a `ONCE` input is marked by the payroll that paid it.
-- None is deleted.
CREATE OR REPLACE FUNCTION guard_authorized_payroll_component_input_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  changeable CONSTANT TEXT[] := ARRAY[
    'status', 'approved_by_membership_id', 'approved_at', 'effective_to',
    'consumed_by_payroll_period_id', 'row_version'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Authorized Payroll Component Inputs are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RECORDED'
       OR NEW."approved_by_membership_id" IS NOT NULL
       OR NEW."consumed_by_payroll_period_id" IS NOT NULL THEN
      RAISE EXCEPTION 'An Authorized Payroll Component Input is recorded as RECORDED'
        USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "pay_components" c
      WHERE c."id" = NEW."pay_component_id" AND c."accepts_authorized_input"
    ) THEN
      RAISE EXCEPTION 'The pay component does not accept an Authorized Payroll Component Input'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - changeable) IS DISTINCT FROM (to_jsonb(OLD) - changeable) THEN
    RAISE EXCEPTION 'An Authorized Payroll Component Input changes only its status, approval, end date, and consuming payroll'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'RECORDED' AND NEW."status" = 'APPROVED' THEN
    IF NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
       OR NEW."consumed_by_payroll_period_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Approval changes only the status and the approval'
        USING ERRCODE = '55000';
    END IF;
    -- Two memberships of one User are one person (#27).
    IF EXISTS (
      SELECT 1
      FROM "agency_memberships" recorder
      JOIN "agency_memberships" approver
        ON approver."agency_id" = recorder."agency_id"
       AND approver."user_id" = recorder."user_id"
      WHERE recorder."agency_id" = NEW."agency_id"
        AND recorder."id" = NEW."recorded_by_membership_id"
        AND approver."id" = NEW."approved_by_membership_id"
    ) THEN
      RAISE EXCEPTION 'The approver of an Authorized Payroll Component Input is not its recorder'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'RECORDED' AND NEW."status" = 'CANCELLED' THEN
    IF (to_jsonb(NEW) - 'status' - 'row_version') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'row_version') THEN
      RAISE EXCEPTION 'Cancellation changes only the status'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD."status" = 'APPROVED' AND NEW."status" = 'APPROVED' THEN
    IF NEW."approved_by_membership_id" IS DISTINCT FROM OLD."approved_by_membership_id"
       OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at" THEN
      RAISE EXCEPTION 'An approved Authorized Payroll Component Input keeps its approval'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
       AND (NEW."effective_to" IS NULL
            OR (OLD."effective_to" IS NOT NULL AND NEW."effective_to" >= OLD."effective_to")) THEN
      RAISE EXCEPTION 'An approved Authorized Payroll Component Input is ended only by an earlier effective_to'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'An Authorized Payroll Component Input cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "authorized_payroll_component_inputs_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "authorized_payroll_component_inputs"
  FOR EACH ROW EXECUTE FUNCTION guard_authorized_payroll_component_input_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "authorized_payroll_component_inputs" TO hris_app;

ALTER TABLE "authorized_payroll_component_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorized_payroll_component_inputs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "authorized_payroll_component_inputs_select" ON "authorized_payroll_component_inputs"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "authorized_payroll_component_inputs_insert" ON "authorized_payroll_component_inputs"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "authorized_payroll_component_inputs_update" ON "authorized_payroll_component_inputs"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.inputs.adjust',
  'payroll',
  'HIGH',
  'Record and approve Authorized Payroll Component Inputs'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.inputs.adjust` to the Payroll
-- Preparer; the HR Certifier, Accounting Reviewer, and Payroll Approver grants
-- are agency-configurable, and those roles do not exist yet.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.inputs.adjust'
WHERE r."code" = 'payroll_preparer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'authorized_payroll_component_inputs_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Authorized Payroll Component Input mutation guard verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'authorized_payroll_component_inputs' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Authorized Payroll Component Input forced RLS verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; payroll
-- snapshots will reference these rows.
-- Verification: pnpm db:policies authorized_payroll_component_inputs
