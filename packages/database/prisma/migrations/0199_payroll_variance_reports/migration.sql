-- Phase 9 Payroll Variance and Exception Report (#645), as payroll-schema.md
-- §12 has it. From one FINALIZED payroll, a Structured Export for review
-- (PAY-009, #617) that compares the payroll with its prior comparable period
-- by Employee and component, and lists the period's Payroll Exceptions with
-- their decisions and Payroll Holds.
--
-- The report is canonical JSON stored as `content`, with its SHA-256 as
-- `checksum` and a CHECK that keeps the two together, as migration 0188 does.
-- A voided payroll's supersession of its outputs comes with the void
-- transaction; a period has at most one report here.

INSERT INTO "payroll_export_contract_versions" ("code", "version", "definition")
VALUES (
  'PAYROLL_VARIANCE_EXCEPTION_REPORT', 1,
  $definition$
{
  "title": "Payroll Variance and Exception Report",
  "purpose": "Review of one finalized Appointed Personnel payroll against its prior comparable period, by Employee and component, and of the period's payroll exceptions and their decisions (PAY-009).",
  "statement": "This Structured Export is HRIS payroll data from one finalized payroll, for review. It compares the payroll with its prior comparable period and lists the period's payroll exceptions; it changes, acknowledges, or resolves nothing, and follows no external form.",
  "format": "Canonical JSON: UTF-8, object keys sorted at every depth, no insignificant whitespace. Amounts are PHP as four-place decimal strings, as the Payroll Lines store them. Dates are YYYY-MM-DD. Timestamps are RFC 3339 in UTC.",
  "checksum": "SHA-256, in lowercase hex, of the report's exact bytes.",
  "priorComparablePeriod": "The Agency's last FINALIZED REGULAR Payroll Period before this one by period start, the period the net pay variance check compares against (#623). A SPECIAL period has none.",
  "variance": {
    "COMPARED": "priorComparablePeriod names the period; employees lists each Employee whose net pay or any component differs between the two periods' FINALIZED results.",
    "NO_PRIOR_COMPARABLE_PERIOD": "reason says why nothing is compared. No difference is listed, and none is implied."
  },
  "employeeFields": {
    "agencyEmployeeNumber": "The Employee's agency employee number.",
    "employeeName": "The Employee's legal name at generation.",
    "inPriorPeriod": "Whether the Employee has a result in the prior comparable period.",
    "inThisPeriod": "Whether the Employee has a result in this period.",
    "priorNetAmount": "Net pay in the prior comparable period, or null with no result there.",
    "netAmount": "Net pay in this period, or null with no result here.",
    "netDifference": "netAmount minus priorNetAmount, counting null as zero.",
    "components": "Each component and line type whose amount differs: priorAmount and currentAmount, each the sum of that result's lines or null with no such line, and their difference."
  },
  "exceptionFields": {
    "calculationVersion": "The calculation version the exception was raised on; the report lists every version's.",
    "decision": "null while OPEN; otherwise the reason and the deciding membership of the acknowledgement or resolution.",
    "holds": "Each Payroll Hold placed on the exception, with its reason and when it was placed and lifted."
  },
  "order": "Employees by agencyEmployeeNumber, then employeeId; components by componentCode, then lineType; exceptions by calculationVersion, then agencyEmployeeNumber with period-wide ones first, then exceptionType.",
  "controlRules": [
    "Only a FINALIZED payroll produces the report, from the FINALIZED results of its finalized calculation version and those of its prior comparable period.",
    "An absent value is null, never zero, so a new Employee or a removed component reads as absent.",
    "A period without a prior comparable period reports NO_PRIOR_COMPARABLE_PERIOD, never zero variance.",
    "The report carries no government identifier and no form number, form title, or issuer layout."
  ]
}
  $definition$::jsonb
);

CREATE TABLE "payroll_variance_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "payroll_export_contract_version_id" UUID NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  CONSTRAINT "payroll_variance_reports_pkey" PRIMARY KEY ("id"),
  -- The checksum is of the exact bytes stored, so neither can drift.
  CONSTRAINT "payroll_variance_reports_checksum_check"
    CHECK ("checksum" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CONSTRAINT "payroll_variance_reports_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_variance_reports_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_variance_reports_contract_version_fkey"
    FOREIGN KEY ("payroll_export_contract_version_id")
    REFERENCES "payroll_export_contract_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_variance_reports_generated_by_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One report per period: generating again returns it.
  CONSTRAINT "payroll_variance_reports_period_key" UNIQUE ("payroll_period_id"),
  CONSTRAINT "payroll_variance_reports_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A report is written only for a FINALIZED period at its finalized version,
-- and is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_payroll_variance_report_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payroll Variance Reports are immutable and retained'
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
    RAISE EXCEPTION 'A Payroll Variance Report is generated only from a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_variance_reports_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_variance_reports"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_variance_report_mutation();

REVOKE ALL ON TABLE "payroll_variance_reports" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_variance_reports" TO hris_app;

ALTER TABLE "payroll_variance_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_variance_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payroll_variance_reports_select" ON "payroll_variance_reports"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_variance_reports_insert" ON "payroll_variance_reports"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- `payroll.registers.generate` generates the report. #12's story 10 has the
-- Payroll Preparer produce the register, variance report, and remittance
-- schedules with it, and migration 0187 seeds it for the roles
-- hris-controls.md §6.10 marks A.

DO $$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'payroll_variance_reports') THEN
    RAISE EXCEPTION 'Payroll variance report forced RLS verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_variance_reports_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Payroll variance report mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; the reports
-- are retained payroll history.
-- Verification: pnpm db:policies payroll_variance_reports
