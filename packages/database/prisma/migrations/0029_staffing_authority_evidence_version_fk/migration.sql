-- Ensure a reviewed version belongs to the exact linked evidence document.

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

ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_agency_document_id_key"
  UNIQUE ("agency_id", "document_id", "id");

ALTER TABLE "staffing_authorities"
  DROP CONSTRAINT "staffing_authorities_evidence_version_fkey",
  DROP CONSTRAINT "staffing_authorities_revocation_version_fkey",
  DROP CONSTRAINT "staffing_authorities_evidence_version_check",
  DROP CONSTRAINT "staffing_authorities_revocation_version_check";

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
    FOREIGN KEY ("agency_id", "document_id", "evidence_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "staffing_authorities_revocation_version_fkey"
    FOREIGN KEY ("agency_id", "revocation_document_id", "revocation_evidence_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT;
