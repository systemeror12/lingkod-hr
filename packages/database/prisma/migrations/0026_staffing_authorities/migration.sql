-- Staffing Authorities are agency-owned workflow records. Draft metadata may
-- change; activated and terminal records are changed only by the authority
-- service transition boundary.

CREATE TABLE "staffing_authorities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "authority_type" TEXT NOT NULL,
  "reference_no" CITEXT NOT NULL,
  "issued_date" DATE NOT NULL,
  "effective_date" DATE NOT NULL,
  "source_metadata" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "document_id" UUID,
  "evidence_validated_at" TIMESTAMPTZ(6),
  "evidence_validated_by_membership_id" UUID,
  "evidence_validation_reason" TEXT,
  "status" TEXT NOT NULL,
  "superseded_effective_date" DATE,
  "revoked_effective_date" DATE,
  "revocation_reason" TEXT,
  "revocation_document_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staffing_authorities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staffing_authorities_type_check"
    CHECK ("authority_type" IN ('LAW', 'EXECUTIVE_ORDER', 'DBM_APPROVAL', 'BOARD_RESOLUTION', 'OTHER')),
  CONSTRAINT "staffing_authorities_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REVOKED')),
  CONSTRAINT "staffing_authorities_evidence_check"
    CHECK (
      ("document_id" IS NULL AND "evidence_validated_at" IS NULL
        AND "evidence_validated_by_membership_id" IS NULL AND "evidence_validation_reason" IS NULL)
      OR ("document_id" IS NOT NULL AND "evidence_validated_at" IS NOT NULL
        AND "evidence_validated_by_membership_id" IS NOT NULL AND "evidence_validation_reason" IS NOT NULL)
    ),
  CONSTRAINT "staffing_authorities_active_evidence_check"
    CHECK ("status" <> 'ACTIVE' OR "document_id" IS NOT NULL),
  CONSTRAINT "staffing_authorities_superseded_date_check"
    CHECK ("status" <> 'SUPERSEDED' OR "superseded_effective_date" IS NOT NULL),
  CONSTRAINT "staffing_authorities_revocation_check"
    CHECK (
      "status" <> 'REVOKED'
      OR ("revoked_effective_date" IS NOT NULL AND "revocation_reason" IS NOT NULL
        AND "revocation_document_id" IS NOT NULL)
    ),
  CONSTRAINT "staffing_authorities_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "staffing_authorities_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "staffing_authorities_agency_reference_key" UNIQUE ("agency_id", "reference_no"),
  CONSTRAINT "staffing_authorities_evidence_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "staffing_authorities_revocation_document_fkey"
    FOREIGN KEY ("agency_id", "revocation_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "staffing_authorities_evidence_validator_fkey"
    FOREIGN KEY ("agency_id", "evidence_validated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "staffing_authorities_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "staffing_authorities_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE INDEX "staffing_authorities_status_effective_idx"
  ON "staffing_authorities" ("agency_id", "status", "effective_date");

CREATE OR REPLACE FUNCTION set_staffing_authority_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

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
      OR NEW."evidence_validated_at" IS DISTINCT FROM OLD."evidence_validated_at"
      OR NEW."evidence_validated_by_membership_id" IS DISTINCT FROM OLD."evidence_validated_by_membership_id"
      OR NEW."evidence_validation_reason" IS DISTINCT FROM OLD."evidence_validation_reason"
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
      OR NEW."evidence_validated_at" IS DISTINCT FROM OLD."evidence_validated_at"
      OR NEW."evidence_validated_by_membership_id" IS DISTINCT FROM OLD."evidence_validated_by_membership_id"
      OR NEW."evidence_validation_reason" IS DISTINCT FROM OLD."evidence_validation_reason"
      OR NEW."revoked_effective_date" IS NULL
      OR NEW."revocation_reason" IS NULL
      OR NEW."revocation_document_id" IS NULL THEN
      RAISE EXCEPTION 'Activated Staffing Authorities are immutable except for revocation'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Staffing Authority status cannot be changed through this path'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "staffing_authorities_updated_at_trigger"
  BEFORE UPDATE ON "staffing_authorities"
  FOR EACH ROW EXECUTE FUNCTION set_staffing_authority_updated_at();

CREATE TRIGGER "staffing_authorities_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "staffing_authorities"
  FOR EACH ROW EXECUTE FUNCTION guard_staffing_authority_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "staffing_authorities" TO hris_app;

ALTER TABLE "staffing_authorities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staffing_authorities" FORCE ROW LEVEL SECURITY;

CREATE POLICY "staffing_authorities_select" ON "staffing_authorities"
  FOR SELECT USING ("agency_id" = app_agency_id());

CREATE POLICY "staffing_authorities_insert" ON "staffing_authorities"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "staffing_authorities_update" ON "staffing_authorities"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES
  ('plantilla_officer', 'Plantilla Officer', TRUE, 'ACTIVE'),
  ('budget_officer', 'Budget Officer', TRUE, 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('staffing.authorities.read', 'staffing', 'MEDIUM', 'Read Agency Staffing Authorities'),
  ('staffing.authorities.create', 'staffing', 'HIGH', 'Create Draft Staffing Authorities'),
  ('staffing.authorities.update', 'staffing', 'HIGH', 'Edit Draft Staffing Authorities'),
  ('staffing.authorities.evidence.validate', 'staffing', 'HIGH', 'Validate Staffing Authority Evidence'),
  ('staffing.authorities.activate', 'staffing', 'HIGH', 'Activate Staffing Authorities'),
  ('staffing.authorities.supersede', 'staffing', 'HIGH', 'Supersede Staffing Authorities'),
  ('staffing.authorities.revoke', 'staffing', 'HIGH', 'Revoke Staffing Authorities')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'staffing.authorities.read',
  'staffing.authorities.create',
  'staffing.authorities.update',
  'staffing.authorities.evidence.validate',
  'staffing.authorities.activate',
  'staffing.authorities.supersede',
  'staffing.authorities.revoke'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'plantilla_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'staffing.authorities.read',
  'staffing.authorities.activate',
  'staffing.authorities.supersede',
  'staffing.authorities.revoke'
)
WHERE r."code" = 'budget_officer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'staffing.authorities.read'
WHERE r."code" = 'internal_auditor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('documents.evidence.read', 'documents.evidence.read_sensitive')
WHERE r."code" = 'internal_auditor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
