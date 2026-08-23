-- Pin every Staffing Authority evidence link to the immutable reviewed version
-- and add optimistic locking for editable Draft metadata.

ALTER TABLE "staffing_authorities"
  ADD COLUMN "evidence_version_id" UUID,
  ADD COLUMN "revocation_evidence_version_id" UUID,
  ADD COLUMN "row_version" INTEGER NOT NULL DEFAULT 1;

UPDATE "staffing_authorities" AS authority
SET "evidence_version_id" = document."current_version_id"
FROM "documents" AS document
WHERE authority."agency_id" = document."agency_id"
  AND authority."document_id" = document."id"
  AND authority."evidence_version_id" IS NULL
  AND document."current_version_id" IS NOT NULL;

UPDATE "staffing_authorities" AS authority
SET "revocation_evidence_version_id" = document."current_version_id"
FROM "documents" AS document
WHERE authority."agency_id" = document."agency_id"
  AND authority."revocation_document_id" = document."id"
  AND authority."revocation_evidence_version_id" IS NULL
  AND document."current_version_id" IS NOT NULL;

ALTER TABLE "staffing_authorities"
  ADD CONSTRAINT "staffing_authorities_evidence_version_check"
    CHECK (
      ("document_id" IS NULL AND "evidence_version_id" IS NULL)
      OR ("document_id" IS NOT NULL AND "evidence_version_id" IS NOT NULL)
    ),
  ADD CONSTRAINT "staffing_authorities_revocation_version_check"
    CHECK (
      ("revocation_document_id" IS NULL AND "revocation_evidence_version_id" IS NULL)
      OR ("revocation_document_id" IS NOT NULL AND "revocation_evidence_version_id" IS NOT NULL)
    ),
  ADD CONSTRAINT "staffing_authorities_evidence_version_fkey"
    FOREIGN KEY ("agency_id", "evidence_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "staffing_authorities_revocation_version_fkey"
    FOREIGN KEY ("agency_id", "revocation_evidence_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION set_staffing_authority_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER "staffing_authorities_updated_at_trigger" ON "staffing_authorities";

CREATE TRIGGER "staffing_authorities_updated_at_trigger"
  BEFORE UPDATE ON "staffing_authorities"
  FOR EACH ROW EXECUTE FUNCTION set_staffing_authority_updated_at();

CREATE OR REPLACE FUNCTION guard_staffing_authority_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.staffing_authority_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Staffing Authorities must be created as Draft'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Staffing Authorities are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.staffing_authority_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Staffing Authority transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."authority_type" IS DISTINCT FROM OLD."authority_type"
      OR NEW."reference_no" IS DISTINCT FROM OLD."reference_no"
      OR NEW."issued_date" IS DISTINCT FROM OLD."issued_date"
      OR NEW."effective_date" IS DISTINCT FROM OLD."effective_date"
      OR NEW."source_metadata" IS DISTINCT FROM OLD."source_metadata"
      OR NEW."document_id" IS DISTINCT FROM OLD."document_id"
      OR NEW."evidence_version_id" IS DISTINCT FROM OLD."evidence_version_id"
      OR NEW."evidence_validated_at" IS DISTINCT FROM OLD."evidence_validated_at"
      OR NEW."evidence_validated_by_membership_id" IS DISTINCT FROM OLD."evidence_validated_by_membership_id"
      OR NEW."evidence_validation_reason" IS DISTINCT FROM OLD."evidence_validation_reason"
      OR NEW."revoked_effective_date" IS DISTINCT FROM OLD."revoked_effective_date"
      OR NEW."revocation_reason" IS DISTINCT FROM OLD."revocation_reason"
      OR NEW."revocation_document_id" IS DISTINCT FROM OLD."revocation_document_id"
      OR NEW."revocation_evidence_version_id" IS DISTINCT FROM OLD."revocation_evidence_version_id"
      OR NEW."superseded_effective_date" IS NOT DISTINCT FROM NULL THEN
      RAISE EXCEPTION 'Activated Staffing Authorities are immutable except for supersession'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'REVOKED' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."authority_type" IS DISTINCT FROM OLD."authority_type"
      OR NEW."reference_no" IS DISTINCT FROM OLD."reference_no"
      OR NEW."issued_date" IS DISTINCT FROM OLD."issued_date"
      OR NEW."effective_date" IS DISTINCT FROM OLD."effective_date"
      OR NEW."source_metadata" IS DISTINCT FROM OLD."source_metadata"
      OR NEW."document_id" IS DISTINCT FROM OLD."document_id"
      OR NEW."evidence_version_id" IS DISTINCT FROM OLD."evidence_version_id"
      OR NEW."evidence_validated_at" IS DISTINCT FROM OLD."evidence_validated_at"
      OR NEW."evidence_validated_by_membership_id" IS DISTINCT FROM OLD."evidence_validated_by_membership_id"
      OR NEW."evidence_validation_reason" IS DISTINCT FROM OLD."evidence_validation_reason"
      OR NEW."superseded_effective_date" IS DISTINCT FROM OLD."superseded_effective_date"
      OR NEW."revoked_effective_date" IS NULL
      OR NEW."revocation_reason" IS NULL
      OR NEW."revocation_document_id" IS NULL
      OR NEW."revocation_evidence_version_id" IS NULL THEN
      RAISE EXCEPTION 'Activated Staffing Authorities are immutable except for revocation'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Staffing Authority status cannot be changed through this path'
    USING ERRCODE = '55000';
END;
$$;
