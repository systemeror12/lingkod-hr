-- Phase 9 periodic compensation withholding tax (#350), as payroll-schema.md
-- §1, §8, and §9 have it. The calculation job writes one Tax Line per
-- Employee result in a regular period, and the tax as a WITHHOLDING_TAX
-- Payroll Line, from the COMPENSATION_WITHHOLDING_TAX and DE_MINIMIS_BENEFITS
-- National Payroll Rule Versions in the period's rule snapshot. Neither kind
-- is required to freeze a snapshot: a period with no version in effect
-- calculates, and each Employee gets a blocking exception.
--
-- The list keeps every kind the earlier migrations add, through 0174's
-- PHILHEALTH_CONTRIBUTION and PAGIBIG_CONTRIBUTION (#632).
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION',
      'YEAR_END_BONUS_AND_CASH_GIFT', 'PERA', 'COMMUTABLE_RATA', 'OVERTIME_PAY', 'CLOTHING_ALLOWANCE',
      'PHILHEALTH_CONTRIBUTION', 'PAGIBIG_CONTRIBUTION',
      'COMPENSATION_WITHHOLDING_TAX', 'DE_MINIMIS_BENEFITS'
    ));

CREATE TABLE "tax_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_employee_id" UUID NOT NULL,
  "taxable_compensation" NUMERIC(19,4) NOT NULL,
  "non_taxable_compensation" NUMERIC(19,4) NOT NULL,
  "withholding_tax" NUMERIC(19,4) NOT NULL,
  "rule_version_id" UUID NOT NULL,
  "year_to_date_snapshot" JSONB NOT NULL,
  CONSTRAINT "tax_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_lines_withholding_tax_check" CHECK ("withholding_tax" >= 0),
  CONSTRAINT "tax_lines_year_to_date_snapshot_check"
    CHECK (jsonb_typeof("year_to_date_snapshot") = 'object'),
  CONSTRAINT "tax_lines_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "tax_lines_payroll_employee_fkey"
    FOREIGN KEY ("agency_id", "payroll_employee_id")
    REFERENCES "payroll_employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "tax_lines_rule_version_fkey"
    FOREIGN KEY ("rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT,
  -- One Tax Line per result; the Agency joins the key for the result's foreign key.
  CONSTRAINT "tax_lines_payroll_employee_key" UNIQUE ("agency_id", "payroll_employee_id")
);

-- A Tax Line joins its result only in the transaction that writes the result,
-- and is never changed or deleted, like a Contribution Line (§9).
CREATE OR REPLACE FUNCTION guard_tax_line_insert()
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
    RAISE EXCEPTION 'A Tax Line joins its result only in the transaction that writes it'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tax_lines_insert_trigger"
  BEFORE INSERT ON "tax_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_tax_line_insert();

CREATE TRIGGER "tax_lines_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "tax_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- REVOKE first: the migrator's default privileges would give `hris_app` UPDATE.
REVOKE ALL ON TABLE "tax_lines" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "tax_lines" TO hris_app;

ALTER TABLE "tax_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tax_lines_select" ON "tax_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "tax_lines_insert" ON "tax_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- The tax as a Native Payroll Component (BRD PAY-004). It is unconditional,
-- so it needs no Agency Payroll Applicability and takes no Authorized Payroll
-- Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('WITHHOLDING_TAX', 'Withholding tax on compensation', 'DEDUCTION', false, false, false)
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tax_lines') THEN
    RAISE EXCEPTION 'Tax line forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('tax_lines_insert_trigger', 'tax_lines_immutable_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Tax line guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; tax lines
-- are retained payroll history.
-- Verification: pnpm db:policies tax_lines
