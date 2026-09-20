-- Leave Monetization: request lifecycle, credit certification, funding
-- determination, Payroll handoff posting, and approved adjustments.
--
-- The Payroll-owned tables at the end of this migration are phase-local input
-- storage for the Payroll port contract. They are replaced when the Payroll
-- module owns monetization earning inputs (#169).

CREATE TABLE "leave_monetization_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL,
  "current_version_id" uuid,
  "status" text NOT NULL
    CHECK ("status" IN (
      'DRAFT','SUBMITTED','CREDIT_CERTIFIED','NEEDS_INFORMATION',
      'FOR_APPROVAL','APPROVED','REJECTED','POSTED','WITHDRAWN','CANCELLED'
    )),
  "created_by_membership_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "leave_monetization_requests_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_requests_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_requests_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_monetization_request_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_request_id" uuid NOT NULL,
  "version_no" integer NOT NULL CHECK ("version_no" > 0),
  "kind" text NOT NULL CHECK ("kind" IN ('REGULAR','SPECIAL')),
  "approval_route_version_id" uuid NOT NULL,
  "approval_request_id" uuid NOT NULL,
  "form_template_document_version_id" uuid NOT NULL,
  "attestation_type" text NOT NULL
    CHECK ("attestation_type" IN ('AUTHENTICATED_SUBMISSION','SIGNED_DOCUMENT')),
  "attestation_document_version_id" uuid,
  "submitted_by_membership_id" uuid NOT NULL,
  "employee_attested_at" timestamptz,
  "reason" text,
  "authority_snapshot" jsonb NOT NULL,
  "submitted_at" timestamptz NOT NULL,
  CONSTRAINT "leave_monetization_versions_attestation_check" CHECK (
    (
      "attestation_type" = 'AUTHENTICATED_SUBMISSION'
      AND "employee_attested_at" IS NOT NULL
      AND "attestation_document_version_id" IS NULL
    )
    OR
    (
      "attestation_type" = 'SIGNED_DOCUMENT'
      AND "employee_attested_at" IS NULL
      AND "attestation_document_version_id" IS NOT NULL
    )
  ),
  CONSTRAINT "leave_monetization_versions_request_fkey"
    FOREIGN KEY ("agency_id", "monetization_request_id")
    REFERENCES "leave_monetization_requests"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_versions_route_fkey"
    FOREIGN KEY ("agency_id", "approval_route_version_id")
    REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_versions_approval_fkey"
    FOREIGN KEY ("agency_id", "approval_request_id")
    REFERENCES "approval_requests"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_versions_form_fkey"
    FOREIGN KEY ("agency_id", "form_template_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_versions_attestation_fkey"
    FOREIGN KEY ("agency_id", "attestation_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_versions_submitter_fkey"
    FOREIGN KEY ("agency_id", "submitted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_versions_number_key"
    UNIQUE ("monetization_request_id", "version_no"),
  CONSTRAINT "leave_monetization_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "leave_monetization_versions_approval_idx"
  ON "leave_monetization_request_versions" ("agency_id", "approval_request_id");

ALTER TABLE "leave_monetization_requests"
  ADD CONSTRAINT "leave_monetization_requests_current_version_fkey"
  FOREIGN KEY ("agency_id", "current_version_id")
  REFERENCES "leave_monetization_request_versions"("agency_id", "id") ON DELETE RESTRICT;

CREATE INDEX "leave_monetization_requests_employee_idx"
  ON "leave_monetization_requests" ("agency_id", "employee_id", "status");

CREATE TABLE "leave_monetization_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_request_version_id" uuid NOT NULL,
  "leave_account_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "requested_quantity" numeric(12,4) NOT NULL CHECK ("requested_quantity" > 0),
  "approved_quantity" numeric(12,4),
  CONSTRAINT "leave_monetization_allocations_approved_check" CHECK (
    "approved_quantity" IS NULL
    OR ("approved_quantity" >= 0 AND "approved_quantity" <= "requested_quantity")
  ),
  CONSTRAINT "leave_monetization_allocations_version_fkey"
    FOREIGN KEY ("agency_id", "monetization_request_version_id")
    REFERENCES "leave_monetization_request_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_allocations_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_allocations_policy_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_monetization_allocations_account_key"
    UNIQUE ("monetization_request_version_id", "leave_account_id"),
  CONSTRAINT "leave_monetization_allocations_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "monetization_eligibility_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_request_version_id" uuid NOT NULL,
  "result" text NOT NULL
    CHECK ("result" IN ('ELIGIBLE','INELIGIBLE','INDETERMINATE')),
  "balance_effective_date" date NOT NULL,
  "ledger_cutoff" timestamptz NOT NULL,
  "input_facts" jsonb NOT NULL,
  "rule_results" jsonb NOT NULL,
  "assessed_by_membership_id" uuid,
  "assessed_at" timestamptz NOT NULL,
  CONSTRAINT "monetization_assessments_version_fkey"
    FOREIGN KEY ("agency_id", "monetization_request_version_id")
    REFERENCES "leave_monetization_request_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_assessments_assessor_fkey"
    FOREIGN KEY ("agency_id", "assessed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_assessments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "monetization_assessments_version_idx"
  ON "monetization_eligibility_assessments" ("agency_id", "monetization_request_version_id", "assessed_at");

CREATE TABLE "monetization_credit_certifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_request_version_id" uuid NOT NULL,
  "eligibility_assessment_id" uuid NOT NULL,
  "certified_by_membership_id" uuid NOT NULL,
  "certified_at" timestamptz NOT NULL,
  CONSTRAINT "monetization_certifications_version_fkey"
    FOREIGN KEY ("agency_id", "monetization_request_version_id")
    REFERENCES "leave_monetization_request_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_certifications_assessment_fkey"
    FOREIGN KEY ("agency_id", "eligibility_assessment_id")
    REFERENCES "monetization_eligibility_assessments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_certifications_certifier_fkey"
    FOREIGN KEY ("agency_id", "certified_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_certifications_version_key"
    UNIQUE ("monetization_request_version_id"),
  CONSTRAINT "monetization_certifications_agency_version_key"
    UNIQUE ("agency_id", "monetization_request_version_id"),
  CONSTRAINT "monetization_certifications_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "monetization_credit_certification_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_credit_certification_id" uuid NOT NULL,
  "monetization_allocation_id" uuid NOT NULL,
  "leave_account_id" uuid NOT NULL,
  "posted_balance" numeric(12,4) NOT NULL,
  "other_active_commitments" numeric(12,4) NOT NULL
    CHECK ("other_active_commitments" >= 0),
  "certified_quantity" numeric(12,4) NOT NULL CHECK ("certified_quantity" > 0),
  "resulting_available_quantity" numeric(12,4) NOT NULL
    CHECK ("resulting_available_quantity" >= 0),
  "leave_credit_commitment_id" uuid NOT NULL,
  CONSTRAINT "monetization_certification_lines_cert_fkey"
    FOREIGN KEY ("agency_id", "monetization_credit_certification_id")
    REFERENCES "monetization_credit_certifications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_certification_lines_allocation_fkey"
    FOREIGN KEY ("agency_id", "monetization_allocation_id")
    REFERENCES "leave_monetization_allocations"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_certification_lines_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_certification_lines_commitment_fkey"
    FOREIGN KEY ("agency_id", "leave_credit_commitment_id")
    REFERENCES "leave_credit_commitments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_certification_lines_account_key"
    UNIQUE ("monetization_credit_certification_id", "leave_account_id"),
  CONSTRAINT "monetization_certification_lines_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "monetization_funding_determinations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_request_version_id" uuid NOT NULL,
  "result" text NOT NULL
    CHECK ("result" IN ('SUPPORTED','UNSUPPORTED','INDETERMINATE')),
  "fiscal_authority_document_version_id" uuid NOT NULL,
  "funding_source_snapshot" jsonb NOT NULL,
  "evidence_snapshot" jsonb NOT NULL,
  "reviewed_by_membership_id" uuid NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  CONSTRAINT "monetization_funding_version_fkey"
    FOREIGN KEY ("agency_id", "monetization_request_version_id")
    REFERENCES "leave_monetization_request_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_funding_authority_fkey"
    FOREIGN KEY ("agency_id", "fiscal_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_funding_reviewer_fkey"
    FOREIGN KEY ("agency_id", "reviewed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_funding_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "monetization_funding_version_idx"
  ON "monetization_funding_determinations" ("agency_id", "monetization_request_version_id", "reviewed_at");

CREATE TABLE "monetization_postings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_request_version_id" uuid NOT NULL,
  "posting_key" citext NOT NULL CHECK (btrim("posting_key"::text) <> ''),
  "valuation_date" date NOT NULL,
  "calculator_kind" citext NOT NULL CHECK (btrim("calculator_kind"::text) <> ''),
  "factor" numeric(12,7) NOT NULL CHECK ("factor" > 0),
  "payroll_input_id" uuid NOT NULL,
  "payroll_result" jsonb NOT NULL,
  "posted_by_membership_id" uuid NOT NULL,
  "posted_at" timestamptz NOT NULL,
  CONSTRAINT "monetization_postings_version_fkey"
    FOREIGN KEY ("agency_id", "monetization_request_version_id")
    REFERENCES "leave_monetization_request_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_postings_poster_fkey"
    FOREIGN KEY ("agency_id", "posted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_postings_key_key" UNIQUE ("agency_id", "posting_key"),
  CONSTRAINT "monetization_postings_version_key"
    UNIQUE ("monetization_request_version_id"),
  CONSTRAINT "monetization_postings_agency_version_key"
    UNIQUE ("agency_id", "monetization_request_version_id"),
  CONSTRAINT "monetization_postings_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "monetization_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_posting_id" uuid NOT NULL,
  "scope" text NOT NULL CHECK ("scope" IN ('WHOLE','PARTIAL')),
  "reason" text NOT NULL CHECK (btrim("reason") <> ''),
  "approval_route_version_id" uuid NOT NULL,
  "approval_request_id" uuid NOT NULL,
  "status" text NOT NULL
    CHECK ("status" IN (
      'DRAFT','FOR_APPROVAL','APPROVED','APPLIED',
      'REJECTED','BLOCKED','RETRYABLE'
    )),
  "payroll_adjustment_input_id" uuid,
  "owner_result" jsonb,
  "applied_at" timestamptz,
  CONSTRAINT "monetization_adjustments_applied_check"
    CHECK (("status" = 'APPLIED') = ("applied_at" IS NOT NULL)),
  CONSTRAINT "monetization_adjustments_posting_fkey"
    FOREIGN KEY ("agency_id", "monetization_posting_id")
    REFERENCES "monetization_postings"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_adjustments_route_fkey"
    FOREIGN KEY ("agency_id", "approval_route_version_id")
    REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_adjustments_approval_fkey"
    FOREIGN KEY ("agency_id", "approval_request_id")
    REFERENCES "approval_requests"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_adjustments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "monetization_adjustments_posting_idx"
  ON "monetization_adjustments" ("agency_id", "monetization_posting_id", "status");

CREATE TABLE "monetization_adjustment_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_adjustment_id" uuid NOT NULL,
  "original_ledger_entry_id" uuid NOT NULL,
  "retained_quantity" numeric(12,4) NOT NULL CHECK ("retained_quantity" >= 0),
  "reversal_ledger_entry_id" uuid,
  "replacement_ledger_entry_id" uuid,
  CONSTRAINT "monetization_adjustment_lines_adjustment_fkey"
    FOREIGN KEY ("agency_id", "monetization_adjustment_id")
    REFERENCES "monetization_adjustments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_adjustment_lines_original_fkey"
    FOREIGN KEY ("agency_id", "original_ledger_entry_id")
    REFERENCES "leave_ledger_entries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_adjustment_lines_reversal_fkey"
    FOREIGN KEY ("agency_id", "reversal_ledger_entry_id")
    REFERENCES "leave_ledger_entries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_adjustment_lines_replacement_fkey"
    FOREIGN KEY ("agency_id", "replacement_ledger_entry_id")
    REFERENCES "leave_ledger_entries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "monetization_adjustment_lines_original_key"
    UNIQUE ("monetization_adjustment_id", "original_ledger_entry_id"),
  CONSTRAINT "monetization_adjustment_lines_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "payroll_monetization_earning_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL,
  "source_type" citext NOT NULL CHECK (btrim("source_type"::text) <> ''),
  "source_id" uuid NOT NULL,
  "source_version_key" citext NOT NULL CHECK (btrim("source_version_key"::text) <> ''),
  "status" text NOT NULL
    CHECK ("status" IN ('PENDING','CONSUMED','CANCELLED','SUPERSEDED')),
  "quantity" numeric(12,4) NOT NULL CHECK ("quantity" > 0),
  "amount" numeric(19,4) NOT NULL CHECK ("amount" >= 0),
  "effective_date" date NOT NULL,
  "valuation_date" date NOT NULL,
  "calculator_kind" citext NOT NULL CHECK (btrim("calculator_kind"::text) <> ''),
  "factor" numeric(12,7) NOT NULL CHECK ("factor" > 0),
  "salary_source_snapshot" jsonb NOT NULL,
  "rounding_snapshot" jsonb NOT NULL,
  "calculation_snapshot" jsonb NOT NULL,
  "payload_snapshot" jsonb NOT NULL,
  "supersedes_input_id" uuid,
  "created_by_membership_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_monetization_inputs_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_monetization_inputs_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_input_id")
    REFERENCES "payroll_monetization_earning_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_monetization_inputs_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_monetization_inputs_source_key"
    UNIQUE ("agency_id", "source_type", "source_id", "source_version_key"),
  CONSTRAINT "payroll_monetization_inputs_successor_key"
    UNIQUE ("agency_id", "supersedes_input_id"),
  CONSTRAINT "payroll_monetization_inputs_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "payroll_monetization_inputs_employee_idx"
  ON "payroll_monetization_earning_inputs" ("agency_id", "employee_id", "status");

CREATE TABLE "payroll_monetization_adjustment_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "monetization_adjustment_id" uuid NOT NULL,
  "earning_input_id" uuid NOT NULL,
  "result" text NOT NULL
    CHECK ("result" IN ('ACCEPTED','REJECTED','RETRYABLE_FAILURE')),
  "linked_input_id" uuid,
  "payload_snapshot" jsonb NOT NULL,
  "recorded_by_membership_id" uuid NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_monetization_outcomes_adjustment_fkey"
    FOREIGN KEY ("agency_id", "monetization_adjustment_id")
    REFERENCES "monetization_adjustments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_monetization_outcomes_input_fkey"
    FOREIGN KEY ("agency_id", "earning_input_id")
    REFERENCES "payroll_monetization_earning_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_monetization_outcomes_linked_fkey"
    FOREIGN KEY ("agency_id", "linked_input_id")
    REFERENCES "payroll_monetization_earning_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_monetization_outcomes_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_monetization_outcomes_adjustment_key"
    UNIQUE ("monetization_adjustment_id"),
  CONSTRAINT "payroll_monetization_outcomes_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE OR REPLACE FUNCTION guard_leave_monetization_request_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Monetization Requests are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Leave Monetization Request identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IS DISTINCT FROM NEW."status" THEN
    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED','CANCELLED'))
      OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('CREDIT_CERTIFIED','NEEDS_INFORMATION','WITHDRAWN'))
      OR (OLD."status" = 'CREDIT_CERTIFIED' AND NEW."status" IN ('FOR_APPROVAL','NEEDS_INFORMATION','WITHDRAWN'))
      OR (OLD."status" = 'NEEDS_INFORMATION' AND NEW."status" IN ('SUBMITTED','WITHDRAWN'))
      OR (OLD."status" = 'FOR_APPROVAL' AND NEW."status" IN ('APPROVED','REJECTED','WITHDRAWN'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('POSTED','CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'Invalid Leave Monetization Request transition from % to %',
        OLD."status", NEW."status"
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_monetization_allocation_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Monetization Allocations are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."monetization_request_version_id" IS DISTINCT FROM NEW."monetization_request_version_id"
    OR OLD."leave_account_id" IS DISTINCT FROM NEW."leave_account_id"
    OR OLD."policy_version_id" IS DISTINCT FROM NEW."policy_version_id"
    OR OLD."requested_quantity" IS DISTINCT FROM NEW."requested_quantity" THEN
    RAISE EXCEPTION 'Leave Monetization Allocation identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."approved_quantity" IS NOT NULL
    AND (NEW."approved_quantity" IS NULL OR NEW."approved_quantity" > OLD."approved_quantity") THEN
    RAISE EXCEPTION 'Approved Leave Monetization quantities may only narrow'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_monetization_adjustment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Monetization Adjustments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."monetization_posting_id" IS DISTINCT FROM NEW."monetization_posting_id"
    OR OLD."scope" IS DISTINCT FROM NEW."scope"
    OR OLD."reason" IS DISTINCT FROM NEW."reason"
    OR OLD."approval_route_version_id" IS DISTINCT FROM NEW."approval_route_version_id"
    OR OLD."approval_request_id" IS DISTINCT FROM NEW."approval_request_id" THEN
    RAISE EXCEPTION 'Monetization Adjustment identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IS DISTINCT FROM NEW."status" THEN
    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('FOR_APPROVAL','REJECTED'))
      OR (OLD."status" = 'FOR_APPROVAL' AND NEW."status" IN ('APPROVED','REJECTED','BLOCKED','RETRYABLE'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('APPLIED','BLOCKED','RETRYABLE'))
      OR (OLD."status" = 'RETRYABLE' AND NEW."status" IN ('APPLIED','BLOCKED'))
    ) THEN
      RAISE EXCEPTION 'Invalid Monetization Adjustment transition from % to %',
        OLD."status", NEW."status"
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_monetization_adjustment_line_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Monetization Adjustment Lines are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."monetization_adjustment_id" IS DISTINCT FROM NEW."monetization_adjustment_id"
    OR OLD."original_ledger_entry_id" IS DISTINCT FROM NEW."original_ledger_entry_id"
    OR OLD."retained_quantity" IS DISTINCT FROM NEW."retained_quantity" THEN
    RAISE EXCEPTION 'Monetization Adjustment Line identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."reversal_ledger_entry_id" IS NOT NULL
    AND OLD."reversal_ledger_entry_id" IS DISTINCT FROM NEW."reversal_ledger_entry_id" THEN
    RAISE EXCEPTION 'Monetization Adjustment Line reversal is immutable once recorded'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."replacement_ledger_entry_id" IS NOT NULL
    AND OLD."replacement_ledger_entry_id" IS DISTINCT FROM NEW."replacement_ledger_entry_id" THEN
    RAISE EXCEPTION 'Monetization Adjustment Line replacement is immutable once recorded'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_payroll_monetization_input_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Monetization Earning Inputs are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."source_type" IS DISTINCT FROM NEW."source_type"
    OR OLD."source_id" IS DISTINCT FROM NEW."source_id"
    OR OLD."source_version_key" IS DISTINCT FROM NEW."source_version_key"
    OR OLD."quantity" IS DISTINCT FROM NEW."quantity"
    OR OLD."amount" IS DISTINCT FROM NEW."amount"
    OR OLD."effective_date" IS DISTINCT FROM NEW."effective_date"
    OR OLD."valuation_date" IS DISTINCT FROM NEW."valuation_date"
    OR OLD."calculator_kind" IS DISTINCT FROM NEW."calculator_kind"
    OR OLD."factor" IS DISTINCT FROM NEW."factor"
    OR OLD."salary_source_snapshot" IS DISTINCT FROM NEW."salary_source_snapshot"
    OR OLD."rounding_snapshot" IS DISTINCT FROM NEW."rounding_snapshot"
    OR OLD."calculation_snapshot" IS DISTINCT FROM NEW."calculation_snapshot"
    OR OLD."payload_snapshot" IS DISTINCT FROM NEW."payload_snapshot"
    OR OLD."supersedes_input_id" IS DISTINCT FROM NEW."supersedes_input_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Payroll Monetization Earning Input facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IS DISTINCT FROM NEW."status" THEN
    IF NOT (
      (OLD."status" = 'PENDING' AND NEW."status" IN ('CONSUMED','CANCELLED','SUPERSEDED'))
    ) THEN
      RAISE EXCEPTION 'Invalid Payroll Monetization Earning Input transition from % to %',
        OLD."status", NEW."status"
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_monetization_immutable_record()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% records are retained and cannot be deleted', TG_ARGV[0]
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION '% records are immutable', TG_ARGV[0]
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "leave_monetization_requests_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_monetization_requests"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_monetization_request_mutation();
CREATE TRIGGER "leave_monetization_versions_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "leave_monetization_request_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_immutable_record('Leave Monetization Request Version');
CREATE TRIGGER "leave_monetization_allocations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_monetization_allocations"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_monetization_allocation_mutation();
CREATE TRIGGER "monetization_assessments_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "monetization_eligibility_assessments"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_immutable_record('Monetization Eligibility Assessment');
CREATE TRIGGER "monetization_certifications_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "monetization_credit_certifications"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_immutable_record('Monetization Credit Certification');
CREATE TRIGGER "monetization_certification_lines_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "monetization_credit_certification_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_immutable_record('Monetization Credit Certification Line');
CREATE TRIGGER "monetization_funding_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "monetization_funding_determinations"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_immutable_record('Monetization Funding Determination');
CREATE TRIGGER "monetization_postings_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "monetization_postings"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_immutable_record('Monetization Posting');
CREATE TRIGGER "monetization_adjustments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "monetization_adjustments"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_adjustment_mutation();
CREATE TRIGGER "monetization_adjustment_lines_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "monetization_adjustment_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_adjustment_line_mutation();
CREATE TRIGGER "payroll_monetization_inputs_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_monetization_earning_inputs"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_monetization_input_mutation();
CREATE TRIGGER "payroll_monetization_outcomes_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_monetization_adjustment_outcomes"
  FOR EACH ROW EXECUTE FUNCTION guard_monetization_immutable_record('Payroll Monetization Adjustment Outcome');

GRANT SELECT, INSERT, UPDATE ON TABLE "leave_monetization_requests" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_monetization_request_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "leave_monetization_allocations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "monetization_eligibility_assessments" TO hris_app;
GRANT SELECT, INSERT ON TABLE "monetization_credit_certifications" TO hris_app;
GRANT SELECT, INSERT ON TABLE "monetization_credit_certification_lines" TO hris_app;
GRANT SELECT, INSERT ON TABLE "monetization_funding_determinations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "monetization_postings" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "monetization_adjustments" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "monetization_adjustment_lines" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "payroll_monetization_earning_inputs" TO hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_monetization_adjustment_outcomes" TO hris_app;

ALTER TABLE "leave_monetization_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_monetization_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_monetization_request_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_monetization_request_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_monetization_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_monetization_allocations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "monetization_eligibility_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monetization_eligibility_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "monetization_credit_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monetization_credit_certifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "monetization_credit_certification_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monetization_credit_certification_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "monetization_funding_determinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monetization_funding_determinations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "monetization_postings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monetization_postings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "monetization_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monetization_adjustments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "monetization_adjustment_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monetization_adjustment_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_monetization_earning_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_monetization_earning_inputs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_monetization_adjustment_outcomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_monetization_adjustment_outcomes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "leave_monetization_requests_select" ON "leave_monetization_requests"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_monetization_requests_insert" ON "leave_monetization_requests"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_monetization_requests_update" ON "leave_monetization_requests"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_monetization_versions_select" ON "leave_monetization_request_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_monetization_versions_insert" ON "leave_monetization_request_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_monetization_allocations_select" ON "leave_monetization_allocations"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_monetization_allocations_insert" ON "leave_monetization_allocations"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_monetization_allocations_update" ON "leave_monetization_allocations"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "monetization_assessments_select" ON "monetization_eligibility_assessments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "monetization_assessments_insert" ON "monetization_eligibility_assessments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "monetization_certifications_select" ON "monetization_credit_certifications"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "monetization_certifications_insert" ON "monetization_credit_certifications"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "monetization_certification_lines_select" ON "monetization_credit_certification_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "monetization_certification_lines_insert" ON "monetization_credit_certification_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "monetization_funding_select" ON "monetization_funding_determinations"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "monetization_funding_insert" ON "monetization_funding_determinations"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "monetization_postings_select" ON "monetization_postings"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "monetization_postings_insert" ON "monetization_postings"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "monetization_adjustments_select" ON "monetization_adjustments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "monetization_adjustments_insert" ON "monetization_adjustments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "monetization_adjustments_update" ON "monetization_adjustments"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "monetization_adjustment_lines_select" ON "monetization_adjustment_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "monetization_adjustment_lines_insert" ON "monetization_adjustment_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "monetization_adjustment_lines_update" ON "monetization_adjustment_lines"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "payroll_monetization_inputs_select" ON "payroll_monetization_earning_inputs"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_monetization_inputs_insert" ON "payroll_monetization_earning_inputs"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_monetization_inputs_update" ON "payroll_monetization_earning_inputs"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "payroll_monetization_outcomes_select" ON "payroll_monetization_adjustment_outcomes"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_monetization_outcomes_insert" ON "payroll_monetization_adjustment_outcomes"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.monetization.create', 'leave', 'MEDIUM', 'Create Leave Monetization Requests'),
  ('leave.monetization.submit', 'leave', 'HIGH', 'Submit or Resubmit Leave Monetization Requests'),
  ('leave.monetization.certify', 'leave', 'HIGH', 'Certify Monetization Eligibility and Credits'),
  ('leave.monetization.return', 'leave', 'HIGH', 'Return or Deny Monetization Eligibility'),
  ('leave.monetization.review_funding', 'leave', 'HIGH', 'Determine Monetization Funding Support'),
  ('leave.monetization.approve', 'leave', 'CRITICAL', 'Approve Monetization Allocations'),
  ('leave.monetization.reject', 'leave', 'CRITICAL', 'Reject Monetization Requests'),
  ('leave.monetization.post', 'leave', 'CRITICAL', 'Post Monetization Credits to Payroll'),
  ('leave.monetization.adjust', 'leave', 'CRITICAL', 'Create and Apply Monetization Adjustments'),
  ('leave.monetization.cancel', 'leave', 'HIGH', 'Cancel Draft or Approved Monetization Requests'),
  ('leave.monetization.withdraw', 'leave', 'MEDIUM', 'Withdraw Submitted Monetization Requests')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.monetization.create', 'leave.monetization.submit',
  'leave.monetization.cancel', 'leave.monetization.withdraw',
  'leave.monetization.post'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.monetization.create', 'leave.monetization.submit',
  'leave.monetization.cancel', 'leave.monetization.withdraw'
)
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.monetization.certify', 'leave.monetization.return'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'personnel_records_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.monetization.review_funding'
WHERE r."code" = 'budget_officer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.monetization.approve', 'leave.monetization.reject',
  'leave.monetization.adjust', 'leave.monetization.cancel'
)
WHERE r."code" IN ('appointing_authority', 'agency_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- The owning domain resolves and submits the bound Approval Route snapshot on
-- behalf of the submitting and funding-review actors.
INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'approvals.routes.read', 'approvals.requests.read',
  'approvals.requests.create', 'approvals.requests.submit',
  'approvals.requests.cancel'
)
WHERE r."code" IN ('personnel_records_officer', 'budget_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.leave_monetization_requests') IS NULL
    OR to_regclass('public.leave_monetization_request_versions') IS NULL
    OR to_regclass('public.leave_monetization_allocations') IS NULL
    OR to_regclass('public.monetization_eligibility_assessments') IS NULL
    OR to_regclass('public.monetization_credit_certifications') IS NULL
    OR to_regclass('public.monetization_credit_certification_lines') IS NULL
    OR to_regclass('public.monetization_funding_determinations') IS NULL
    OR to_regclass('public.monetization_postings') IS NULL
    OR to_regclass('public.monetization_adjustments') IS NULL
    OR to_regclass('public.monetization_adjustment_lines') IS NULL THEN
    RAISE EXCEPTION 'Leave Monetization table verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'monetization_certifications_version_key'
  ) THEN
    RAISE EXCEPTION 'Monetization Certification single-version verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_monetization_inputs_source_key'
  ) THEN
    RAISE EXCEPTION 'Payroll Monetization Input idempotency verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'leave_monetization_versions_approval_idx'
  ) THEN
    RAISE EXCEPTION 'Monetization Approval binding index verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'leave_monetization_requests'::regclass
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Leave Monetization RLS verification failed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.monetization.create') THEN
    RAISE EXCEPTION 'Leave Monetization create permission verification failed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.monetization.adjust') THEN
    RAISE EXCEPTION 'Leave Monetization adjust permission verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee' AND p."code" = 'leave.monetization.submit'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'Employee Leave Monetization submit grant verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'personnel_records_officer' AND p."code" = 'leave.monetization.certify'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Personnel Records Officer certification grant verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'budget_officer' AND p."code" = 'leave.monetization.review_funding'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Budget Officer funding grant verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'appointing_authority' AND p."code" = 'leave.monetization.approve'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Appointing Authority approval grant verification failed';
  END IF;
END;
$$;
