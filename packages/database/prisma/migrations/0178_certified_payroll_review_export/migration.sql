-- Phase 9 Certified Payroll Review Export (#636), as payroll-schema.md §12
-- has it. A Payroll Export Contract Version is a platform-wide, immutable
-- definition of one payroll Structured Export. A Certified Payroll Review
-- Export is the immutable, checksummed artifact of one Payroll Certification:
-- its Classified Payroll Export Lines and its Payroll Export Reconciliation,
-- as canonical JSON. Revoking the certification supersedes it, and nothing
-- else changes (#29).

CREATE TABLE "payroll_export_contract_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_export_contract_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_export_contract_versions_code_check" CHECK (btrim("code") <> ''),
  CONSTRAINT "payroll_export_contract_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "payroll_export_contract_versions_code_version_key" UNIQUE ("code", "version")
);

-- A contract version is immutable: a semantic or structural change is a
-- successor version, so a historical artifact keeps the definition it used.
CREATE OR REPLACE FUNCTION reject_payroll_export_contract_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION 'Payroll Export Contract Versions are immutable; add a successor version instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "payroll_export_contract_versions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_export_contract_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_export_contract_version_mutation();

-- Platform-wide, like the rule catalogue (ADR 0013): the grant is the
-- protection, and only a migration adds a version.
REVOKE ALL ON TABLE "payroll_export_contract_versions" FROM hris_app;
GRANT SELECT ON TABLE "payroll_export_contract_versions" TO hris_app;

INSERT INTO "payroll_export_contract_versions" ("code", "version", "definition")
VALUES (
  'CERTIFIED_PAYROLL_REVIEW_EXPORT', 1,
  $definition$
{
  "title": "Certified Payroll Review Export",
  "purpose": "Budget and accounting review of one certified payroll snapshot before payroll approval (#29).",
  "statement": "This Structured Export is HRIS payroll data from one certified payroll snapshot. It does not assert that funds were validated or obligated, that an accounting entry was posted, or that a receiving system accepted the data.",
  "format": "UTF-8 JSON with object keys sorted at every depth and no insignificant whitespace. Amounts are decimal strings with four decimal places. Dates are YYYY-MM-DD; times are ISO 8601 UTC.",
  "checksum": "SHA-256, in lowercase hex, of the exact content bytes.",
  "fields": {
    "contract": "This contract's code and version.",
    "statement": "The statement above, verbatim.",
    "agencyId": "The Agency whose payroll this is.",
    "payrollPeriod": "The Payroll Period: id, code, runType, periodFrom, periodTo, paymentDate.",
    "certification": "The Payroll Certification in force: id, calculationVersion, calculationHash, certifiedAt.",
    "classifiedLines": "The Classified Payroll Export Lines, in lineNo order.",
    "classifiedLines[].lineNo": "1-based position, ordered by payComponentCode, then componentKind.",
    "classifiedLines[].payComponentCode": "The pay component's catalogue code.",
    "classifiedLines[].payComponentName": "The pay component's catalogue name.",
    "classifiedLines[].componentKind": "EARNING, DEDUCTION, EMPLOYER_SHARE, or INFORMATIONAL: the component's category, which every source line of it carries.",
    "classifiedLines[].payrollEffect": "ADDS, SUBTRACTS, or NONE: how the amount affects employee net pay. It is not a debit or a credit.",
    "classifiedLines[].reportingCategory": "The component's reporting category, or null when the catalogue records none.",
    "classifiedLines[].amount": "The sum of its source Payroll Lines' amounts.",
    "classifiedLines[].sourceLineCount": "How many source Payroll Lines it sums.",
    "reconciliation": "The Payroll Export Reconciliation: resultCount, sourceLineCount, classifiedSourceLineCount, grossAmount, totalDeductions, netAmount, employerShareAmount, informationalAmount."
  },
  "classification": "One classified line per pay component and component kind, summed over every Payroll Line of the certified calculation version's Payroll Employee Results. This version classifies by pay component, component kind, and reporting category only: a Payroll Line does not yet carry a funding, organization, or cost-center reference of its own.",
  "controlRules": [
    "The source is exactly the Payroll Employee Results and Payroll Lines of the certified calculation version.",
    "The results' calculation hash equals the certification's.",
    "Every source line maps to exactly one classified line: the classified lines' sourceLineCount sums to sourceLineCount, and their amounts sum to the source lines' amounts by component kind.",
    "Every source line's line type equals its pay component's category.",
    "Each result's earning lines sum to its gross amount, its deduction lines to its total deductions, and gross less deductions equals its net amount.",
    "grossAmount, totalDeductions, and netAmount equal the sums over the results; employerShareAmount and informationalAmount equal the sums over the source lines of those kinds.",
    "A reconciliation failure blocks generation; nothing is stored."
  ]
}
  $definition$::jsonb
);

CREATE TABLE "certified_payroll_review_exports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "payroll_certification_id" UUID NOT NULL,
  "payroll_export_contract_version_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "superseded_at" TIMESTAMPTZ(6),
  CONSTRAINT "certified_payroll_review_exports_pkey" PRIMARY KEY ("id"),
  -- The checksum is of the exact bytes stored, so neither can drift.
  CONSTRAINT "certified_payroll_review_exports_checksum_check"
    CHECK ("checksum" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CONSTRAINT "certified_payroll_review_exports_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "certified_payroll_review_exports_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "certified_payroll_review_exports_certification_fkey"
    FOREIGN KEY ("agency_id", "payroll_certification_id")
    REFERENCES "payroll_certifications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "certified_payroll_review_exports_contract_version_fkey"
    FOREIGN KEY ("payroll_export_contract_version_id")
    REFERENCES "payroll_export_contract_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "certified_payroll_review_exports_generated_by_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One export per certification: generating again returns it.
  CONSTRAINT "certified_payroll_review_exports_certification_key"
    UNIQUE ("payroll_certification_id"),
  CONSTRAINT "certified_payroll_review_exports_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A period has at most one current export.
CREATE UNIQUE INDEX "certified_payroll_review_exports_one_current_key"
  ON "certified_payroll_review_exports" ("payroll_period_id")
  WHERE "superseded_at" IS NULL;

CREATE INDEX "certified_payroll_review_exports_period_idx"
  ON "certified_payroll_review_exports" ("agency_id", "payroll_period_id");

-- An export is written only for the certification in force on its period,
-- while the period is CERTIFIED or APPROVED at the certified version. It is
-- never deleted, and afterwards only its supersession is recorded, once.
CREATE OR REPLACE FUNCTION guard_certified_payroll_review_export_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Certified Payroll Review Exports are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."superseded_at" IS NOT NULL OR NOT EXISTS (
      SELECT 1
      FROM "payroll_certifications" c
      JOIN "payroll_periods" p
        ON p."agency_id" = c."agency_id" AND p."id" = c."payroll_period_id"
      WHERE c."agency_id" = NEW."agency_id"
        AND c."id" = NEW."payroll_certification_id"
        AND c."payroll_period_id" = NEW."payroll_period_id"
        AND c."revoked_at" IS NULL
        AND p."status" IN ('CERTIFIED', 'APPROVED')
        AND p."calculation_version" = c."calculation_version"
    ) THEN
      RAISE EXCEPTION 'A Certified Payroll Review Export is generated only from the certification in force on its period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'superseded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at')
     OR OLD."superseded_at" IS NOT NULL OR NEW."superseded_at" IS NULL THEN
    RAISE EXCEPTION 'A Certified Payroll Review Export changes only to record its supersession, once'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "certified_payroll_review_exports_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "certified_payroll_review_exports"
  FOR EACH ROW EXECUTE FUNCTION guard_certified_payroll_review_export_mutation();

REVOKE ALL ON TABLE "certified_payroll_review_exports" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "certified_payroll_review_exports" TO hris_app;
GRANT UPDATE ("superseded_at") ON TABLE "certified_payroll_review_exports" TO hris_app;

ALTER TABLE "certified_payroll_review_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certified_payroll_review_exports" FORCE ROW LEVEL SECURITY;

CREATE POLICY "certified_payroll_review_exports_select" ON "certified_payroll_review_exports"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "certified_payroll_review_exports_insert" ON "certified_payroll_review_exports"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "certified_payroll_review_exports_update" ON "certified_payroll_review_exports"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'certified_payroll_review_exports' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Certified Payroll Review Export forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('certified_payroll_review_exports_mutation_trigger',
                     'payroll_export_contract_versions_immutable_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Payroll export mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; contract
-- versions and exports are retained payroll history.
-- Verification: pnpm db:policies certified_payroll_review_exports
