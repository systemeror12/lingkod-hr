-- Phase 9 Finalized Payroll Accounting Support Export (#355), as
-- payroll-schema.md §12 has it. The export is the immutable, checksummed
-- Structured Export of one FINALIZED payroll for downstream accounting
-- support (#29). It reuses what migration 0178 built: a Payroll Export
-- Contract Version, the Classified Payroll Export Lines, and the Payroll
-- Export Reconciliation. Its Employee Detail Companion is generated and
-- reconciled with it, stored beside it with its own checksum, and read only
-- with its own permission.
--
-- A Payroll Export External Outcome is append-only evidence an authorized
-- user records by hand: a handoff, or an externally evidenced receipt,
-- return, or posting. Neither generating nor downloading the export records
-- one, and an outcome never changes the export.
--
-- A voided payroll's supersession of its export (#643) comes later; a period
-- has at most one export here.

INSERT INTO "payroll_export_contract_versions" ("code", "version", "definition")
VALUES (
  'FINALIZED_PAYROLL_ACCOUNTING_SUPPORT_EXPORT', 1,
  $definition$
{
  "title": "Finalized Payroll Accounting Support Export",
  "purpose": "Downstream accounting support from one immutable finalized payroll result (#29).",
  "statement": "This Structured Export is HRIS payroll data from one finalized payroll result, for accounting support. It is not a journal entry and claims no debit, credit, or posting. Neither generating nor downloading it records that a receiving system received, accepted, or posted it.",
  "artifacts": {
    "export": "The export: classified totals only, with no employee-level detail.",
    "employeeDetail": "The Employee Detail Companion: the same source, one entry per Payroll Employee Result. It is read only with its own permission, and its totals equal the export's."
  },
  "format": "UTF-8 JSON with object keys sorted at every depth and no insignificant whitespace. Amounts are decimal strings with four decimal places. Dates are YYYY-MM-DD; times are ISO 8601 UTC.",
  "checksum": "SHA-256, in lowercase hex, of each artifact's exact bytes.",
  "fields": {
    "contract": "This contract's code and version.",
    "statement": "The statement above, verbatim.",
    "id": "The Finalized Payroll Accounting Support Export ID.",
    "agencyId": "The Agency whose payroll this is.",
    "payrollPeriod": "The finalized Payroll Period: id, code, runType, periodFrom, periodTo, paymentDate.",
    "finalization": "The finalized result: calculationVersion, calculationHash, payrollCertificationId, finalizedAt.",
    "classifiedLines": "The Classified Payroll Export Lines, in lineNo order, as CERTIFIED_PAYROLL_REVIEW_EXPORT version 1 defines them.",
    "reconciliation": "The Payroll Export Reconciliation: resultCount, sourceLineCount, classifiedSourceLineCount, grossAmount, totalDeductions, netAmount, employerShareAmount, informationalAmount.",
    "employeeDetailChecksum": "The checksum of the Employee Detail Companion, which ties the two artifacts."
  },
  "employeeDetailFields": {
    "contract": "This contract's code and version.",
    "statement": "The Employee Detail Companion's statement: employee-level detail of the named export, which asserts no more than the export does.",
    "accountingSupportExportId": "The export it accompanies.",
    "agencyId": "The Agency whose payroll this is.",
    "payrollPeriodId": "The finalized Payroll Period.",
    "finalization": "As in the export.",
    "employees": "One entry per Payroll Employee Result, ordered by employeeNumber, then payrollEmployeeId.",
    "employees[].payrollEmployeeId": "The Payroll Employee Result.",
    "employees[].employeeId": "The Employee.",
    "employees[].employeeNumber": "The agency employee number at generation.",
    "employees[].legalName": "The Employee's legal name at generation.",
    "employees[].grossAmount": "The result's gross amount.",
    "employees[].totalDeductions": "The result's total deductions.",
    "employees[].netAmount": "The result's net amount.",
    "employees[].lines": "The result's Classified Payroll Export Lines, classified as the export's are.",
    "totals": "classifiedLines and reconciliation summed over the employees, which equal the export's."
  },
  "classification": "As CERTIFIED_PAYROLL_REVIEW_EXPORT version 1: one classified line per pay component and component kind, summed over every Payroll Line of the finalized calculation version's Payroll Employee Results.",
  "controlRules": [
    "Only a FINALIZED payroll produces this export.",
    "The source is exactly the Payroll Employee Results and Payroll Lines of the finalized calculation version.",
    "The results' calculation hash equals the hash of the certification the payroll was finalized under.",
    "Every source line maps to exactly one classified line: the classified lines' sourceLineCount sums to sourceLineCount, and their amounts sum to the source lines' amounts by component kind.",
    "Every source line's line type equals its pay component's category.",
    "Each result's earning lines sum to its gross amount, its deduction lines to its total deductions, and gross less deductions equals its net amount.",
    "The Employee Detail Companion's totals equal the export's classifiedLines and reconciliation.",
    "A reconciliation failure blocks generation; nothing is stored.",
    "Downloading an artifact is not a Payroll Export External Outcome."
  ]
}
  $definition$::jsonb
);

CREATE TABLE "finalized_payroll_accounting_support_exports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "calculation_hash" TEXT NOT NULL,
  "payroll_export_contract_version_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "employee_detail_content" TEXT NOT NULL,
  "employee_detail_checksum" TEXT NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "finalized_payroll_accounting_support_exports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finalized_payroll_accounting_support_exports_hash_check"
    CHECK ("calculation_hash" ~ '^[0-9a-f]{64}$'),
  -- Each checksum is of the exact bytes stored, so neither can drift.
  CONSTRAINT "finalized_payroll_accounting_support_exports_checksum_check"
    CHECK ("checksum" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CONSTRAINT "finalized_payroll_accounting_support_exports_detail_checksum_check"
    CHECK ("employee_detail_checksum"
           = encode(sha256(convert_to("employee_detail_content", 'UTF8')), 'hex')),
  CONSTRAINT "finalized_payroll_accounting_support_exports_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "finalized_payroll_accounting_support_exports_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "finalized_payroll_accounting_support_exports_contract_version_fkey"
    FOREIGN KEY ("payroll_export_contract_version_id")
    REFERENCES "payroll_export_contract_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "finalized_payroll_accounting_support_exports_generated_by_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One export per period until a void supersedes it (#643): generating
  -- again returns it.
  CONSTRAINT "finalized_payroll_accounting_support_exports_period_key"
    UNIQUE ("payroll_period_id"),
  CONSTRAINT "finalized_payroll_accounting_support_exports_agency_id_id_key"
    UNIQUE ("agency_id", "id")
);

-- An export is written only for a FINALIZED period at its finalized version,
-- and is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_finalized_payroll_accounting_support_export_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Finalized Payroll Accounting Support Exports are immutable and retained'
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
    RAISE EXCEPTION 'A Finalized Payroll Accounting Support Export is generated only from a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "finalized_payroll_accounting_support_exports_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "finalized_payroll_accounting_support_exports"
  FOR EACH ROW EXECUTE FUNCTION guard_finalized_payroll_accounting_support_export_mutation();

CREATE TABLE "payroll_export_external_outcomes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "accounting_support_export_id" UUID NOT NULL,
  "outcome" TEXT NOT NULL,
  "external_reference" TEXT,
  "evidence_document_version_id" UUID,
  "reason" TEXT,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_export_external_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_export_external_outcomes_outcome_check"
    CHECK ("outcome" IN ('HANDED_OFF', 'RECEIVED', 'RETURNED', 'POSTED')),
  CONSTRAINT "payroll_export_external_outcomes_reference_check"
    CHECK ("external_reference" IS NULL OR btrim("external_reference") <> ''),
  -- A receipt, return, or posting is externally evidenced: it names the
  -- external reference and the External Evidence. A handoff may name either.
  CONSTRAINT "payroll_export_external_outcomes_evidence_check"
    CHECK ("outcome" = 'HANDED_OFF'
           OR ("external_reference" IS NOT NULL AND "evidence_document_version_id" IS NOT NULL)),
  -- A return gives its reason; nothing else does.
  CONSTRAINT "payroll_export_external_outcomes_reason_check"
    CHECK ((("outcome" = 'RETURNED') = ("reason" IS NOT NULL))
           AND ("reason" IS NULL OR btrim("reason") <> '')),
  CONSTRAINT "payroll_export_external_outcomes_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_export_external_outcomes_export_fkey"
    FOREIGN KEY ("agency_id", "accounting_support_export_id")
    REFERENCES "finalized_payroll_accounting_support_exports"("agency_id", "id")
    ON DELETE RESTRICT,
  CONSTRAINT "payroll_export_external_outcomes_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_export_external_outcomes_recorded_by_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE INDEX "payroll_export_external_outcomes_export_idx"
  ON "payroll_export_external_outcomes" ("agency_id", "accounting_support_export_id", "recorded_at");

-- Outcomes are append-only evidence: a later outcome is a new row.
CREATE OR REPLACE FUNCTION reject_payroll_export_external_outcome_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION 'Payroll Export External Outcomes are append-only; record a new outcome instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "payroll_export_external_outcomes_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_export_external_outcomes"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_export_external_outcome_mutation();

REVOKE ALL ON TABLE "finalized_payroll_accounting_support_exports" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "finalized_payroll_accounting_support_exports" TO hris_app;
REVOKE ALL ON TABLE "payroll_export_external_outcomes" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_export_external_outcomes" TO hris_app;

ALTER TABLE "finalized_payroll_accounting_support_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finalized_payroll_accounting_support_exports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "finalized_payroll_accounting_support_exports_select"
  ON "finalized_payroll_accounting_support_exports"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "finalized_payroll_accounting_support_exports_insert"
  ON "finalized_payroll_accounting_support_exports"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "payroll_export_external_outcomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_export_external_outcomes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payroll_export_external_outcomes_select" ON "payroll_export_external_outcomes"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_export_external_outcomes_insert" ON "payroll_export_external_outcomes"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('payroll.accounting_exports.generate', 'payroll', 'HIGH',
   'Generate the Finalized Payroll Accounting Support Export of a FINALIZED Payroll Period and download it'),
  ('payroll.export_detail.read', 'payroll', 'HIGH',
   'Download the Employee Detail Companion of a Finalized Payroll Accounting Support Export'),
  ('payroll.export_outcomes.record', 'payroll', 'HIGH',
   'Record a Payroll Export External Outcome against a Finalized Payroll Accounting Support Export')
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks the three A for the Accounting Reviewer only.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'payroll.accounting_exports.generate',
  'payroll.export_detail.read',
  'payroll.export_outcomes.record'
)
WHERE r."code" = 'accounting_reviewer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'accounting_reviewer'
      AND p."code" IN ('payroll.accounting_exports.generate',
                       'payroll.export_detail.read',
                       'payroll.export_outcomes.record')
  ) <> 3 THEN
    RAISE EXCEPTION 'Finalized Payroll Accounting Support Export permission grant verification failed';
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
    WHERE relname IN ('finalized_payroll_accounting_support_exports',
                      'payroll_export_external_outcomes')
      AND relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Finalized Payroll Accounting Support Export forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('finalized_payroll_accounting_support_exports_mutation_trigger',
                     'payroll_export_external_outcomes_immutable_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Finalized Payroll Accounting Support Export mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; exports and
-- their outcomes are retained payroll history.
-- Verification: pnpm db:policies finalized_payroll_accounting_support_exports;
-- pnpm db:policies payroll_export_external_outcomes
