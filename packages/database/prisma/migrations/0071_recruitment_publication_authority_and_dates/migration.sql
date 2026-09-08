-- Retain publication timing and authority evidence on the publication record.

ALTER TABLE "vacancy_publications"
  ADD COLUMN "published_at" TIMESTAMPTZ(6),
  ADD COLUMN "republication_reason" TEXT,
  ADD COLUMN "republication_authority_document_version_id" UUID,
  ADD COLUMN "closure_reason" TEXT,
  ADD COLUMN "closure_authority_document_version_id" UUID,
  ADD COLUMN "cancellation_authority_document_version_id" UUID;

ALTER TABLE "vacancy_publications"
  ADD CONSTRAINT "vacancy_publications_republication_authority_document_version_fkey"
    FOREIGN KEY ("agency_id", "republication_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "vacancy_publications_closure_authority_document_version_fkey"
    FOREIGN KEY ("agency_id", "closure_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "vacancy_publications_cancellation_authority_document_version_fkey"
    FOREIGN KEY ("agency_id", "cancellation_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION guard_recruitment_publication_fact_extensions()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' AND (
    OLD."published_at" IS DISTINCT FROM NEW."published_at"
    OR OLD."republication_reason" IS DISTINCT FROM NEW."republication_reason"
    OR OLD."republication_authority_document_version_id" IS DISTINCT FROM NEW."republication_authority_document_version_id"
  ) THEN
    RAISE EXCEPTION 'Published Vacancy Publication timing and lineage facts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vacancy_publications_fact_extensions_trigger"
  BEFORE UPDATE ON "vacancy_publications"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_publication_fact_extensions();
