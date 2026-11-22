-- Phase 9 tax summary, loan remittance summary, and deduction register (#646),
-- as payroll-schema.md §12 has them. From one FINALIZED payroll, three
-- Structured Exports for review (PAY-009, #617). None is a BIR form, return,
-- or filing, and none is a remittance to any payee (PAY-010).
--
-- One row per period holds the three artifacts, each canonical JSON with its
-- SHA-256 and a CHECK that keeps the two together, as migration 0188 does.
-- Each artifact's line count and totals are columns, and the insert guard
-- proves them equal to the period's Tax Lines, Loan Deduction Lines, and
-- DEDUCTION Payroll Lines.
--
-- A voided payroll's supersession of its outputs comes with the void
-- transaction; a period has at most one row here.

INSERT INTO "payroll_export_contract_versions" ("code", "version", "definition")
VALUES (
  'DEDUCTION_SUMMARIES', 1,
  $definition$
{
  "title": "Tax Summary, Loan Remittance Summary, and Deduction Register",
  "purpose": "Review of one finalized Appointed Personnel payroll's withholding tax, its loan and authorized deductions by payee, and every deduction it made (PAY-009).",
  "statement": "This Structured Export is HRIS payroll data from one finalized payroll, for review. It is not a BIR form, return, certificate, or filing, and not a remittance to any payee. It does not claim that any tax or deduction was filed, remitted, or received, and does not follow the format of the BIR or any other issuer.",
  "artifacts": {
    "taxSummary": "One TAX_SUMMARY: one line per Tax Line in the finalized results, and the totals.",
    "loanRemittanceSummary": "One LOAN_REMITTANCE_SUMMARY: one group per payee of the Deduction Obligations applied, each with one line per Loan Deduction Line and its totals, then the totals over every payee.",
    "deductionRegister": "One DEDUCTION_REGISTER: for each Employee, one line per DEDUCTION Payroll Line and their totals; then each pay component's line count and total; then the totals."
  },
  "format": "Canonical JSON: UTF-8, object keys sorted at every depth, no insignificant whitespace. Amounts are PHP as four-place decimal strings, as the source lines store them. Dates are YYYY-MM-DD. Timestamps are RFC 3339 in UTC.",
  "checksum": "SHA-256, in lowercase hex, of each artifact's exact bytes.",
  "taxLineFields": {
    "taxLineId": "The Tax Line.",
    "payrollEmployeeId": "The FINALIZED Payroll Employee Result it belongs to.",
    "agencyEmployeeNumber": "The Employee's agency employee number.",
    "employeeName": "The Employee's legal name.",
    "taxableCompensation": "The taxable compensation, regular and supplementary, the calculation taxed.",
    "nonTaxableCompensation": "The non-taxable earnings, excluded benefits, and excluded contribution shares.",
    "withholdingTax": "The tax withheld. Negative only for a year-end adjustment's refund.",
    "yearEndAdjustment": "YEAR_END or SEPARATION when the line is a year-end adjustment; null otherwise.",
    "ruleVersion": "The National Payroll Rule Version the tax was calculated by: its id and code."
  },
  "payee": "A payee is a Deduction Obligation's payee category and payee name, the name compared without regard to case. Its payeeName is the first of its spellings in code-unit order.",
  "loanLineFields": {
    "loanDeductionLineId": "The Loan Deduction Line.",
    "deductionObligationId": "The Deduction Obligation it applied.",
    "issuerReference": "The obligation's issuer reference.",
    "payrollEmployeeId": "The FINALIZED Payroll Employee Result it belongs to.",
    "agencyEmployeeNumber": "The Employee's agency employee number.",
    "employeeName": "The Employee's legal name.",
    "amountDue": "What the obligation was due in the period.",
    "deductedAmount": "What was deducted from pay.",
    "notDeductedAmount": "What the net-take-home floor stopped; it stays owed."
  },
  "deductionLineFields": {
    "payrollLineId": "The DEDUCTION Payroll Line.",
    "componentCode": "Its pay component's code.",
    "componentName": "Its pay component's name.",
    "amount": "The amount deducted. Negative for a refund or a correction's difference.",
    "payrollAdjustmentId": "The Payroll Adjustment the line carries, or null."
  },
  "lineOrder": "Tax lines by agencyEmployeeNumber, then payrollEmployeeId. Payees by payee category, then payee name compared without case; each payee's lines by agencyEmployeeNumber, payrollEmployeeId, then issuerReference. Register Employees by agencyEmployeeNumber, then payrollEmployeeId; their lines and the components by componentCode.",
  "controlRules": [
    "Only a FINALIZED payroll produces the artifacts, from the FINALIZED results of its finalized calculation version.",
    "Every Tax Line of those results appears once on the tax summary, and its totals are the count and sums of those lines.",
    "Every Loan Deduction Line of those results appears once, under its obligation's payee; each payee's totals and the summary's totals are the count and sums of their lines, and amountDueTotal is deductedTotal plus notDeductedTotal.",
    "Every DEDUCTION Payroll Line of those results appears once on the register; each Employee's, each component's, and the register's totals are the count and sum of their lines.",
    "A payroll with no line of a kind has that artifact with no lines and zero totals.",
    "The artifacts carry no government identifier, such as a TIN, and no form number, form title, or issuer layout."
  ]
}
  $definition$::jsonb
);

CREATE TABLE "deduction_summaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "payroll_export_contract_version_id" UUID NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "tax_summary_content" TEXT NOT NULL,
  "tax_summary_checksum" TEXT NOT NULL,
  "tax_line_count" INTEGER NOT NULL,
  "taxable_compensation_total" DECIMAL(19,4) NOT NULL,
  "non_taxable_compensation_total" DECIMAL(19,4) NOT NULL,
  "withholding_tax_total" DECIMAL(19,4) NOT NULL,
  "loan_remittance_content" TEXT NOT NULL,
  "loan_remittance_checksum" TEXT NOT NULL,
  "loan_line_count" INTEGER NOT NULL,
  "loan_amount_due_total" DECIMAL(19,4) NOT NULL,
  "loan_deducted_total" DECIMAL(19,4) NOT NULL,
  "loan_not_deducted_total" DECIMAL(19,4) NOT NULL,
  "deduction_register_content" TEXT NOT NULL,
  "deduction_register_checksum" TEXT NOT NULL,
  "deduction_line_count" INTEGER NOT NULL,
  "deduction_total" DECIMAL(19,4) NOT NULL,
  CONSTRAINT "deduction_summaries_pkey" PRIMARY KEY ("id"),
  -- Each checksum is of the exact bytes stored, so neither can drift.
  CONSTRAINT "deduction_summaries_tax_summary_checksum_check"
    CHECK ("tax_summary_checksum" = encode(sha256(convert_to("tax_summary_content", 'UTF8')), 'hex')),
  CONSTRAINT "deduction_summaries_loan_remittance_checksum_check"
    CHECK ("loan_remittance_checksum" = encode(sha256(convert_to("loan_remittance_content", 'UTF8')), 'hex')),
  CONSTRAINT "deduction_summaries_deduction_register_checksum_check"
    CHECK ("deduction_register_checksum" = encode(sha256(convert_to("deduction_register_content", 'UTF8')), 'hex')),
  CONSTRAINT "deduction_summaries_line_count_check"
    CHECK ("tax_line_count" >= 0 AND "loan_line_count" >= 0 AND "deduction_line_count" >= 0),
  CONSTRAINT "deduction_summaries_loan_total_check"
    CHECK ("loan_amount_due_total" = "loan_deducted_total" + "loan_not_deducted_total"),
  CONSTRAINT "deduction_summaries_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_summaries_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_summaries_contract_version_fkey"
    FOREIGN KEY ("payroll_export_contract_version_id")
    REFERENCES "payroll_export_contract_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "deduction_summaries_generated_by_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One row per period: generating again returns it.
  CONSTRAINT "deduction_summaries_period_key" UNIQUE ("payroll_period_id"),
  CONSTRAINT "deduction_summaries_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A row is written only for a FINALIZED period at its finalized version, and
-- only when each artifact's count and totals equal the source lines of that
-- version's FINALIZED results. It is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_deduction_summary_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  tax RECORD;
  loan RECORD;
  deduction RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Deduction Summaries are immutable and retained'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."status" = 'FINALIZED'
      AND p."calculation_version" = NEW."calculation_version"
  ) THEN
    RAISE EXCEPTION 'A Deduction Summary is generated only from a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(t."id") AS "line_count",
         COALESCE(sum(t."taxable_compensation"), 0) AS "taxable",
         COALESCE(sum(t."non_taxable_compensation"), 0) AS "non_taxable",
         COALESCE(sum(t."withholding_tax"), 0) AS "withholding"
  INTO tax
  FROM "payroll_employees" e
  JOIN "tax_lines" t ON t."agency_id" = e."agency_id" AND t."payroll_employee_id" = e."id"
  WHERE e."agency_id" = NEW."agency_id"
    AND e."payroll_period_id" = NEW."payroll_period_id"
    AND e."calculation_version" = NEW."calculation_version"
    AND e."status" = 'FINALIZED';
  IF tax."line_count" <> NEW."tax_line_count"
     OR tax."taxable" <> NEW."taxable_compensation_total"
     OR tax."non_taxable" <> NEW."non_taxable_compensation_total"
     OR tax."withholding" <> NEW."withholding_tax_total" THEN
    RAISE EXCEPTION 'A Tax Summary''s totals equal the Tax Lines of its finalized payroll'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(l."id") AS "line_count",
         COALESCE(sum(l."amount_due"), 0) AS "due",
         COALESCE(sum(l."deducted_amount"), 0) AS "deducted",
         COALESCE(sum(l."not_deducted_amount"), 0) AS "not_deducted"
  INTO loan
  FROM "payroll_employees" e
  JOIN "loan_deduction_lines" l
    ON l."agency_id" = e."agency_id" AND l."payroll_employee_id" = e."id"
  WHERE e."agency_id" = NEW."agency_id"
    AND e."payroll_period_id" = NEW."payroll_period_id"
    AND e."calculation_version" = NEW."calculation_version"
    AND e."status" = 'FINALIZED';
  IF loan."line_count" <> NEW."loan_line_count"
     OR loan."due" <> NEW."loan_amount_due_total"
     OR loan."deducted" <> NEW."loan_deducted_total"
     OR loan."not_deducted" <> NEW."loan_not_deducted_total" THEN
    RAISE EXCEPTION 'A Loan Remittance Summary''s totals equal the Loan Deduction Lines of its finalized payroll'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(l."id") AS "line_count", COALESCE(sum(l."amount"), 0) AS "amount"
  INTO deduction
  FROM "payroll_employees" e
  JOIN "payroll_lines" l
    ON l."agency_id" = e."agency_id"
   AND l."payroll_employee_id" = e."id"
   AND l."line_type" = 'DEDUCTION'
  WHERE e."agency_id" = NEW."agency_id"
    AND e."payroll_period_id" = NEW."payroll_period_id"
    AND e."calculation_version" = NEW."calculation_version"
    AND e."status" = 'FINALIZED';
  IF deduction."line_count" <> NEW."deduction_line_count"
     OR deduction."amount" <> NEW."deduction_total" THEN
    RAISE EXCEPTION 'A Deduction Register''s totals equal the DEDUCTION Payroll Lines of its finalized payroll'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "deduction_summaries_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "deduction_summaries"
  FOR EACH ROW EXECUTE FUNCTION guard_deduction_summary_mutation();

REVOKE ALL ON TABLE "deduction_summaries" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "deduction_summaries" TO hris_app;

ALTER TABLE "deduction_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deduction_summaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "deduction_summaries_select" ON "deduction_summaries"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "deduction_summaries_insert" ON "deduction_summaries"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- `payroll.registers.generate` generates and reads these artifacts, as it
-- does the register and the contribution remittance schedules (#12 story 10;
-- migrations 0187 and 0188). No grant changes.

DO $$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'deduction_summaries') THEN
    RAISE EXCEPTION 'Deduction summary forced RLS verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'deduction_summaries_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Deduction summary mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; the
-- summaries are retained payroll history.
-- Verification: pnpm db:policies deduction_summaries
