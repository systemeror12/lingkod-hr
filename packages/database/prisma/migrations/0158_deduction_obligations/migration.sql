-- Phase 9 Deduction Obligations (#352), as payroll-schema.md §9 has them. An
-- Agency records an Employee's issuer-validated loan or deduction obligation:
-- its payee, authorization, balance, scheduled amount, and the date it was
-- incurred. Payroll never calculates interest or amortization (#27), and
-- applying an obligation in calculation is #634.
--
-- A change never edits a row. It marks the row SUPERSEDED and inserts a
-- successor that names it, so every version of the terms stays. Ending sets
-- `effective_to` and an end reason. No row is deleted.

-- The GAA's authorized-deduction rule (FY 2026 GAA sec. 62) is a National
-- Payroll Rule Version whose parameters list the allowed payee categories.
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN ('SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS'));

CREATE TABLE "deduction_obligations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "payee_category" TEXT NOT NULL,
  "payee_name" CITEXT NOT NULL,
  "issuer_reference" CITEXT NOT NULL,
  "incurred_on" DATE NOT NULL,
  "outstanding_balance" NUMERIC(19,4) NOT NULL,
  "scheduled_amount" NUMERIC(19,4) NOT NULL,
  "authority_document_version_id" UUID NOT NULL,
  "payee_rule_version_id" UUID NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "supersedes_obligation_id" UUID,
  "change_reason" TEXT,
  "end_reason" TEXT,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "ended_by_membership_id" UUID,
  "ended_at" TIMESTAMPTZ(6),
  CONSTRAINT "deduction_obligations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deduction_obligations_payee_category_check"
    CHECK ("payee_category" IN (
      'BIR', 'PHILHEALTH', 'GSIS', 'HDMF', 'NATIONAL_GOVERNMENT_COA_DECISION',
      'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION', 'EMPLOYEE_PROVIDENT_FUND',
      'GOVERNMENT_FINANCIAL_INSTITUTION', 'LICENSED_INSURER', 'THRIFT_OR_RURAL_BANK'
    )),
  CONSTRAINT "deduction_obligations_payee_name_check"
    CHECK (length(btrim("payee_name")) > 0),
  CONSTRAINT "deduction_obligations_issuer_reference_check"
    CHECK (length(btrim("issuer_reference")) > 0),
  CONSTRAINT "deduction_obligations_outstanding_balance_check"
    CHECK ("outstanding_balance" > 0),
  CONSTRAINT "deduction_obligations_scheduled_amount_check"
    CHECK ("scheduled_amount" > 0),
  CONSTRAINT "deduction_obligations_status_check"
    CHECK ("status" IN ('ACTIVE', 'SUPERSEDED', 'ENDED')),
  CONSTRAINT "deduction_obligations_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "deduction_obligations_ended_check"
    CHECK (
      ("status" = 'ENDED') = ("effective_to" IS NOT NULL)
      AND ("status" = 'ENDED') = ("end_reason" IS NOT NULL)
      AND ("status" = 'ENDED') = ("ended_by_membership_id" IS NOT NULL)
      AND ("status" = 'ENDED') = ("ended_at" IS NOT NULL)
    ),
  CONSTRAINT "deduction_obligations_change_reason_check"
    CHECK (("supersedes_obligation_id" IS NOT NULL) = ("change_reason" IS NOT NULL)),
  CONSTRAINT "deduction_obligations_reason_text_check"
    CHECK (
      ("change_reason" IS NULL OR length(btrim("change_reason")) > 0)
      AND ("end_reason" IS NULL OR length(btrim("end_reason")) > 0)
    ),
  CONSTRAINT "deduction_obligations_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_obligations_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_obligations_authority_document_version_fkey"
    FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_obligations_payee_rule_version_fkey"
    FOREIGN KEY ("payee_rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_obligations_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_obligation_id")
    REFERENCES "deduction_obligations"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_obligations_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_obligations_ender_fkey"
    FOREIGN KEY ("agency_id", "ended_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_obligations_agency_id_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "deduction_obligations_supersedes_key" UNIQUE ("supersedes_obligation_id")
);

-- One active version per issuer obligation of an Employee.
CREATE UNIQUE INDEX "deduction_obligations_active_identity_key"
  ON "deduction_obligations" ("agency_id", "employee_id", "payee_category", "payee_name", "issuer_reference")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "deduction_obligations_employee_idx"
  ON "deduction_obligations" ("agency_id", "employee_id", "status", "incurred_on");

-- A row is inserted ACTIVE. A successor keeps its predecessor's identity, may
-- not start before it, and names a SUPERSEDED predecessor that has no other
-- successor (the UNIQUE above).
-- After insert a row only moves ACTIVE -> SUPERSEDED, with nothing else
-- changed, or ACTIVE -> ENDED, setting only its end fields.
CREATE OR REPLACE FUNCTION guard_deduction_obligation_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  predecessor "deduction_obligations"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Deduction Obligations are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'A Deduction Obligation is recorded ACTIVE'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."supersedes_obligation_id" IS NOT NULL THEN
      SELECT * INTO predecessor
      FROM "deduction_obligations"
      WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."supersedes_obligation_id";
      IF predecessor."status" IS DISTINCT FROM 'SUPERSEDED' THEN
        RAISE EXCEPTION 'A changed Deduction Obligation supersedes the version its change superseded'
          USING ERRCODE = '55000';
      END IF;
      IF (predecessor."employee_id", predecessor."payee_category", predecessor."payee_name",
          predecessor."issuer_reference", predecessor."incurred_on")
        IS DISTINCT FROM
         (NEW."employee_id", NEW."payee_category", NEW."payee_name",
          NEW."issuer_reference", NEW."incurred_on") THEN
        RAISE EXCEPTION 'A changed Deduction Obligation keeps its Employee, payee, issuer reference, and date incurred'
          USING ERRCODE = '23514';
      END IF;
      IF NEW."effective_from" < predecessor."effective_from" THEN
        RAISE EXCEPTION 'A changed Deduction Obligation cannot start before the version it supersedes'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A % Deduction Obligation cannot change', OLD."status"
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = 'SUPERSEDED'
    AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'ENDED'
    AND (to_jsonb(NEW) - 'status' - 'effective_to' - 'end_reason' - 'ended_by_membership_id' - 'ended_at')
      = (to_jsonb(OLD) - 'status' - 'effective_to' - 'end_reason' - 'ended_by_membership_id' - 'ended_at') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'A Deduction Obligation changes only by a successor version or by ending'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "deduction_obligations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "deduction_obligations"
  FOR EACH ROW EXECUTE FUNCTION guard_deduction_obligation_mutation();

-- A superseded row must have its successor by commit.
CREATE OR REPLACE FUNCTION require_deduction_obligation_successor()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "deduction_obligations"
    WHERE "agency_id" = NEW."agency_id" AND "supersedes_obligation_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'A superseded Deduction Obligation needs its successor version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "deduction_obligations_successor_trigger"
  AFTER UPDATE ON "deduction_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."status" = 'SUPERSEDED')
  EXECUTE FUNCTION require_deduction_obligation_successor();

GRANT SELECT, INSERT, UPDATE ON TABLE "deduction_obligations" TO hris_app;

ALTER TABLE "deduction_obligations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deduction_obligations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "deduction_obligations_select" ON "deduction_obligations"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "deduction_obligations_insert" ON "deduction_obligations"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "deduction_obligations_update" ON "deduction_obligations"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.deductions.manage',
  'payroll',
  'HIGH',
  'Record, change, and end Employee loan and deduction obligations'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.deductions.manage` to the Payroll
-- Preparer. The HR Certifier, Accounting Reviewer, and HR Admin grants are
-- agency-configurable.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.deductions.manage'
WHERE r."code" = 'payroll_preparer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'deduction_obligations_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Deduction Obligation mutation guard verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'deduction_obligations' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Deduction Obligation forced RLS verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration.
-- Verification: pnpm db:policies deduction_obligations
