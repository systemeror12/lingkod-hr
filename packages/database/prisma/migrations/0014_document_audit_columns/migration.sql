-- Correction plan: this migration is additive and forward-only. If deployment
-- fails before it is recorded, correct the SQL and rerun it. Once applied,
-- use another reviewed forward migration for corrections; do not remove
-- document history or storage references.

ALTER TABLE "documents"
  ADD COLUMN "updated_by_membership_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "row_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_updated_by_membership_fkey"
  FOREIGN KEY ("agency_id", "updated_by_membership_id")
  REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION set_document_audit_columns()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_audit_columns_trigger"
  BEFORE UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION set_document_audit_columns();

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
        AND "documents"."status" IN ('APPROVED', 'ISSUED', 'ARCHIVED', 'SUPERSEDED', 'VOIDED')
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
