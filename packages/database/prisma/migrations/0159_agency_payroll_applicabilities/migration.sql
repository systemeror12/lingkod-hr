-- Phase 9 Agency Payroll Applicability (#618), as payroll-schema.md §3 has it.
-- An Agency records, with its authority and funding, that a conditional pay
-- component applies from a date to the whole Agency or to one named Employee.
-- A conditional component stays off until one does (#27, #328). There is no
-- population rule by office, position, or grade: national eligibility stays in
-- the calculator. An unconditional component needs no record.
--
-- §6: a rule snapshot also references the applicability records in effect
-- during its period, so `payroll_rule_snapshot_items` gains the reference and
-- its one-source CHECK counts it.

CREATE TABLE "agency_payroll_applicabilities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pay_component_id" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "employee_id" UUID,
  "authority_document_version_id" UUID NOT NULL,
  "funding_reference" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "agency_payroll_applicabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_payroll_applicabilities_scope_check"
    CHECK ("scope" IN ('AGENCY', 'EMPLOYEE')),
  CONSTRAINT "agency_payroll_applicabilities_funding_reference_check"
    CHECK (btrim("funding_reference") <> ''),
  CONSTRAINT "agency_payroll_applicabilities_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "agency_payroll_applicabilities_scope_employee_check"
    CHECK (("scope" = 'EMPLOYEE') = ("employee_id" IS NOT NULL)),
  CONSTRAINT "agency_payroll_applicabilities_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "agency_payroll_applicabilities_pay_component_id_fkey"
    FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id") ON DELETE RESTRICT,
  CONSTRAINT "agency_payroll_applicabilities_agency_id_employee_id_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "agency_payroll_applicabilities_authority_fkey"
    FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "agency_payroll_applicabilities_recorded_by_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "agency_payroll_applicabilities_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- Records for one component and one scope target never overlap. The whole
-- Agency is one target and each named Employee another, so an Agency-wide
-- record and an Employee's record may coexist. Its index also serves lookup.
ALTER TABLE "agency_payroll_applicabilities"
  ADD CONSTRAINT "agency_payroll_applicabilities_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "pay_component_id" WITH =,
    COALESCE("employee_id", '00000000-0000-0000-0000-000000000000'::UUID) WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  );

-- A record is for a conditional component. A GAA-revalidated component's
-- record ends no later than 31 December of the fiscal year it starts in;
-- renewal is a new record. After insert, only `effective_to` moves, and only
-- earlier. None is deleted.
CREATE OR REPLACE FUNCTION guard_agency_payroll_applicability_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  component RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Agency Payroll Applicability records are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT c."is_conditional", c."is_gaa_revalidated" INTO component
    FROM "pay_components" c WHERE c."id" = NEW."pay_component_id";
    IF NOT FOUND OR NOT component."is_conditional" THEN
      RAISE EXCEPTION 'Only a conditional pay component takes an Agency Payroll Applicability'
        USING ERRCODE = '23514';
    END IF;
    IF component."is_gaa_revalidated" AND (
      NEW."effective_to" IS NULL
      OR NEW."effective_to" > make_date(EXTRACT(YEAR FROM NEW."effective_from")::INTEGER, 12, 31)
    ) THEN
      RAISE EXCEPTION 'A GAA-revalidated Agency Payroll Applicability ends no later than 31 December of its fiscal year'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION 'An Agency Payroll Applicability changes only by an earlier effective_to'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
     AND (NEW."effective_to" IS NULL
          OR (OLD."effective_to" IS NOT NULL AND NEW."effective_to" >= OLD."effective_to")) THEN
    RAISE EXCEPTION 'An Agency Payroll Applicability is ended only by an earlier effective_to'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agency_payroll_applicabilities_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "agency_payroll_applicabilities"
  FOR EACH ROW EXECUTE FUNCTION guard_agency_payroll_applicability_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "agency_payroll_applicabilities" TO hris_app;

ALTER TABLE "agency_payroll_applicabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_payroll_applicabilities" FORCE ROW LEVEL SECURITY;

CREATE POLICY "agency_payroll_applicabilities_select" ON "agency_payroll_applicabilities"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "agency_payroll_applicabilities_insert" ON "agency_payroll_applicabilities"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "agency_payroll_applicabilities_update" ON "agency_payroll_applicabilities"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

-- §6: the snapshot references the applicability records of its period.
ALTER TABLE "payroll_rule_snapshot_items"
  ADD COLUMN "agency_payroll_applicability_id" UUID;

ALTER TABLE "payroll_rule_snapshot_items"
  DROP CONSTRAINT "payroll_rule_snapshot_items_one_source_check";

ALTER TABLE "payroll_rule_snapshot_items"
  ADD CONSTRAINT "payroll_rule_snapshot_items_one_source_check"
    CHECK (num_nonnulls(
      "national_payroll_rule_version_id",
      "agency_payroll_applicability_id",
      "authorized_payroll_component_input_id"
    ) = 1),
  ADD CONSTRAINT "payroll_rule_snapshot_items_applicability_fkey"
    FOREIGN KEY ("agency_id", "agency_payroll_applicability_id")
    REFERENCES "agency_payroll_applicabilities"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payroll_rule_snapshot_items_applicability_key"
    UNIQUE ("payroll_rule_snapshot_id", "agency_payroll_applicability_id");

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.compensation.manage',
  'payroll',
  'HIGH',
  'Record and end Agency Payroll Applicability records'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.compensation.manage` to the HR
-- Admin. The Payroll Preparer and HR Certifier grants are agency-configurable.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.compensation.manage'
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'agency_payroll_applicabilities_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Agency Payroll Applicability mutation guard verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'agency_payroll_applicabilities' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Agency Payroll Applicability forced RLS verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; payroll
-- snapshots reference these rows.
-- Verification: pnpm db:policies agency_payroll_applicabilities
