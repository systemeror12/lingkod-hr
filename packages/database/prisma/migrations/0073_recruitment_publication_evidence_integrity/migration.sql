-- Keep one active evidence record per declared publication channel/location.
-- Draft corrections may replace evidence before the publication is submitted;
-- finalized publication evidence remains append-only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "vacancy_publication_evidence"
    GROUP BY "agency_id", "publication_id", "channel_type", "location"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate vacancy publication evidence exists for a channel/location; remediate before applying recruitment integrity migration'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "vacancy_publication_evidence_channel_location_uq"
  ON "vacancy_publication_evidence" ("agency_id", "publication_id", "channel_type", "location");

CREATE OR REPLACE FUNCTION guard_recruitment_append_only()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_TABLE_NAME = 'vacancy_publication_evidence'
      AND current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on'
    THEN
      RAISE EXCEPTION 'Recruitment evidence and snapshots require the Recruitment service' USING ERRCODE = '55000';
    END IF;
    IF TG_TABLE_NAME = 'vacancy_publication_evidence'
      AND current_setting('app.recruitment_transition', true) = 'on'
      AND EXISTS (
        SELECT 1
        FROM "vacancy_publications" publication
        WHERE publication."agency_id" = COALESCE(OLD."agency_id", NEW."agency_id")
          AND publication."id" = COALESCE(OLD."publication_id", NEW."publication_id")
          AND publication."status" = 'DRAFT'
      )
    THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Recruitment evidence and snapshots are append-only' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Recruitment evidence and snapshots require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT UPDATE, DELETE ON TABLE "vacancy_publication_evidence" TO hris_app;
