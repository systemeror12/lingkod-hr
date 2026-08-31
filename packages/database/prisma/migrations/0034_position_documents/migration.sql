-- Position evidence links attach an existing External Evidence Document to a
-- stable Plantilla Position. The link is retained across position versions.
--
-- Rollback/correction: this migration is intentionally forward-only. If a
-- correction is required before links are used, drop the trigger, policies,
-- table, and function in reverse dependency order through a reviewed follow-up
-- migration; do not remove the table while production links are retained.
-- Verification:
--   SELECT to_regclass('public.position_documents');
--   SELECT COUNT(*) FROM public.position_documents;
-- Performance: reads use the agency/position/effective-date index; the
-- transition trigger runs only for link insert/delete mutations.

CREATE TABLE "position_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "position_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_type" TEXT NOT NULL,
  "effective_from" DATE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "position_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "position_documents_document_type_check"
    CHECK ("document_type" IN (
      'POSITION_DESCRIPTION',
      'CREATION',
      'RECLASSIFICATION',
      'TRANSFER',
      'FREEZE',
      'ABOLITION',
      'OTHER'
    )),
  CONSTRAINT "position_documents_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "position_documents_position_fkey"
    FOREIGN KEY ("agency_id", "position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "position_documents_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "position_documents_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "position_documents_position_document_type_key"
    UNIQUE ("position_id", "document_id", "document_type")
);

CREATE INDEX "position_documents_position_effective_idx"
  ON "position_documents" ("agency_id", "position_id", "effective_from");

CREATE OR REPLACE FUNCTION guard_position_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.plantilla_position_evidence_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Plantilla Position evidence links require the application service'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "position_documents_mutation_trigger"
  BEFORE INSERT OR DELETE ON "position_documents"
  FOR EACH ROW EXECUTE FUNCTION guard_position_document_mutation();

GRANT SELECT, INSERT, DELETE ON TABLE "position_documents" TO hris_app;

ALTER TABLE "position_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "position_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY "position_documents_select" ON "position_documents"
  FOR SELECT USING ("agency_id" = app_agency_id());

CREATE POLICY "position_documents_insert" ON "position_documents"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "position_documents_delete" ON "position_documents"
  FOR DELETE USING ("agency_id" = app_agency_id());
