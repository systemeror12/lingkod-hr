-- Phase 7 Leave Applications. A Leave Application is the stable case; each
-- submission or material resubmission freezes an immutable Leave Application
-- Version with its typed CS Form No. 6 facts, Leave Submission Attestation,
-- exact form and evidence Document Versions, accepted Leave Eligibility
-- Assessment, Leave Calculation Segments, and effective Approval Route
-- Version. Draft working data stays mutable until submission. Eligibility is
-- explainable and fails closed: a missing, ambiguous, conflicting, or
-- unsupported policy, schedule, holiday, document, route, or authority input
-- is recorded as an indeterminate fact instead of a favorable default.

CREATE TABLE "leave_applications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "draft_leave_type_id" UUID NOT NULL,
  "current_version_id" UUID,
  "draft_reason" TEXT,
  "draft_policy_details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "draft_commutation_choice" TEXT,
  "status" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_applications_commutation_choice_check"
    CHECK ("draft_commutation_choice" IN ('REQUESTED', 'NOT_REQUESTED')),
  CONSTRAINT "leave_applications_status_check"
    CHECK ("status" IN (
      'DRAFT','SUBMITTED','FOR_CERTIFICATION','FOR_RECOMMENDATION',
      'FOR_APPROVAL','APPROVED','REJECTED','NEEDS_INFORMATION',
      'WITHDRAWN','CANCEL_REQUESTED','CANCELLED','POSTED'
    )),
  CONSTRAINT "leave_applications_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_applications_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_applications_draft_leave_type_fkey"
    FOREIGN KEY ("agency_id", "draft_leave_type_id")
    REFERENCES "leave_types"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_applications_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_applications_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "leave_applications_status_idx"
  ON "leave_applications" ("agency_id", "status", "employee_id");

CREATE TABLE "leave_application_draft_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_application_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  CONSTRAINT "leave_application_draft_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_application_draft_periods_sequence_check"
    CHECK ("sequence_no" > 0),
  CONSTRAINT "leave_application_draft_periods_range_check"
    CHECK ("date_to" >= "date_from"),
  CONSTRAINT "leave_application_draft_periods_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_draft_periods_application_fkey"
    FOREIGN KEY ("agency_id", "leave_application_id")
    REFERENCES "leave_applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_draft_periods_sequence_key"
    UNIQUE ("leave_application_id", "sequence_no"),
  CONSTRAINT "leave_application_draft_periods_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_application_draft_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_application_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "purpose_code" CITEXT NOT NULL,
  CONSTRAINT "leave_application_draft_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_application_draft_documents_purpose_check"
    CHECK (length(btrim("purpose_code"::text)) > 0),
  CONSTRAINT "leave_application_draft_documents_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_draft_documents_application_fkey"
    FOREIGN KEY ("agency_id", "leave_application_id")
    REFERENCES "leave_applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_draft_documents_version_fkey"
    FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_draft_documents_link_key"
    UNIQUE ("leave_application_id", "document_version_id", "purpose_code"),
  CONSTRAINT "leave_application_draft_documents_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_application_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_application_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "leave_type_id" UUID NOT NULL,
  "accepted_assessment_id" UUID,
  "approval_route_version_id" UUID NOT NULL,
  "approval_request_id" UUID NOT NULL,
  "form_template_document_version_id" UUID NOT NULL,
  "attestation_type" TEXT NOT NULL,
  "attestation_document_version_id" UUID,
  "submitted_by_membership_id" UUID NOT NULL,
  "employee_attested_at" TIMESTAMPTZ(6),
  "submission_method" CITEXT NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "reason" TEXT,
  "policy_details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "commutation_choice" TEXT,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_application_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_application_versions_version_check"
    CHECK ("version_no" > 0),
  CONSTRAINT "leave_application_versions_attestation_type_check"
    CHECK ("attestation_type" IN (
      'AUTHENTICATED_SUBMISSION','SIGNED_DOCUMENT'
    )),
  CONSTRAINT "leave_application_versions_attestation_check"
    CHECK (
      ("attestation_type" = 'AUTHENTICATED_SUBMISSION'
        AND "attestation_document_version_id" IS NULL
        AND "employee_attested_at" IS NOT NULL)
      OR
      ("attestation_type" = 'SIGNED_DOCUMENT'
        AND "attestation_document_version_id" IS NOT NULL)
    ),
  CONSTRAINT "leave_application_versions_commutation_choice_check"
    CHECK ("commutation_choice" IN ('REQUESTED', 'NOT_REQUESTED')),
  CONSTRAINT "leave_application_versions_submission_method_check"
    CHECK (length(btrim("submission_method"::text)) > 0),
  CONSTRAINT "leave_application_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_application_fkey"
    FOREIGN KEY ("agency_id", "leave_application_id")
    REFERENCES "leave_applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_leave_type_fkey"
    FOREIGN KEY ("agency_id", "leave_type_id")
    REFERENCES "leave_types"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_route_version_fkey"
    FOREIGN KEY ("agency_id", "approval_route_version_id")
    REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_approval_request_fkey"
    FOREIGN KEY ("agency_id", "approval_request_id")
    REFERENCES "approval_requests"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_form_template_fkey"
    FOREIGN KEY ("agency_id", "form_template_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_attestation_document_fkey"
    FOREIGN KEY ("agency_id", "attestation_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_submitter_fkey"
    FOREIGN KEY ("agency_id", "submitted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_versions_version_key"
    UNIQUE ("leave_application_id", "version_no"),
  CONSTRAINT "leave_application_versions_request_key"
    UNIQUE ("approval_request_id"),
  CONSTRAINT "leave_application_versions_application_id_key"
    UNIQUE ("agency_id", "leave_application_id", "id"),
  CONSTRAINT "leave_application_versions_agency_id_key"
    UNIQUE ("agency_id", "id")
);

ALTER TABLE "leave_applications"
ADD CONSTRAINT "leave_applications_current_version_fkey"
FOREIGN KEY ("agency_id", "id", "current_version_id")
REFERENCES "leave_application_versions" (
  "agency_id", "leave_application_id", "id"
) ON DELETE RESTRICT;

CREATE TABLE "leave_application_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_application_version_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  CONSTRAINT "leave_application_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_application_periods_sequence_check"
    CHECK ("sequence_no" > 0),
  CONSTRAINT "leave_application_periods_range_check"
    CHECK ("date_to" >= "date_from"),
  CONSTRAINT "leave_application_periods_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_periods_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id")
    REFERENCES "leave_application_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_periods_sequence_key"
    UNIQUE ("leave_application_version_id", "sequence_no"),
  CONSTRAINT "leave_application_periods_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_application_version_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_application_version_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "purpose_code" CITEXT NOT NULL,
  CONSTRAINT "leave_application_version_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_application_version_documents_purpose_check"
    CHECK (length(btrim("purpose_code"::text)) > 0),
  CONSTRAINT "leave_application_version_documents_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_version_documents_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id")
    REFERENCES "leave_application_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_version_documents_document_fkey"
    FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_application_version_documents_link_key"
    UNIQUE (
      "leave_application_version_id", "document_version_id", "purpose_code"
    ),
  CONSTRAINT "leave_application_version_documents_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_eligibility_assessments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_application_version_id" UUID NOT NULL,
  "assessment_no" INTEGER NOT NULL,
  "result" TEXT NOT NULL,
  "input_facts" JSONB NOT NULL,
  "rule_results" JSONB NOT NULL,
  "missing_facts" JSONB NOT NULL,
  "assessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_eligibility_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_eligibility_assessments_assessment_check"
    CHECK ("assessment_no" > 0),
  CONSTRAINT "leave_eligibility_assessments_result_check"
    CHECK ("result" IN ('ELIGIBLE','INELIGIBLE','INDETERMINATE')),
  CONSTRAINT "leave_eligibility_assessments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_eligibility_assessments_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id")
    REFERENCES "leave_application_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_eligibility_assessments_assessment_key"
    UNIQUE ("leave_application_version_id", "assessment_no"),
  CONSTRAINT "leave_eligibility_assessments_version_id_key"
    UNIQUE ("agency_id", "leave_application_version_id", "id"),
  CONSTRAINT "leave_eligibility_assessments_agency_id_key"
    UNIQUE ("agency_id", "id")
);

ALTER TABLE "leave_application_versions"
ADD CONSTRAINT "leave_application_versions_accepted_assessment_fkey"
FOREIGN KEY ("agency_id", "id", "accepted_assessment_id")
REFERENCES "leave_eligibility_assessments" (
  "agency_id", "leave_application_version_id", "id"
) ON DELETE RESTRICT;

CREATE TABLE "leave_calculation_segments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_application_version_id" UUID NOT NULL,
  "eligibility_assessment_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "schedule_assignment_id" UUID,
  "holiday_facts" JSONB NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "requested_quantity" NUMERIC(12,4) NOT NULL,
  "requested_unit" TEXT NOT NULL,
  "account_quantity" NUMERIC(12,4),
  CONSTRAINT "leave_calculation_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_calculation_segments_range_check"
    CHECK ("date_to" >= "date_from"),
  CONSTRAINT "leave_calculation_segments_quantity_check"
    CHECK ("requested_quantity" > 0),
  CONSTRAINT "leave_calculation_segments_unit_check"
    CHECK ("requested_unit" IN (
      'WORKING_DAY','CALENDAR_DAY','SCHEDULED_MINUTE','SOURCE_DEFINED'
    )),
  CONSTRAINT "leave_calculation_segments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_calculation_segments_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id")
    REFERENCES "leave_application_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_calculation_segments_assessment_fkey"
    FOREIGN KEY (
      "agency_id", "leave_application_version_id", "eligibility_assessment_id"
    ) REFERENCES "leave_eligibility_assessments" (
      "agency_id", "leave_application_version_id", "id"
    ) ON DELETE RESTRICT,
  CONSTRAINT "leave_calculation_segments_policy_version_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_calculation_segments_schedule_assignment_fkey"
    FOREIGN KEY ("agency_id", "schedule_assignment_id")
    REFERENCES "schedule_assignments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_calculation_segments_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE OR REPLACE FUNCTION guard_leave_application_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Applications are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Leave Application identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."current_version_id" IS NOT NULL
    AND NEW."current_version_id" IS NULL THEN
    RAISE EXCEPTION 'The Leave Application current version cannot be cleared'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IN ('WITHDRAWN', 'REJECTED', 'CANCELLED')
    AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'Terminal Leave Application states are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED')
    OR (OLD."status" = 'SUBMITTED'
      AND NEW."status" IN ('FOR_CERTIFICATION', 'WITHDRAWN'))
    OR (OLD."status" = 'FOR_CERTIFICATION'
      AND NEW."status" IN ('FOR_RECOMMENDATION', 'NEEDS_INFORMATION', 'WITHDRAWN'))
    OR (OLD."status" = 'FOR_RECOMMENDATION'
      AND NEW."status" IN ('FOR_APPROVAL', 'NEEDS_INFORMATION', 'WITHDRAWN'))
    OR (OLD."status" = 'FOR_APPROVAL'
      AND NEW."status" IN ('APPROVED', 'REJECTED', 'NEEDS_INFORMATION', 'WITHDRAWN'))
    OR (OLD."status" = 'NEEDS_INFORMATION' AND NEW."status" = 'SUBMITTED')
    OR (OLD."status" = 'APPROVED'
      AND NEW."status" IN ('POSTED', 'CANCEL_REQUESTED'))
    OR (OLD."status" = 'POSTED' AND NEW."status" = 'CANCEL_REQUESTED')
    OR (OLD."status" = 'CANCEL_REQUESTED'
      AND NEW."status" IN ('APPROVED', 'POSTED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'Leave Application status transition is not permitted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
    AND (
      OLD."draft_leave_type_id" IS DISTINCT FROM NEW."draft_leave_type_id"
      OR OLD."draft_reason" IS DISTINCT FROM NEW."draft_reason"
      OR OLD."draft_policy_details" IS DISTINCT FROM NEW."draft_policy_details"
      OR OLD."draft_commutation_choice" IS DISTINCT FROM NEW."draft_commutation_choice"
    ) THEN
    RAISE EXCEPTION 'Submitted Leave Application draft facts are frozen'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_application_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Application Versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."accepted_assessment_id" IS NOT NULL
    AND OLD."accepted_assessment_id" IS DISTINCT FROM NEW."accepted_assessment_id" THEN
    RAISE EXCEPTION 'The accepted Leave Eligibility Assessment is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    OLD."agency_id", OLD."leave_application_id", OLD."version_no",
    OLD."leave_type_id", OLD."approval_route_version_id",
    OLD."approval_request_id", OLD."form_template_document_version_id",
    OLD."attestation_type", OLD."attestation_document_version_id",
    OLD."submitted_by_membership_id", OLD."employee_attested_at",
    OLD."submission_method", OLD."received_at", OLD."reason",
    OLD."policy_details", OLD."commutation_choice", OLD."submitted_at"
  ) IS DISTINCT FROM ROW(
    NEW."agency_id", NEW."leave_application_id", NEW."version_no",
    NEW."leave_type_id", NEW."approval_route_version_id",
    NEW."approval_request_id", NEW."form_template_document_version_id",
    NEW."attestation_type", NEW."attestation_document_version_id",
    NEW."submitted_by_membership_id", NEW."employee_attested_at",
    NEW."submission_method", NEW."received_at", NEW."reason",
    NEW."policy_details", NEW."commutation_choice", NEW."submitted_at"
  ) THEN
    RAISE EXCEPTION 'Submitted Leave Application Version facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_application_period_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Application Periods are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Application Periods are retained and cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_application_version_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Application Version document links are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Application Version document links cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_eligibility_assessment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Eligibility Assessments are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Eligibility Assessments are retained and cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_calculation_segment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Calculation Segments are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Calculation Segments are retained and cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "leave_applications_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_applications"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_application_mutation();
CREATE TRIGGER "leave_application_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_application_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_application_version_mutation();
CREATE TRIGGER "leave_application_periods_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_application_periods"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_application_period_mutation();
CREATE TRIGGER "leave_application_version_documents_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_application_version_documents"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_application_version_document_mutation();
CREATE TRIGGER "leave_eligibility_assessments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_eligibility_assessments"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_eligibility_assessment_mutation();
CREATE TRIGGER "leave_calculation_segments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_calculation_segments"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_calculation_segment_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "leave_applications" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "leave_application_draft_periods" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "leave_application_draft_documents" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "leave_application_versions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_application_periods" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_application_version_documents" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_eligibility_assessments" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_calculation_segments" TO hris_app;

ALTER TABLE "leave_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_applications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_draft_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_draft_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_draft_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_draft_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_version_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_application_version_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_eligibility_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_eligibility_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_calculation_segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_calculation_segments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "leave_applications_select" ON "leave_applications"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_applications_insert" ON "leave_applications"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_applications_update" ON "leave_applications"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_application_draft_periods_select" ON "leave_application_draft_periods"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_draft_periods_insert" ON "leave_application_draft_periods"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_draft_periods_update" ON "leave_application_draft_periods"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_draft_periods_delete" ON "leave_application_draft_periods"
  FOR DELETE USING ("agency_id" = app_agency_id());

CREATE POLICY "leave_application_draft_documents_select" ON "leave_application_draft_documents"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_draft_documents_insert" ON "leave_application_draft_documents"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_draft_documents_update" ON "leave_application_draft_documents"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_draft_documents_delete" ON "leave_application_draft_documents"
  FOR DELETE USING ("agency_id" = app_agency_id());

CREATE POLICY "leave_application_versions_select" ON "leave_application_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_versions_insert" ON "leave_application_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_versions_update" ON "leave_application_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_application_periods_select" ON "leave_application_periods"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_periods_insert" ON "leave_application_periods"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_application_version_documents_select" ON "leave_application_version_documents"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_application_version_documents_insert" ON "leave_application_version_documents"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_eligibility_assessments_select" ON "leave_eligibility_assessments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_eligibility_assessments_insert" ON "leave_eligibility_assessments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_calculation_segments_select" ON "leave_calculation_segments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_calculation_segments_insert" ON "leave_calculation_segments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.applications.create', 'leave', 'MEDIUM', 'Create and maintain own Leave Application drafts'),
  ('leave.applications.submit', 'leave', 'HIGH', 'Submit a Leave Application Version with an attestation'),
  ('leave.applications.withdraw', 'leave', 'HIGH', 'Withdraw a submitted Leave Application before final approval')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.applications.create',
  'leave.applications.submit',
  'leave.applications.withdraw'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.applications.create',
  'leave.applications.submit',
  'leave.applications.withdraw'
)
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Leave uses Approval as an app-service contract. An Employee submits their
-- own application as themselves and may cancel that unfinished route work on
-- withdrawal, so the Employee role receives only the operational grants the
-- contract requires, never route-admin power.
INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'approvals.routes.read',
  'approvals.requests.create',
  'approvals.requests.cancel'
)
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'leave_application_versions_request_key'
  ) THEN
    RAISE EXCEPTION 'Leave Application Version route binding verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'leave_calculation_segments_assessment_fkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_calculation_segments_assessment_fkey'
  ) THEN
    RAISE EXCEPTION 'Leave Calculation Segment assessment binding verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'leave_application_versions_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Leave Application Version immutability verification failed';
  END IF;
END;
$$;
