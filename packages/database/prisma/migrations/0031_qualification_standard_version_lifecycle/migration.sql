ALTER TABLE "qualification_standard_versions"
  ADD COLUMN "domain_status" TEXT NOT NULL DEFAULT 'INACTIVE',
  ADD CONSTRAINT "qualification_standard_versions_domain_status_check"
    CHECK ("domain_status" IN ('ACTIVE', 'INACTIVE')),
  ADD CONSTRAINT "qualification_standard_versions_active_domain_status_check"
    CHECK ("status" <> 'ACTIVE' OR "domain_status" = 'ACTIVE');

CREATE OR REPLACE FUNCTION guard_qualification_standard_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.qualification_standard_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Qualification Standard transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Qualification Standard versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'Qualification Standard versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."qualification_standard_id" IS DISTINCT FROM OLD."qualification_standard_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Qualification Standard identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('app.qualification_standard_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Qualification Standard transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."domain_status" <> 'ACTIVE'
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."qualification_standard_id" IS DISTINCT FROM OLD."qualification_standard_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."education_requirement" IS DISTINCT FROM OLD."education_requirement"
      OR NEW."training_hours_required" IS DISTINCT FROM OLD."training_hours_required"
      OR NEW."experience_months_required" IS DISTINCT FROM OLD."experience_months_required"
      OR NEW."eligibility_requirement" IS DISTINCT FROM OLD."eligibility_requirement"
      OR NEW."competency_requirements" IS DISTINCT FROM OLD."competency_requirements"
      OR NEW."license_requirements" IS DISTINCT FROM OLD."license_requirements"
      OR NEW."special_requirements" IS DISTINCT FROM OLD."special_requirements"
      OR NEW."source_document_id" IS DISTINCT FROM OLD."source_document_id"
      OR NEW."source_evidence_version_id" IS DISTINCT FROM OLD."source_evidence_version_id"
      OR NEW."source_evidence_validated_at" IS DISTINCT FROM OLD."source_evidence_validated_at"
      OR NEW."source_evidence_validated_by_membership_id" IS DISTINCT FROM OLD."source_evidence_validated_by_membership_id"
      OR NEW."source_evidence_validation_reason" IS DISTINCT FROM OLD."source_evidence_validation_reason"
      OR NEW."approval_document_id" IS DISTINCT FROM OLD."approval_document_id"
      OR NEW."approval_evidence_version_id" IS DISTINCT FROM OLD."approval_evidence_version_id"
      OR NEW."approval_evidence_validated_at" IS DISTINCT FROM OLD."approval_evidence_validated_at"
      OR NEW."approval_evidence_validated_by_membership_id" IS DISTINCT FROM OLD."approval_evidence_validated_by_membership_id"
      OR NEW."approval_evidence_validation_reason" IS DISTINCT FROM OLD."approval_evidence_validation_reason"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Qualification Standard activation cannot rewrite requirements'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."qualification_standard_id" IS DISTINCT FROM OLD."qualification_standard_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."education_requirement" IS DISTINCT FROM OLD."education_requirement"
      OR NEW."training_hours_required" IS DISTINCT FROM OLD."training_hours_required"
      OR NEW."experience_months_required" IS DISTINCT FROM OLD."experience_months_required"
      OR NEW."eligibility_requirement" IS DISTINCT FROM OLD."eligibility_requirement"
      OR NEW."competency_requirements" IS DISTINCT FROM OLD."competency_requirements"
      OR NEW."license_requirements" IS DISTINCT FROM OLD."license_requirements"
      OR NEW."special_requirements" IS DISTINCT FROM OLD."special_requirements"
      OR NEW."source_document_id" IS DISTINCT FROM OLD."source_document_id"
      OR NEW."source_evidence_version_id" IS DISTINCT FROM OLD."source_evidence_version_id"
      OR NEW."source_evidence_validated_at" IS DISTINCT FROM OLD."source_evidence_validated_at"
      OR NEW."source_evidence_validated_by_membership_id" IS DISTINCT FROM OLD."source_evidence_validated_by_membership_id"
      OR NEW."source_evidence_validation_reason" IS DISTINCT FROM OLD."source_evidence_validation_reason"
      OR NEW."approval_document_id" IS DISTINCT FROM OLD."approval_document_id"
      OR NEW."approval_evidence_version_id" IS DISTINCT FROM OLD."approval_evidence_version_id"
      OR NEW."approval_evidence_validated_at" IS DISTINCT FROM OLD."approval_evidence_validated_at"
      OR NEW."approval_evidence_validated_by_membership_id" IS DISTINCT FROM OLD."approval_evidence_validated_by_membership_id"
      OR NEW."approval_evidence_validation_reason" IS DISTINCT FROM OLD."approval_evidence_validation_reason"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."effective_to" IS NOT DISTINCT FROM OLD."effective_to"
      OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Active Qualification Standard versions are immutable except for supersession'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('ACTIVE', 'SUPERSEDED') AND NEW."status" = 'VOIDED' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."qualification_standard_id" IS DISTINCT FROM OLD."qualification_standard_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."education_requirement" IS DISTINCT FROM OLD."education_requirement"
      OR NEW."training_hours_required" IS DISTINCT FROM OLD."training_hours_required"
      OR NEW."experience_months_required" IS DISTINCT FROM OLD."experience_months_required"
      OR NEW."eligibility_requirement" IS DISTINCT FROM OLD."eligibility_requirement"
      OR NEW."competency_requirements" IS DISTINCT FROM OLD."competency_requirements"
      OR NEW."license_requirements" IS DISTINCT FROM OLD."license_requirements"
      OR NEW."special_requirements" IS DISTINCT FROM OLD."special_requirements"
      OR NEW."source_document_id" IS DISTINCT FROM OLD."source_document_id"
      OR NEW."source_evidence_version_id" IS DISTINCT FROM OLD."source_evidence_version_id"
      OR NEW."source_evidence_validated_at" IS DISTINCT FROM OLD."source_evidence_validated_at"
      OR NEW."source_evidence_validated_by_membership_id" IS DISTINCT FROM OLD."source_evidence_validated_by_membership_id"
      OR NEW."source_evidence_validation_reason" IS DISTINCT FROM OLD."source_evidence_validation_reason"
      OR NEW."approval_document_id" IS DISTINCT FROM OLD."approval_document_id"
      OR NEW."approval_evidence_version_id" IS DISTINCT FROM OLD."approval_evidence_version_id"
      OR NEW."approval_evidence_validated_at" IS DISTINCT FROM OLD."approval_evidence_validated_at"
      OR NEW."approval_evidence_validated_by_membership_id" IS DISTINCT FROM OLD."approval_evidence_validated_by_membership_id"
      OR NEW."approval_evidence_validation_reason" IS DISTINCT FROM OLD."approval_evidence_validation_reason"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
      OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Published Qualification Standard versions are immutable except for correction voiding'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Qualification Standard version state cannot be changed through this path'
    USING ERRCODE = '55000';
END;
$$;
