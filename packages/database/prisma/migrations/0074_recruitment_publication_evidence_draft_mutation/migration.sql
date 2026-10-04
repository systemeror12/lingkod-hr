-- Returned publication drafts may replace their unfinalized posting evidence.

CREATE POLICY "vacancy_publication_evidence_draft_update_rls"
  ON "vacancy_publication_evidence"
  FOR UPDATE
  USING (
    "agency_id" = app_agency_id()
    AND current_setting('app.recruitment_transition', true) = 'on'
    AND EXISTS (
      SELECT 1
      FROM "vacancy_publications" publication
      WHERE publication."agency_id" = "vacancy_publication_evidence"."agency_id"
        AND publication."id" = "vacancy_publication_evidence"."publication_id"
        AND publication."status" = 'DRAFT'
    )
  )
  WITH CHECK (
    "agency_id" = app_agency_id()
    AND current_setting('app.recruitment_transition', true) = 'on'
    AND EXISTS (
      SELECT 1
      FROM "vacancy_publications" publication
      WHERE publication."agency_id" = "vacancy_publication_evidence"."agency_id"
        AND publication."id" = "vacancy_publication_evidence"."publication_id"
        AND publication."status" = 'DRAFT'
    )
  );

CREATE POLICY "vacancy_publication_evidence_draft_delete_rls"
  ON "vacancy_publication_evidence"
  FOR DELETE
  USING (
    "agency_id" = app_agency_id()
    AND current_setting('app.recruitment_transition', true) = 'on'
    AND EXISTS (
      SELECT 1
      FROM "vacancy_publications" publication
      WHERE publication."agency_id" = "vacancy_publication_evidence"."agency_id"
        AND publication."id" = "vacancy_publication_evidence"."publication_id"
        AND publication."status" = 'DRAFT'
    )
  );
