-- Correction plan: this migration is additive and forward-only. If deployment
-- fails before it is recorded, correct the SQL and rerun the migration. Once
-- applied, use a reviewed forward migration for corrections; do not drop
-- document metadata or object references in production.

CREATE TABLE "documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "document_no" CITEXT,
  "document_type" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "current_version_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "documents_classification_check"
    CHECK ("classification" IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_SENSITIVE')),
  CONSTRAINT "documents_status_check"
    CHECK ("status" IN ('DRAFT', 'FOR_REVIEW', 'APPROVED', 'ISSUED', 'ARCHIVED', 'SUPERSEDED', 'VOIDED')),
  CONSTRAINT "documents_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "documents_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "documents_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "documents_agency_document_no_key" UNIQUE ("agency_id", "document_no")
);

CREATE TABLE "document_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_at" TIMESTAMPTZ(6),
  "signature_metadata" JSONB,
  CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_versions_version_check" CHECK ("version_no" > 0),
  CONSTRAINT "document_versions_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "document_versions_content_hash_check"
    CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "document_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "document_versions_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "document_versions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "document_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "document_versions_document_version_key" UNIQUE ("document_id", "version_no"),
  CONSTRAINT "document_versions_storage_key" UNIQUE ("storage_key")
);

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_current_version_fkey"
  FOREIGN KEY ("agency_id", "current_version_id")
  REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT;

CREATE INDEX "document_versions_agency_document_version_idx"
  ON "document_versions" ("agency_id", "document_id", "version_no");

CREATE OR REPLACE FUNCTION reject_document_deletion()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION '% records are retained and cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_document_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."issued_at" IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM "documents"
      WHERE "documents"."agency_id" = OLD."agency_id"
        AND "documents"."id" = OLD."document_id"
        AND "documents"."status" IN ('ISSUED', 'ARCHIVED', 'SUPERSEDED', 'VOIDED')
    ) THEN
    RAISE EXCEPTION 'finalized document versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."document_id" IS DISTINCT FROM OLD."document_id"
    OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
    OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
    OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
    OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
    OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
    OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'document version file metadata is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_no_delete_trigger"
  BEFORE DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION reject_document_deletion();

CREATE TRIGGER "document_versions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_document_version_mutation();

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('documents.evidence.create', 'documents', 'HIGH', 'Store Agency External Evidence'),
  ('documents.evidence.read', 'documents', 'MEDIUM', 'Read Agency External Evidence metadata'),
  ('documents.evidence.read_sensitive', 'documents', 'HIGH', 'Read highly sensitive Agency External Evidence')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p
  ON p."code" IN (
    'documents.evidence.create',
    'documents.evidence.read',
    'documents.evidence.read_sensitive'
  )
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE "documents" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "document_versions" TO hris_app;

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "documents_select" ON "documents"
  FOR SELECT USING ("agency_id" = app_agency_id());

CREATE POLICY "documents_insert" ON "documents"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "documents_update" ON "documents"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "document_versions_select" ON "document_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());

CREATE POLICY "document_versions_insert" ON "document_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "document_versions_update" ON "document_versions"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
