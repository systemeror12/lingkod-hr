-- The assumed Appointment is the only event that may close a selected
-- Application. Closure runs inside the Appointment activation transaction,
-- which carries the Personnel baseline capability alongside the Recruitment
-- capability. Every other path keeps the selected Application immutable.

CREATE OR REPLACE FUNCTION guard_application_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Applications are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Applications require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "vacancy_publications" publication
      WHERE publication."agency_id" = NEW."agency_id"
        AND publication."id" = NEW."vacancy_publication_id"
        AND publication."status" = 'PUBLISHED'
        AND publication."qualification_standard_version_id" = NEW."qualification_standard_version_id"
    ) THEN
      RAISE EXCEPTION 'Applications must bind a published Vacancy Publication and its Qualification Standard Version' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."application_no" IS DISTINCT FROM NEW."application_no"
    OR OLD."vacancy_publication_id" IS DISTINCT FROM NEW."vacancy_publication_id"
    OR OLD."applicant_id" IS DISTINCT FROM NEW."applicant_id"
    OR OLD."qualification_standard_version_id" IS DISTINCT FROM NEW."qualification_standard_version_id"
    OR OLD."received_at" IS DISTINCT FROM NEW."received_at"
    OR OLD."received_by_membership_id" IS DISTINCT FROM NEW."received_by_membership_id"
    OR OLD."late_acceptance_reason" IS DISTINCT FROM NEW."late_acceptance_reason"
    OR OLD."late_acceptance_authority_document_version_id" IS DISTINCT FROM NEW."late_acceptance_authority_document_version_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Application identity and receipt facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('WITHDRAWN', 'CLOSED') THEN
    RAISE EXCEPTION 'Withdrawn or closed Applications are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'RECEIVED' AND NEW."status" NOT IN ('RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Received Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'INCOMPLETE' AND NEW."status" NOT IN ('INCOMPLETE', 'RECEIVED', 'QUALIFIED', 'NOT_QUALIFIED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Incomplete Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'QUALIFIED' AND NEW."status" NOT IN ('QUALIFIED', 'INCOMPLETE', 'NOT_QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW', 'FOR_DELIBERATION', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Qualified Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'NOT_QUALIFIED' AND NEW."status" NOT IN ('NOT_QUALIFIED', 'INCOMPLETE', 'QUALIFIED', 'WITHDRAWN', 'CLOSED') THEN
    RAISE EXCEPTION 'Not qualified Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'FOR_ASSESSMENT' AND NEW."status" NOT IN ('FOR_ASSESSMENT', 'FOR_INTERVIEW', 'FOR_DELIBERATION', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Application under assessment has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'FOR_INTERVIEW' AND NEW."status" NOT IN ('FOR_INTERVIEW', 'FOR_ASSESSMENT', 'FOR_DELIBERATION', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Application under interview has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'FOR_DELIBERATION' AND NEW."status" NOT IN ('FOR_DELIBERATION', 'RECOMMENDED', 'NOT_RECOMMENDED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Application under deliberation has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'RECOMMENDED' AND NEW."status" NOT IN ('RECOMMENDED', 'SELECTED', 'NOT_SELECTED', 'FOR_DELIBERATION', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Recommended Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'NOT_RECOMMENDED' AND NEW."status" NOT IN ('NOT_RECOMMENDED', 'CLOSED') THEN
    RAISE EXCEPTION 'Not recommended Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'SELECTED' AND NEW."status" NOT IN ('SELECTED')
    AND NOT (
      NEW."status" = 'CLOSED'
      AND current_setting('app.personnel_baseline_transition', true) = 'on'
    ) THEN
    RAISE EXCEPTION 'Selected Application is immutable until service activation' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'NOT_SELECTED' AND NEW."status" NOT IN ('NOT_SELECTED', 'CLOSED') THEN
    RAISE EXCEPTION 'Not selected Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'WITHDRAWN' AND (NEW."withdrawn_at" IS NULL OR NEW."withdrawal_reason" IS NULL) THEN
    RAISE EXCEPTION 'Withdrawn Applications require a withdrawal time and reason' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'CLOSED' AND (NEW."closed_at" IS NULL OR NEW."closure_reason" IS NULL) THEN
    RAISE EXCEPTION 'Closed Applications require a closure time and reason' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'guard_application_mutation'
      AND prosrc LIKE '%personnel_baseline_transition%'
  ) THEN
    RAISE EXCEPTION 'Application closure guard verification failed';
  END IF;
END;
$$;
