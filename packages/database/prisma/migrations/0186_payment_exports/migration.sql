-- Phase 9 Payment Export (#337), as payroll-schema.md §12 has it. A Payment
-- Export is the provider-neutral, immutable, checksummed handoff of one
-- FINALIZED payroll (#28): one Payment Instruction per positive-net-pay
-- Payroll Employee Result, to the Employee's designated, effective, and
-- verified Payroll Bank Account, with the export's reconciliation controls.
--
-- The versioned UTF-8 CSV carries full account numbers, so it is not stored:
-- it is rendered from the export and instruction rows, and `checksum` is the
-- SHA-256 of its bytes, so a download proves it is the artifact first
-- generated. An instruction keeps no plaintext account number: it names the
-- destination, whose encrypted number migration 0059's guard keeps immutable,
-- and its mask. The reconciliation summary holds masked numbers only and is
-- stored as `summary_content`, with its checksum CHECKed like migration 0178.
--
-- Superseding exports and retries (#643) and Disbursement Outcomes (#642)
-- come later; a period has at most one export here.

INSERT INTO "payroll_export_contract_versions" ("code", "version", "definition")
VALUES (
  'PAYMENT_EXPORT', 1,
  $definition$
{
  "title": "Payment Export",
  "purpose": "Provider-neutral handoff of one finalized Appointed Personnel payroll's net pay to designated disbursement destinations (#28).",
  "statement": "This Payment Export is a provider-neutral handoff of one finalized payroll. It does not claim conformance to, acceptance by, or settlement through any bank or disbursement system, and it marks no one paid.",
  "artifacts": {
    "csv": "UTF-8 without a byte order mark, RFC 4180: one header row, then one row per Payment Instruction, every field double-quoted, CRLF line endings. It carries the complete destination details.",
    "summary": "UTF-8 plain text for people: the export's identity, its controls, its Payment Instructions with account identifiers masked except the last four characters, and the excluded results."
  },
  "format": "Amounts are PHP with two decimal places and no grouping separators. Dates are YYYY-MM-DD. Timestamps are RFC 3339 in UTC.",
  "checksum": "SHA-256, in lowercase hex, of each artifact's exact bytes.",
  "csvColumns": {
    "contract_code": "PAYMENT_EXPORT.",
    "contract_version": "1.",
    "payment_export_id": "The Payment Export ID.",
    "agency_id": "The Agency whose payroll this is.",
    "payroll_period_id": "The finalized Payroll Period.",
    "payroll_period_code": "Its code.",
    "payroll_run_type": "Its run type, REGULAR or SPECIAL.",
    "calculation_version": "The finalized calculation version.",
    "period_from": "The period's first date.",
    "period_to": "The period's last date.",
    "payment_date": "The period's payment date.",
    "currency": "PHP.",
    "generated_at": "When the export was generated.",
    "payment_instruction_id": "The Payment Instruction ID.",
    "payroll_employee_id": "The Payroll Employee Result it pays.",
    "agency_employee_number": "The Employee's agency employee number.",
    "payee_legal_name": "The Employee's legal name.",
    "destination_type": "BANK_ACCOUNT.",
    "institution_identifier_scheme": "AGENCY_BANK_CODE: the bank code the Payroll Bank Account records.",
    "institution_identifier": "That bank code, as opaque text.",
    "institution_name": "The institution as the HRIS records it. The HRIS keeps no bank catalogue, so version 1 repeats the bank code.",
    "account_identifier": "The account number, as opaque text with leading zeros preserved.",
    "account_holder_name": "The account name the Payroll Bank Account records.",
    "amount": "The result's net pay, greater than zero.",
    "payment_reference": "The period code and the agency employee number, joined by a hyphen."
  },
  "rowOrder": "By agency_employee_number, then payroll_employee_id.",
  "controls": {
    "sourceResultCount": "The FINALIZED Payroll Employee Results of the finalized calculation version.",
    "sourceNetTotal": "Their net total.",
    "instructionCount": "Payment Instructions: the results with positive net pay.",
    "instructionTotal": "Their total.",
    "excludedResultCount": "Results with zero or negative net pay, which produce no instruction.",
    "excludedResultTotal": "Their net total."
  },
  "controlRules": [
    "Only a FINALIZED payroll produces a Payment Export.",
    "Every positive-net-pay result has a designated Payroll Bank Account that is ACTIVE, verified, and effective on the generation date in Asia/Manila; a missing, ineffective, or unverified destination blocks the whole export.",
    "Each result's earning lines sum to its gross amount, its deduction lines to its total deductions, and gross less deductions equals its net amount.",
    "Each net amount is whole centavos; the export never rounds.",
    "sourceResultCount equals instructionCount plus excludedResultCount, and sourceNetTotal equals instructionTotal plus excludedResultTotal.",
    "Each instruction amount equals its result's net amount.",
    "A reconciliation failure blocks generation; nothing is stored.",
    "The export carries no component-level earning or deduction and no government identifier."
  ]
}
  $definition$::jsonb
);

CREATE TABLE "payment_exports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  -- The period's payment date at generation: unlike its code and dates,
  -- migration 0153's guard does not fix it.
  "payment_date" DATE NOT NULL,
  "payroll_export_contract_version_id" UUID NOT NULL,
  "currency" TEXT NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "checksum" TEXT NOT NULL,
  "summary_content" TEXT NOT NULL,
  "summary_checksum" TEXT NOT NULL,
  "source_result_count" INTEGER NOT NULL,
  "source_net_total" DECIMAL(19,2) NOT NULL,
  "instruction_count" INTEGER NOT NULL,
  "instruction_total" DECIMAL(19,2) NOT NULL,
  "excluded_result_count" INTEGER NOT NULL,
  "excluded_result_total" DECIMAL(19,2) NOT NULL,
  CONSTRAINT "payment_exports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_exports_currency_check" CHECK ("currency" = 'PHP'),
  CONSTRAINT "payment_exports_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  -- The summary's checksum is of the exact bytes stored, so neither can drift.
  CONSTRAINT "payment_exports_summary_checksum_check"
    CHECK ("summary_checksum" = encode(sha256(convert_to("summary_content", 'UTF8')), 'hex')),
  -- The controls account for every source result: none is silently omitted.
  CONSTRAINT "payment_exports_controls_check" CHECK (
    "instruction_count" >= 0 AND "excluded_result_count" >= 0
    AND "source_result_count" = "instruction_count" + "excluded_result_count"
    AND "instruction_total" >= 0 AND "excluded_result_total" <= 0
    AND "source_net_total" = "instruction_total" + "excluded_result_total"
  ),
  CONSTRAINT "payment_exports_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payment_exports_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payment_exports_contract_version_fkey"
    FOREIGN KEY ("payroll_export_contract_version_id")
    REFERENCES "payroll_export_contract_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "payment_exports_generated_by_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One export per period until superseding exports arrive (#643): generating
  -- again returns it.
  CONSTRAINT "payment_exports_period_key" UNIQUE ("payroll_period_id"),
  CONSTRAINT "payment_exports_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "payment_instructions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payment_export_id" UUID NOT NULL,
  "payroll_employee_id" UUID NOT NULL,
  "payroll_bank_account_id" UUID NOT NULL,
  "agency_employee_number" TEXT NOT NULL,
  "payee_legal_name" TEXT NOT NULL,
  "destination_type" TEXT NOT NULL,
  "institution_identifier_scheme" TEXT NOT NULL,
  "institution_identifier" TEXT NOT NULL,
  "institution_name" TEXT NOT NULL,
  "masked_account_identifier" TEXT NOT NULL,
  "account_holder_name" TEXT NOT NULL,
  "amount" DECIMAL(19,2) NOT NULL,
  "payment_reference" TEXT NOT NULL,
  CONSTRAINT "payment_instructions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_instructions_destination_type_check"
    CHECK ("destination_type" = 'BANK_ACCOUNT'),
  CONSTRAINT "payment_instructions_scheme_check"
    CHECK ("institution_identifier_scheme" = 'AGENCY_BANK_CODE'),
  CONSTRAINT "payment_instructions_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payment_instructions_text_check" CHECK (
    btrim("agency_employee_number") <> '' AND btrim("payee_legal_name") <> ''
    AND btrim("institution_identifier") <> '' AND btrim("institution_name") <> ''
    AND btrim("masked_account_identifier") <> '' AND btrim("account_holder_name") <> ''
    AND btrim("payment_reference") <> ''
  ),
  CONSTRAINT "payment_instructions_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payment_instructions_export_fkey"
    FOREIGN KEY ("agency_id", "payment_export_id")
    REFERENCES "payment_exports"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payment_instructions_payroll_employee_fkey"
    FOREIGN KEY ("agency_id", "payroll_employee_id")
    REFERENCES "payroll_employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payment_instructions_bank_account_fkey"
    FOREIGN KEY ("agency_id", "payroll_bank_account_id")
    REFERENCES "payroll_bank_accounts"("agency_id", "id") ON DELETE RESTRICT,
  -- One instruction per result in an export; split payments are outside the MVP.
  CONSTRAINT "payment_instructions_export_result_key"
    UNIQUE ("payment_export_id", "payroll_employee_id"),
  CONSTRAINT "payment_instructions_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "payment_instructions_payroll_employee_idx"
  ON "payment_instructions" ("agency_id", "payroll_employee_id");

-- An export is written only for a FINALIZED period at its finalized version,
-- and is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_payment_export_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payment Exports are immutable and retained'
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
    RAISE EXCEPTION 'A Payment Export is generated only from a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payment_exports_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payment_exports"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_export_mutation();

-- An instruction is written only in the transaction that writes its export.
-- It pays a FINALIZED result of the export's period and version exactly its
-- net, to that Employee's ACTIVE (so verified) Payroll Bank Account effective
-- today in Asia/Manila. It is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_payment_instruction_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payment Instructions are immutable and retained; a retry is a linked new instruction'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "payment_exports" x
    JOIN "payroll_employees" e
      ON e."agency_id" = x."agency_id"
     AND e."payroll_period_id" = x."payroll_period_id"
     AND e."calculation_version" = x."calculation_version"
    JOIN "payroll_bank_accounts" a
      ON a."agency_id" = e."agency_id" AND a."employee_id" = e."employee_id"
    WHERE x."agency_id" = NEW."agency_id"
      AND x."id" = NEW."payment_export_id"
      AND x."xmin" = pg_current_xact_id()::xid
      AND e."id" = NEW."payroll_employee_id"
      AND e."status" = 'FINALIZED'
      AND e."net_amount" = NEW."amount"
      AND a."id" = NEW."payroll_bank_account_id"
      AND a."status" = 'ACTIVE'
      AND a."effective_from" <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND (a."effective_to" IS NULL OR a."effective_to" >= (now() AT TIME ZONE 'Asia/Manila')::date)
  ) THEN
    RAISE EXCEPTION 'A Payment Instruction pays a FINALIZED result of its new export its net, to that Employee''s active, verified, effective Payroll Bank Account'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payment_instructions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payment_instructions"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_instruction_mutation();

REVOKE ALL ON TABLE "payment_exports" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payment_exports" TO hris_app;
REVOKE ALL ON TABLE "payment_instructions" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payment_instructions" TO hris_app;

ALTER TABLE "payment_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_exports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payment_exports_select" ON "payment_exports"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payment_exports_insert" ON "payment_exports"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "payment_instructions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_instructions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payment_instructions_select" ON "payment_instructions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payment_instructions_insert" ON "payment_instructions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.payment_exports.generate', 'payroll', 'HIGH',
  'Generate the Payment Export of a FINALIZED Payroll Period and download its CSV and reconciliation summary'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks `payroll.payment_exports.generate` A for the
-- Accounting Reviewer, the Payroll Approver, and the Cashier. The Payroll
-- Preparer's C is agency-configurable and the Auditor's R has no read-only
-- form of this permission yet, so neither is seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('cashier', 'Cashier', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.payment_exports.generate'
WHERE r."code" IN ('accounting_reviewer', 'payroll_approver', 'cashier')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" IN ('accounting_reviewer', 'payroll_approver', 'cashier')
      AND p."code" = 'payroll.payment_exports.generate'
  ) <> 3 THEN
    RAISE EXCEPTION 'Payment Export permission grant verification failed';
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
    WHERE relname IN ('payment_exports', 'payment_instructions') AND relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Payment Export forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payment_exports_mutation_trigger', 'payment_instructions_mutation_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Payment Export mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; Payment
-- Exports and their instructions are retained payroll history.
-- Verification: pnpm db:policies payment_exports; pnpm db:policies
-- payment_instructions
