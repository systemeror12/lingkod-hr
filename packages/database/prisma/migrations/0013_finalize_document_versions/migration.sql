-- Correction plan: this migration is additive and forward-only. If deployment
-- fails before it is recorded, correct the SQL and rerun it. Once applied,
-- use a reviewed forward migration for corrections; do not drop history.
-- Finalization is preserved on the version row so changing the mutable
-- Document projection back to Draft cannot reopen historical file metadata.

CREATE OR REPLACE FUNCTION mark_final_document_version()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NEW."status" IN ('APPROVED', 'ISSUED', 'ARCHIVED', 'SUPERSEDED', 'VOIDED')
    AND NEW."current_version_id" IS NOT NULL
    AND (
      OLD."status" NOT IN ('APPROVED', 'ISSUED', 'ARCHIVED', 'SUPERSEDED', 'VOIDED')
      OR NEW."current_version_id" IS DISTINCT FROM OLD."current_version_id"
    )
  THEN
    UPDATE "document_versions"
    SET "issued_at" = COALESCE("issued_at", CURRENT_TIMESTAMP)
    WHERE "agency_id" = NEW."agency_id"
      AND "id" = NEW."current_version_id"
      AND "issued_at" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_finalize_current_version_trigger"
  BEFORE UPDATE OF "status", "current_version_id" ON "documents"
  FOR EACH ROW EXECUTE FUNCTION mark_final_document_version();
