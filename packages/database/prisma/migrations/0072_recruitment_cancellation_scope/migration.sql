-- Keep cancellation transitions aligned with the documented Recruitment control matrix.

CREATE OR REPLACE FUNCTION guard_recruitment_request_cancellation_scope()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NEW."status" = 'CANCELLED' AND OLD."status" NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'Request to Fill cancellation is only permitted from DRAFT or SUBMITTED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "requests_to_fill_cancellation_scope_trigger"
  BEFORE UPDATE ON "requests_to_fill"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_request_cancellation_scope();

CREATE OR REPLACE FUNCTION guard_recruitment_publication_cancellation_scope()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NEW."status" = 'CANCELLED' AND OLD."status" <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Vacancy Publication cancellation is only permitted from PUBLISHED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vacancy_publications_cancellation_scope_trigger"
  BEFORE UPDATE ON "vacancy_publications"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_publication_cancellation_scope();
