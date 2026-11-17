-- Phase 9 contribution billing reconciliation (#349), as payroll-schema.md §9
-- has it. A user with `payroll.deductions.manage` records the issuer's
-- validated billing of one Employee's contribution for a regular Payroll
-- Period, with the finalized Document Version that evidences it. The
-- calculation compares it with the Contribution Line it calculated, and an
-- unexplained difference is a blocking Payroll Exception (BRD PAY-004, #27).
-- The billing never replaces the rule: it writes no line.
--
-- Rows are only inserted. A correction is a new row that names the one it
-- supersedes, so the current billing of an Employee and contribution type is
-- the one no row supersedes.
CREATE TABLE "contribution_billings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "contribution_type" TEXT NOT NULL,
  "employee_share" NUMERIC(19,4) NOT NULL,
  "employer_share" NUMERIC(19,4) NOT NULL,
  "evidence_document_version_id" UUID NOT NULL,
  "supersedes_contribution_billing_id" UUID,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "contribution_billings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contribution_billings_type_check"
    CHECK ("contribution_type" IN ('GSIS', 'EMPLOYEES_COMPENSATION', 'PHILHEALTH', 'PAGIBIG')),
  CONSTRAINT "contribution_billings_shares_check"
    CHECK ("employee_share" >= 0 AND "employer_share" >= 0),
  CONSTRAINT "contribution_billings_employer_only_check"
    CHECK ("contribution_type" <> 'EMPLOYEES_COMPENSATION' OR "employee_share" = 0),
  CONSTRAINT "contribution_billings_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_billings_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_billings_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_billings_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_billings_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_contribution_billing_id")
    REFERENCES "contribution_billings"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_billings_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_billings_agency_id_id_key" UNIQUE ("agency_id", "id"),
  -- A billing has at most one correction, so two concurrent corrections conflict.
  CONSTRAINT "contribution_billings_supersedes_key" UNIQUE ("supersedes_contribution_billing_id")
);

-- One first billing per Employee, period, and contribution type; every later
-- one is a correction in its chain.
CREATE UNIQUE INDEX "contribution_billings_first_key"
  ON "contribution_billings" ("payroll_period_id", "employee_id", "contribution_type")
  WHERE "supersedes_contribution_billing_id" IS NULL;

CREATE INDEX "contribution_billings_period_idx"
  ON "contribution_billings" ("agency_id", "payroll_period_id");

-- A billing is recorded only for a regular period in DRAFT, so the next
-- calculation compares it before the period can be certified. A correction
-- keeps its predecessor's period, Employee, and type. Nothing is updated or
-- deleted.
CREATE OR REPLACE FUNCTION guard_contribution_billing_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  period_status text;
  period_run_type text;
  predecessor "contribution_billings"%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Contribution billings are retained and never change'
      USING ERRCODE = '55000';
  END IF;

  SELECT p."status", p."run_type"
  INTO period_status, period_run_type
  FROM "payroll_periods" p
  WHERE p."agency_id" = NEW."agency_id" AND p."id" = NEW."payroll_period_id"
  FOR SHARE;
  IF period_run_type IS DISTINCT FROM 'REGULAR' OR period_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'A contribution billing is recorded only for a regular Payroll Period in DRAFT'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."supersedes_contribution_billing_id" IS NOT NULL THEN
    SELECT * INTO predecessor
    FROM "contribution_billings"
    WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."supersedes_contribution_billing_id";
    IF (predecessor."payroll_period_id", predecessor."employee_id", predecessor."contribution_type")
      IS DISTINCT FROM
       (NEW."payroll_period_id", NEW."employee_id", NEW."contribution_type") THEN
      RAISE EXCEPTION 'A corrected contribution billing keeps its period, Employee, and contribution type'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "contribution_billings_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "contribution_billings"
  FOR EACH ROW EXECUTE FUNCTION guard_contribution_billing_mutation();

-- REVOKE first: the migrator's default privileges would give `hris_app` UPDATE.
REVOKE ALL ON TABLE "contribution_billings" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "contribution_billings" TO hris_app;

ALTER TABLE "contribution_billings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contribution_billings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "contribution_billings_select" ON "contribution_billings"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "contribution_billings_insert" ON "contribution_billings"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- `payroll.deductions.manage` (migration 0158) now also records billing.
UPDATE "permissions"
SET "description" = 'Record, change, and end Employee loan and deduction obligations, and record contribution billing'
WHERE "code" = 'payroll.deductions.manage';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'contribution_billings_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Contribution billing mutation guard verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'contribution_billings' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Contribution billing forced RLS verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; billings
-- are retained payroll evidence.
-- Verification: pnpm db:policies contribution_billings
