-- Phase 9 GSIS and Employees' Compensation contributions (#348), as
-- payroll-schema.md §1, §2, and §9 have them. The calculation job writes one
-- Contribution Line per Employee and contribution type with the result, and
-- the shares as Payroll Lines, from the GSIS_CONTRIBUTION and
-- EMPLOYEES_COMPENSATION National Payroll Rule Versions in the period's rule
-- snapshot. Neither kind is required to freeze a snapshot: a period with no
-- version in effect calculates, and each Employee gets a blocking exception.
--
-- PHILHEALTH and PAGIBIG join the contribution_type check with their
-- calculators (#632).

ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION'
    ));

CREATE TABLE "contribution_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_employee_id" UUID NOT NULL,
  "contribution_type" TEXT NOT NULL,
  "employee_share" NUMERIC(19,4) NOT NULL,
  "employer_share" NUMERIC(19,4) NOT NULL,
  "compensation_base" NUMERIC(19,4) NOT NULL,
  "rule_version_id" UUID NOT NULL,
  CONSTRAINT "contribution_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contribution_lines_type_check"
    CHECK ("contribution_type" IN ('GSIS', 'EMPLOYEES_COMPENSATION')),
  CONSTRAINT "contribution_lines_shares_check"
    CHECK ("employee_share" >= 0 AND "employer_share" >= 0 AND "compensation_base" > 0),
  -- Employees' Compensation is paid entirely by the employer (PD No. 626, art. 181(c)).
  CONSTRAINT "contribution_lines_employer_only_check"
    CHECK ("contribution_type" <> 'EMPLOYEES_COMPENSATION' OR "employee_share" = 0),
  CONSTRAINT "contribution_lines_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_lines_payroll_employee_fkey"
    FOREIGN KEY ("agency_id", "payroll_employee_id")
    REFERENCES "payroll_employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_lines_rule_version_fkey"
    FOREIGN KEY ("rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_lines_employee_type_key"
    UNIQUE ("payroll_employee_id", "contribution_type")
);

-- A Contribution Line joins its result only in the transaction that writes
-- the result, and is never changed or deleted, like a Payroll Line (§8).
CREATE OR REPLACE FUNCTION guard_contribution_line_insert()
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
    RAISE EXCEPTION 'A Contribution Line joins its result only in the transaction that writes it'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "contribution_lines_insert_trigger"
  BEFORE INSERT ON "contribution_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_contribution_line_insert();

CREATE TRIGGER "contribution_lines_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "contribution_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- REVOKE first: the migrator's default privileges would give `hris_app` UPDATE.
REVOKE ALL ON TABLE "contribution_lines" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "contribution_lines" TO hris_app;

ALTER TABLE "contribution_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contribution_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY "contribution_lines_select" ON "contribution_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "contribution_lines_insert" ON "contribution_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- The shares as Native Payroll Components (BRD PAY-004). They are
-- unconditional, so they need no Agency Payroll Applicability and take no
-- Authorized Payroll Component Input. Employees' Compensation has no
-- deduction component: no part of it is taken from the Employee's pay.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES
  ('GSIS_PERSONAL_SHARE', 'GSIS personal share', 'DEDUCTION', false, false, false),
  ('GSIS_GOVERNMENT_SHARE', 'GSIS government share', 'EMPLOYER_SHARE', false, false, false),
  ('EMPLOYEES_COMPENSATION', 'Employees'' Compensation', 'EMPLOYER_SHARE', false, false, false)
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'contribution_lines') THEN
    RAISE EXCEPTION 'Contribution line forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('contribution_lines_insert_trigger', 'contribution_lines_immutable_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Contribution line guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; contribution
-- lines are retained payroll history.
-- Verification: pnpm db:policies contribution_lines
