-- Qualification Standards have a stable Agency-owned identity and immutable,
-- effective-dated versions. Draft requirements may change; published versions
-- can only be superseded or corrected through the application service.

CREATE TABLE "qualification_standards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "current_version_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "qualification_standards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qualification_standards_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "qualification_standards_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standards_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "qualification_standards_agency_code_key" UNIQUE ("agency_id", "code"),
  CONSTRAINT "qualification_standards_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standards_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "qualification_standard_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "qualification_standard_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "education_requirement" TEXT,
  "training_hours_required" NUMERIC(12,4),
  "experience_months_required" INTEGER,
  "eligibility_requirement" TEXT,
  "competency_requirements" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "license_requirements" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "special_requirements" TEXT,
  "source_document_id" UUID,
  "source_evidence_version_id" UUID,
  "source_evidence_validated_at" TIMESTAMPTZ(6),
  "source_evidence_validated_by_membership_id" UUID,
  "source_evidence_validation_reason" TEXT,
  "approval_document_id" UUID,
  "approval_evidence_version_id" UUID,
  "approval_evidence_validated_at" TIMESTAMPTZ(6),
  "approval_evidence_validated_by_membership_id" UUID,
  "approval_evidence_validation_reason" TEXT,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "qualification_standard_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qualification_standard_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'VOIDED')),
  CONSTRAINT "qualification_standard_versions_version_check"
    CHECK ("version_no" > 0),
  CONSTRAINT "qualification_standard_versions_training_check"
    CHECK ("training_hours_required" IS NULL OR "training_hours_required" >= 0),
  CONSTRAINT "qualification_standard_versions_experience_check"
    CHECK ("experience_months_required" IS NULL OR "experience_months_required" >= 0),
  CONSTRAINT "qualification_standard_versions_competency_check"
    CHECK (jsonb_typeof("competency_requirements") = 'array'),
  CONSTRAINT "qualification_standard_versions_license_check"
    CHECK (jsonb_typeof("license_requirements") = 'array'),
  CONSTRAINT "qualification_standard_versions_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "qualification_standard_versions_source_evidence_check"
    CHECK (
      ("source_document_id" IS NULL AND "source_evidence_version_id" IS NULL
        AND "source_evidence_validated_at" IS NULL
        AND "source_evidence_validated_by_membership_id" IS NULL
        AND "source_evidence_validation_reason" IS NULL)
      OR ("source_document_id" IS NOT NULL AND "source_evidence_version_id" IS NOT NULL
        AND "source_evidence_validated_at" IS NOT NULL
        AND "source_evidence_validated_by_membership_id" IS NOT NULL
        AND "source_evidence_validation_reason" IS NOT NULL)
    ),
  CONSTRAINT "qualification_standard_versions_approval_evidence_check"
    CHECK (
      ("approval_document_id" IS NULL AND "approval_evidence_version_id" IS NULL
        AND "approval_evidence_validated_at" IS NULL
        AND "approval_evidence_validated_by_membership_id" IS NULL
        AND "approval_evidence_validation_reason" IS NULL)
      OR ("approval_document_id" IS NOT NULL AND "approval_evidence_version_id" IS NOT NULL
        AND "approval_evidence_validated_at" IS NOT NULL
        AND "approval_evidence_validated_by_membership_id" IS NOT NULL
        AND "approval_evidence_validation_reason" IS NOT NULL)
    ),
  CONSTRAINT "qualification_standard_versions_active_evidence_check"
    CHECK (
      "status" <> 'ACTIVE'
      OR ("source_document_id" IS NOT NULL AND "approval_document_id" IS NOT NULL)
    ),
  CONSTRAINT "qualification_standard_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_standard_fkey"
    FOREIGN KEY ("agency_id", "qualification_standard_id")
    REFERENCES "qualification_standards"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "qualification_standard_versions_standard_version_key"
    UNIQUE ("qualification_standard_id", "version_no"),
  CONSTRAINT "qualification_standard_versions_standard_id_key"
    UNIQUE ("agency_id", "qualification_standard_id", "id"),
  CONSTRAINT "qualification_standard_versions_source_document_fkey"
    FOREIGN KEY ("agency_id", "source_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_source_version_fkey"
    FOREIGN KEY ("agency_id", "source_document_id", "source_evidence_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_source_validator_fkey"
    FOREIGN KEY ("agency_id", "source_evidence_validated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_approval_document_fkey"
    FOREIGN KEY ("agency_id", "approval_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_approval_version_fkey"
    FOREIGN KEY ("agency_id", "approval_document_id", "approval_evidence_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_approval_validator_fkey"
    FOREIGN KEY ("agency_id", "approval_evidence_validated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "qualification_standard_versions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

ALTER TABLE "qualification_standards"
  ADD CONSTRAINT "qualification_standards_current_version_fkey"
  FOREIGN KEY ("agency_id", "current_version_id")
  REFERENCES "qualification_standard_versions"("agency_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "qualification_standard_versions_one_draft"
  ON "qualification_standard_versions" ("qualification_standard_id")
  WHERE "status" = 'DRAFT';

ALTER TABLE "qualification_standard_versions"
  ADD CONSTRAINT "qualification_standard_versions_published_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "qualification_standard_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'SUPERSEDED'));

CREATE INDEX "qualification_standards_status_idx"
  ON "qualification_standards" ("agency_id", "status");
CREATE INDEX "qualification_standard_versions_effective_idx"
  ON "qualification_standard_versions" ("agency_id", "qualification_standard_id", "effective_from");

CREATE OR REPLACE FUNCTION set_qualification_standard_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_qualification_standard_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW."status" <> 'INACTIVE' OR NEW."current_version_id" IS NOT NULL)
      AND current_setting('app.qualification_standard_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Qualification Standard projections require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Qualification Standards are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."code" IS DISTINCT FROM NEW."code"
    OR OLD."name" IS DISTINCT FROM NEW."name"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Qualification Standard identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF (OLD."status" IS DISTINCT FROM NEW."status"
      OR OLD."current_version_id" IS DISTINCT FROM NEW."current_version_id")
    AND current_setting('app.qualification_standard_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Qualification Standard projections require the application service'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

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
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR NEW."effective_to" IS NOT DISTINCT FROM OLD."effective_to" THEN
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

CREATE TRIGGER "qualification_standards_updated_at_trigger"
  BEFORE UPDATE ON "qualification_standards"
  FOR EACH ROW EXECUTE FUNCTION set_qualification_standard_updated_at();
CREATE TRIGGER "qualification_standards_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "qualification_standards"
  FOR EACH ROW EXECUTE FUNCTION guard_qualification_standard_mutation();
CREATE TRIGGER "qualification_standard_versions_updated_at_trigger"
  BEFORE UPDATE ON "qualification_standard_versions"
  FOR EACH ROW EXECUTE FUNCTION set_qualification_standard_updated_at();
CREATE TRIGGER "qualification_standard_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "qualification_standard_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_qualification_standard_version_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "qualification_standards" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "qualification_standard_versions" TO hris_app;

ALTER TABLE "qualification_standards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qualification_standards" FORCE ROW LEVEL SECURITY;
ALTER TABLE "qualification_standard_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qualification_standard_versions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "qualification_standards_select" ON "qualification_standards"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "qualification_standards_insert" ON "qualification_standards"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "qualification_standards_update" ON "qualification_standards"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "qualification_standard_versions_select" ON "qualification_standard_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "qualification_standard_versions_insert" ON "qualification_standard_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "qualification_standard_versions_update" ON "qualification_standard_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('qualification.standards.read', 'qualification', 'MEDIUM', 'Read Agency Qualification Standards'),
  ('qualification.standards.create', 'qualification', 'HIGH', 'Create Draft Qualification Standards'),
  ('qualification.standards.update', 'qualification', 'HIGH', 'Edit Draft Qualification Standard Versions'),
  ('qualification.standards.evidence.validate', 'qualification', 'HIGH', 'Validate Qualification Standard Evidence'),
  ('qualification.standards.activate', 'qualification', 'HIGH', 'Activate Qualification Standard Versions')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'qualification.standards.read',
  'qualification.standards.create',
  'qualification.standards.update',
  'qualification.standards.evidence.validate',
  'qualification.standards.activate'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'recruitment_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'qualification.standards.read'
WHERE r."code" IN ('plantilla_officer', 'budget_officer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
