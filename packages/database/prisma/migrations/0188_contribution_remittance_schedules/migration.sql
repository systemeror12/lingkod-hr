-- Phase 9 contribution remittance schedules and summary (#354), as
-- payroll-schema.md §12 has it. From one FINALIZED payroll, a Contribution
-- Summary and one Remittance Schedule for each of GSIS, PhilHealth, Pag-IBIG,
-- and Employees' Compensation: Structured Exports for review (PAY-009, #617).
-- None is a filing or a remittance, and none follows an issuer's format
-- (PAY-010).
--
-- Each artifact is canonical JSON stored as `content`, with its SHA-256 as
-- `checksum` and a CHECK that keeps the two together, as migration 0178 does.
-- A schedule's line count and share totals are columns, and its insert guard
-- proves them equal to the period's Contribution Lines of its type.
--
-- A voided payroll's supersession of its outputs comes with the void
-- transaction; a period has at most one summary here.

INSERT INTO "payroll_export_contract_versions" ("code", "version", "definition")
VALUES (
  'CONTRIBUTION_REMITTANCE', 1,
  $definition$
{
  "title": "Contribution Remittance Schedules and Summary",
  "purpose": "Review of one finalized Appointed Personnel payroll's GSIS, PhilHealth, Pag-IBIG, and Employees' Compensation contributions, the Employee's share and the Agency's share as employer (PAY-009).",
  "statement": "This Structured Export is HRIS payroll data from one finalized payroll, for review. It is not a filing or a remittance, does not claim that any contribution was filed, remitted, or received, and does not follow the format of GSIS, PhilHealth, Pag-IBIG, or any other issuer.",
  "artifacts": {
    "schedule": "One REMITTANCE_SCHEDULE per contribution type: one line per Contribution Line of that type in the finalized results, and the schedule's totals.",
    "summary": "One CONTRIBUTION_SUMMARY: for each contribution type, its schedule's id, checksum, line count, and Employee and Agency share totals, then the totals over every type."
  },
  "format": "Canonical JSON: UTF-8, object keys sorted at every depth, no insignificant whitespace. Amounts are PHP as four-place decimal strings, as the Contribution Lines store them. Dates are YYYY-MM-DD. Timestamps are RFC 3339 in UTC.",
  "checksum": "SHA-256, in lowercase hex, of each artifact's exact bytes.",
  "contributionTypes": ["GSIS", "PHILHEALTH", "PAGIBIG", "EMPLOYEES_COMPENSATION"],
  "scheduleLineFields": {
    "contributionLineId": "The Contribution Line.",
    "payrollEmployeeId": "The FINALIZED Payroll Employee Result it belongs to.",
    "agencyEmployeeNumber": "The Employee's agency employee number.",
    "employeeName": "The Employee's legal name.",
    "compensationBase": "The base the calculation applied the rule version's rates to.",
    "employeeShare": "The Employee's share, deducted from pay. Zero for Employees' Compensation.",
    "employerShare": "The Agency's share as employer, which never reduces pay.",
    "totalShare": "employeeShare plus employerShare.",
    "ruleVersion": "The National Payroll Rule Version the share was calculated by: its id and code."
  },
  "lineOrder": "By agencyEmployeeNumber, then payrollEmployeeId.",
  "controlRules": [
    "Only a FINALIZED payroll produces the schedules and summary, from the FINALIZED results of its finalized calculation version.",
    "Every Contribution Line of those results appears on exactly one schedule, the one of its type.",
    "A schedule's lineCount, employeeShareTotal, and employerShareTotal equal the count and sums of its lines, and its total is their sum.",
    "The summary's totals equal the sums of its schedules' totals.",
    "A contribution type with no line has a schedule with no lines and zero totals.",
    "The artifacts carry no government identifier and no form number, form title, or issuer layout."
  ]
}
  $definition$::jsonb
);

CREATE TABLE "contribution_summaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "payroll_export_contract_version_id" UUID NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  CONSTRAINT "contribution_summaries_pkey" PRIMARY KEY ("id"),
  -- The checksum is of the exact bytes stored, so neither can drift.
  CONSTRAINT "contribution_summaries_checksum_check"
    CHECK ("checksum" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CONSTRAINT "contribution_summaries_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_summaries_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_summaries_contract_version_fkey"
    FOREIGN KEY ("payroll_export_contract_version_id")
    REFERENCES "payroll_export_contract_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "contribution_summaries_generated_by_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One summary per period: generating again returns it.
  CONSTRAINT "contribution_summaries_period_key" UNIQUE ("payroll_period_id"),
  CONSTRAINT "contribution_summaries_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "remittance_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "contribution_summary_id" UUID NOT NULL,
  "contribution_type" TEXT NOT NULL,
  "line_count" INTEGER NOT NULL,
  "employee_share_total" DECIMAL(19,4) NOT NULL,
  "employer_share_total" DECIMAL(19,4) NOT NULL,
  "total_amount" DECIMAL(19,4) NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  CONSTRAINT "remittance_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "remittance_schedules_contribution_type_check"
    CHECK ("contribution_type" IN ('GSIS', 'PHILHEALTH', 'PAGIBIG', 'EMPLOYEES_COMPENSATION')),
  CONSTRAINT "remittance_schedules_line_count_check" CHECK ("line_count" >= 0),
  CONSTRAINT "remittance_schedules_total_check"
    CHECK ("total_amount" = "employee_share_total" + "employer_share_total"),
  -- Employees' Compensation is employer-only (migration 0163).
  CONSTRAINT "remittance_schedules_employees_compensation_check"
    CHECK ("contribution_type" <> 'EMPLOYEES_COMPENSATION' OR "employee_share_total" = 0),
  CONSTRAINT "remittance_schedules_checksum_check"
    CHECK ("checksum" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CONSTRAINT "remittance_schedules_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "remittance_schedules_summary_fkey"
    FOREIGN KEY ("agency_id", "contribution_summary_id")
    REFERENCES "contribution_summaries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "remittance_schedules_summary_type_key"
    UNIQUE ("contribution_summary_id", "contribution_type"),
  CONSTRAINT "remittance_schedules_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A summary is written only for a FINALIZED period at its finalized version,
-- and is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_contribution_summary_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Contribution Summaries are immutable and retained'
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
    RAISE EXCEPTION 'A Contribution Summary is generated only from a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "contribution_summaries_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "contribution_summaries"
  FOR EACH ROW EXECUTE FUNCTION guard_contribution_summary_mutation();

-- A summary commits with a schedule of every contribution type, so none is
-- silently missing.
CREATE OR REPLACE FUNCTION require_contribution_summary_schedules()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF (
    SELECT count(*) FROM "remittance_schedules" s
    WHERE s."agency_id" = NEW."agency_id" AND s."contribution_summary_id" = NEW."id"
  ) <> 4 THEN
    RAISE EXCEPTION 'A Contribution Summary has one Remittance Schedule for each of GSIS, PHILHEALTH, PAGIBIG, and EMPLOYEES_COMPENSATION'
      USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "contribution_summaries_schedules_trigger"
  AFTER INSERT ON "contribution_summaries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION require_contribution_summary_schedules();

-- A schedule is written only in the transaction that writes its summary. Its
-- line count and share totals are exactly those of the Contribution Lines of
-- its type in the FINALIZED results of the summary's period and version. It
-- is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_remittance_schedule_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  source RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Remittance Schedules are immutable and retained'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "contribution_summaries" s
    WHERE s."agency_id" = NEW."agency_id"
      AND s."id" = NEW."contribution_summary_id"
      AND s."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Remittance Schedule is written only with its new Contribution Summary'
      USING ERRCODE = '55000';
  END IF;
  SELECT count(c."id") AS "line_count",
         COALESCE(sum(c."employee_share"), 0) AS "employee_share_total",
         COALESCE(sum(c."employer_share"), 0) AS "employer_share_total"
  INTO source
  FROM "contribution_summaries" s
  JOIN "payroll_employees" e
    ON e."agency_id" = s."agency_id"
   AND e."payroll_period_id" = s."payroll_period_id"
   AND e."calculation_version" = s."calculation_version"
   AND e."status" = 'FINALIZED'
  JOIN "contribution_lines" c
    ON c."agency_id" = e."agency_id"
   AND c."payroll_employee_id" = e."id"
   AND c."contribution_type" = NEW."contribution_type"
  WHERE s."agency_id" = NEW."agency_id" AND s."id" = NEW."contribution_summary_id";
  IF source."line_count" <> NEW."line_count"
     OR source."employee_share_total" <> NEW."employee_share_total"
     OR source."employer_share_total" <> NEW."employer_share_total" THEN
    RAISE EXCEPTION 'A Remittance Schedule''s totals equal the Contribution Lines of its type in its finalized payroll'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "remittance_schedules_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "remittance_schedules"
  FOR EACH ROW EXECUTE FUNCTION guard_remittance_schedule_mutation();

REVOKE ALL ON TABLE "contribution_summaries" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "contribution_summaries" TO hris_app;
REVOKE ALL ON TABLE "remittance_schedules" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "remittance_schedules" TO hris_app;

ALTER TABLE "contribution_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contribution_summaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contribution_summaries_select" ON "contribution_summaries"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "contribution_summaries_insert" ON "contribution_summaries"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "remittance_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remittance_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "remittance_schedules_select" ON "remittance_schedules"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "remittance_schedules_insert" ON "remittance_schedules"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- hris-controls.md §6.10 lists `payroll.registers.generate` for the payroll
-- outputs; #12's story 10 has the Payroll Preparer produce the register and
-- the remittance schedules with it. Another output's migration may seed the
-- same permission, so both inserts skip what exists.
INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.registers.generate', 'payroll', 'MEDIUM',
  'Generate and read the registers, remittance schedules, and summaries of a FINALIZED Payroll Period'
)
ON CONFLICT ("code") DO NOTHING;

-- §6.10 marks it A for the Payroll Preparer, the HR Certifier, the Budget
-- Officer, the Accounting Reviewer, the Payroll Approver, and the Cashier.
-- The HR Admin's C is agency-configurable and the Auditor's R has no
-- read-only form of this permission yet, so neither is seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.registers.generate'
WHERE r."code" IN ('payroll_preparer', 'hr_certifier', 'budget_officer',
                   'accounting_reviewer', 'payroll_approver', 'cashier')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" IN ('payroll_preparer', 'hr_certifier', 'budget_officer',
                       'accounting_reviewer', 'payroll_approver', 'cashier')
      AND p."code" = 'payroll.registers.generate'
  ) <> 6 THEN
    RAISE EXCEPTION 'Payroll register permission grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_class
    WHERE relname IN ('contribution_summaries', 'remittance_schedules') AND relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Contribution remittance forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('contribution_summaries_mutation_trigger',
                     'contribution_summaries_schedules_trigger',
                     'remittance_schedules_mutation_trigger')
  ) <> 3 THEN
    RAISE EXCEPTION 'Contribution remittance mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; the
-- summaries and schedules are retained payroll history.
-- Verification: pnpm db:policies contribution_summaries; pnpm db:policies
-- remittance_schedules
