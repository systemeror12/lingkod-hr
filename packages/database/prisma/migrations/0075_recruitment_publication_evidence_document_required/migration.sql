DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "vacancy_publication_evidence"
    WHERE "evidence_document_version_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Vacancy publication evidence without a finalized document exists; remediate before applying evidence document constraint'
      USING ERRCODE = '23502';
  END IF;
END;
$$;

ALTER TABLE "vacancy_publication_evidence"
  ALTER COLUMN "evidence_document_version_id" SET NOT NULL;
