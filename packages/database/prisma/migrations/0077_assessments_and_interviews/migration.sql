-- Phase 6 configured assessment and interview stages. Assessors record typed
-- results against the Merit Selection Criteria Set bound to the Recruitment
-- Case. Result versions are immutable; a correction appends a linked
-- replacement, and every aggregate is recomputed from raw recorded inputs.

-- Applications now enter the configured assessment and interview stages after
-- qualification. The screening lifecycle remains unchanged.
ALTER TABLE "applications" DROP CONSTRAINT "applications_status_check";
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_check"
  CHECK ("status" IN (
    'RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED',
    'FOR_ASSESSMENT', 'FOR_INTERVIEW', 'WITHDRAWN', 'CLOSED'
  ));

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
  IF OLD."status" = 'QUALIFIED' AND NEW."status" NOT IN ('QUALIFIED', 'INCOMPLETE', 'NOT_QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Qualified Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'NOT_QUALIFIED' AND NEW."status" NOT IN ('NOT_QUALIFIED', 'INCOMPLETE', 'QUALIFIED', 'WITHDRAWN', 'CLOSED') THEN
    RAISE EXCEPTION 'Not qualified Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'FOR_ASSESSMENT' AND NEW."status" NOT IN ('FOR_ASSESSMENT', 'FOR_INTERVIEW', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Application under assessment has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'FOR_INTERVIEW' AND NEW."status" NOT IN ('FOR_INTERVIEW', 'FOR_ASSESSMENT', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Application under interview has an invalid transition' USING ERRCODE = '55000';
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

-- Evidence remains linkable while the Application is in its open lifecycle,
-- including withdrawal evidence recorded from an active evaluation stage.
-- The Recruitment service still decides which commands may link evidence.
CREATE OR REPLACE FUNCTION guard_application_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Application documents require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Linked Application documents are append-only' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "applications" application
      WHERE application."agency_id" = NEW."agency_id"
        AND application."id" = NEW."application_id"
        AND application."status" IN (
          'RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED',
          'FOR_ASSESSMENT', 'FOR_INTERVIEW'
        )
    ) THEN
      RAISE EXCEPTION 'Application documents cannot be linked to a retained Application' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "applications" application
    WHERE application."agency_id" = OLD."agency_id"
      AND application."id" = OLD."application_id"
      AND application."status" IN ('RECEIVED', 'INCOMPLETE')
  ) THEN
    RAISE EXCEPTION 'Application documents cannot be removed after screening completes' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TABLE "assessments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "criteria_set_id" UUID NOT NULL,
  "stage_code" CITEXT NOT NULL CHECK (btrim("stage_code") <> ''),
  "stage_type" TEXT NOT NULL CHECK ("stage_type" = 'ASSESSMENT'),
  "scheduled_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL
    CHECK ("status" IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  "outcome_reason" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "outcome_at" TIMESTAMPTZ(6),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessments_completion_check"
    CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
  CONSTRAINT "assessments_outcome_check"
    CHECK (("status" IN ('CANCELLED', 'NO_SHOW')) = ("outcome_at" IS NOT NULL)),
  CONSTRAINT "assessments_cancellation_reason_check"
    CHECK ("status" <> 'CANCELLED' OR btrim(COALESCE("outcome_reason", '')) <> ''),
  CONSTRAINT "assessments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "assessments_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessments_criteria_set_fkey"
    FOREIGN KEY ("agency_id", "criteria_set_id")
    REFERENCES "merit_selection_criteria_sets"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessments_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessments_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "assessments_lookup_idx"
  ON "assessments" ("agency_id", "application_id", "status", "created_at");

CREATE TABLE "assessment_result_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "assessment_id" UUID NOT NULL,
  "criterion_code" CITEXT NOT NULL CHECK (btrim("criterion_code") <> ''),
  "evaluated_by_membership_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "score" NUMERIC(12,4) NOT NULL,
  "rating" TEXT,
  "comments" TEXT,
  "evidence_document_version_id" UUID,
  "replaces_result_id" UUID,
  "correction_reason" TEXT,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessment_result_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessment_result_versions_correction_check"
    CHECK (
      ("replaces_result_id" IS NULL AND "correction_reason" IS NULL)
      OR (
        "replaces_result_id" IS NOT NULL
        AND "correction_reason" IS NOT NULL
        AND btrim("correction_reason") <> ''
      )
    ),
  CONSTRAINT "assessment_result_versions_version_check"
    CHECK (("version_no" = 1) = ("replaces_result_id" IS NULL)),
  CONSTRAINT "assessment_result_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "assessment_result_versions_assessment_fkey"
    FOREIGN KEY ("agency_id", "assessment_id")
    REFERENCES "assessments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessment_result_versions_evaluator_fkey"
    FOREIGN KEY ("agency_id", "evaluated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessment_result_versions_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessment_result_versions_replaces_fkey"
    FOREIGN KEY ("agency_id", "replaces_result_id")
    REFERENCES "assessment_result_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assessment_result_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "assessment_result_versions_version_key"
    UNIQUE ("assessment_id", "criterion_code", "evaluated_by_membership_id", "version_no"),
  CONSTRAINT "assessment_result_versions_agency_replaces_key"
    UNIQUE ("agency_id", "replaces_result_id")
);

CREATE INDEX "assessment_result_versions_lookup_idx"
  ON "assessment_result_versions" ("agency_id", "assessment_id", "criterion_code");

CREATE TABLE "interviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "criteria_set_id" UUID NOT NULL,
  "stage_code" CITEXT NOT NULL CHECK (btrim("stage_code") <> ''),
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
  "location_or_link" TEXT,
  "panel_name" TEXT,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  "outcome_reason" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "outcome_at" TIMESTAMPTZ(6),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "interviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interviews_completion_check"
    CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
  CONSTRAINT "interviews_outcome_check"
    CHECK (("status" IN ('CANCELLED', 'NO_SHOW')) = ("outcome_at" IS NOT NULL)),
  CONSTRAINT "interviews_cancellation_reason_check"
    CHECK ("status" <> 'CANCELLED' OR btrim(COALESCE("outcome_reason", '')) <> ''),
  CONSTRAINT "interviews_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "interviews_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interviews_criteria_set_fkey"
    FOREIGN KEY ("agency_id", "criteria_set_id")
    REFERENCES "merit_selection_criteria_sets"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interviews_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interviews_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interviews_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "interviews_lookup_idx"
  ON "interviews" ("agency_id", "application_id", "status", "created_at");

CREATE TABLE "interview_feedback_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "interview_id" UUID NOT NULL,
  "interviewer_membership_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "score" NUMERIC(12,4),
  "recommendation" TEXT NOT NULL
    CHECK ("recommendation" IN ('PROCEED', 'HOLD', 'DO_NOT_PROCEED')),
  "comments" TEXT,
  "evidence_document_version_id" UUID,
  "replaces_feedback_id" UUID,
  "correction_reason" TEXT,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interview_feedback_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interview_feedback_versions_correction_check"
    CHECK (
      ("replaces_feedback_id" IS NULL AND "correction_reason" IS NULL)
      OR (
        "replaces_feedback_id" IS NOT NULL
        AND "correction_reason" IS NOT NULL
        AND btrim("correction_reason") <> ''
      )
    ),
  CONSTRAINT "interview_feedback_versions_version_check"
    CHECK (("version_no" = 1) = ("replaces_feedback_id" IS NULL)),
  CONSTRAINT "interview_feedback_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "interview_feedback_versions_interview_fkey"
    FOREIGN KEY ("agency_id", "interview_id")
    REFERENCES "interviews"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interview_feedback_versions_interviewer_fkey"
    FOREIGN KEY ("agency_id", "interviewer_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interview_feedback_versions_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interview_feedback_versions_replaces_fkey"
    FOREIGN KEY ("agency_id", "replaces_feedback_id")
    REFERENCES "interview_feedback_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "interview_feedback_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "interview_feedback_versions_version_key"
    UNIQUE ("interview_id", "interviewer_membership_id", "version_no"),
  CONSTRAINT "interview_feedback_versions_agency_replaces_key"
    UNIQUE ("agency_id", "replaces_feedback_id")
);

CREATE INDEX "interview_feedback_versions_lookup_idx"
  ON "interview_feedback_versions" ("agency_id", "interview_id", "interviewer_membership_id");

-- Scheduled stage events may only be created for qualified Applications and
-- are retained. Once deliberation begins the recorded evaluation is frozen.
CREATE OR REPLACE FUNCTION guard_assessment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  application_status TEXT;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Assessments require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assessments are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT application."status" INTO application_status
    FROM "applications" application
    WHERE application."agency_id" = NEW."agency_id"
      AND application."id" = NEW."application_id";
    IF application_status IS NULL THEN
      RAISE EXCEPTION 'The Application for the Assessment does not exist' USING ERRCODE = '55000';
    END IF;
    IF application_status NOT IN ('QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW') THEN
      RAISE EXCEPTION 'Only qualified Applications enter configured assessment stages' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."application_id" IS DISTINCT FROM NEW."application_id"
    OR OLD."criteria_set_id" IS DISTINCT FROM NEW."criteria_set_id"
    OR OLD."stage_code" IS DISTINCT FROM NEW."stage_code"
    OR OLD."stage_type" IS DISTINCT FROM NEW."stage_type"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Assessment identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'Completed, cancelled, or no-show Assessments are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" NOT IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
    RAISE EXCEPTION 'Scheduled Assessment has an invalid transition' USING ERRCODE = '55000';
  END IF;
  SELECT application."status" INTO application_status
  FROM "applications" application
  WHERE application."agency_id" = NEW."agency_id"
    AND application."id" = NEW."application_id";
  IF application_status IN (
    'FOR_DELIBERATION', 'RECOMMENDED', 'NOT_RECOMMENDED',
    'SELECTED', 'NOT_SELECTED', 'WITHDRAWN', 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Assessment records are frozen once deliberation begins' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_interview_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  application_status TEXT;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Interviews require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Interviews are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT application."status" INTO application_status
    FROM "applications" application
    WHERE application."agency_id" = NEW."agency_id"
      AND application."id" = NEW."application_id";
    IF application_status IS NULL THEN
      RAISE EXCEPTION 'The Application for the Interview does not exist' USING ERRCODE = '55000';
    END IF;
    IF application_status NOT IN ('QUALIFIED', 'FOR_ASSESSMENT', 'FOR_INTERVIEW') THEN
      RAISE EXCEPTION 'Only qualified Applications enter configured interview stages' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."application_id" IS DISTINCT FROM NEW."application_id"
    OR OLD."criteria_set_id" IS DISTINCT FROM NEW."criteria_set_id"
    OR OLD."stage_code" IS DISTINCT FROM NEW."stage_code"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Interview identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'Completed, cancelled, or no-show Interviews are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" NOT IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
    RAISE EXCEPTION 'Scheduled Interview has an invalid transition' USING ERRCODE = '55000';
  END IF;
  SELECT application."status" INTO application_status
  FROM "applications" application
  WHERE application."agency_id" = NEW."agency_id"
    AND application."id" = NEW."application_id";
  IF application_status IN (
    'FOR_DELIBERATION', 'RECOMMENDED', 'NOT_RECOMMENDED',
    'SELECTED', 'NOT_SELECTED', 'WITHDRAWN', 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Interview records are frozen once deliberation begins' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Result and feedback rows are append-only and versioned. A replacement must
-- be the next version for the same evaluator and criterion, and it must
-- reference the immediate predecessor.
CREATE OR REPLACE FUNCTION guard_assessment_result_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  assessment_status TEXT;
  application_status TEXT;
  latest_version INTEGER;
  latest_result_id UUID;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Assessment results require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Assessment result versions are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT assessment."status", application."status"
    INTO assessment_status, application_status
  FROM "assessments" assessment
  JOIN "applications" application
    ON application."agency_id" = assessment."agency_id"
    AND application."id" = assessment."application_id"
  WHERE assessment."agency_id" = NEW."agency_id"
    AND assessment."id" = NEW."assessment_id";
  IF assessment_status IS NULL THEN
    RAISE EXCEPTION 'The Assessment for the result does not exist' USING ERRCODE = '55000';
  END IF;
  IF assessment_status NOT IN ('SCHEDULED', 'COMPLETED') THEN
    RAISE EXCEPTION 'Results can only be recorded while the Assessment is scheduled or completed' USING ERRCODE = '55000';
  END IF;
  IF application_status IN (
    'FOR_DELIBERATION', 'RECOMMENDED', 'NOT_RECOMMENDED',
    'SELECTED', 'NOT_SELECTED', 'WITHDRAWN', 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Assessment results are frozen once deliberation begins' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(MAX(result."version_no"), 0)
    INTO latest_version
  FROM "assessment_result_versions" result
  WHERE result."agency_id" = NEW."agency_id"
    AND result."assessment_id" = NEW."assessment_id"
    AND result."criterion_code" = NEW."criterion_code"
    AND result."evaluated_by_membership_id" = NEW."evaluated_by_membership_id";
  IF NEW."version_no" <> latest_version + 1 THEN
    RAISE EXCEPTION 'Assessment result versions must advance exactly once' USING ERRCODE = '55000';
  END IF;
  IF latest_version > 0 THEN
    SELECT result."id"
      INTO latest_result_id
    FROM "assessment_result_versions" result
    WHERE result."agency_id" = NEW."agency_id"
      AND result."assessment_id" = NEW."assessment_id"
      AND result."criterion_code" = NEW."criterion_code"
      AND result."evaluated_by_membership_id" = NEW."evaluated_by_membership_id"
      AND result."version_no" = latest_version;
    IF NEW."replaces_result_id" IS DISTINCT FROM latest_result_id THEN
      RAISE EXCEPTION 'Assessment result replacements must reference the result they replace' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_interview_feedback_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  interview_status TEXT;
  application_status TEXT;
  latest_version INTEGER;
  latest_feedback_id UUID;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Interview feedback requires the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Interview feedback versions are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT interview."status", application."status"
    INTO interview_status, application_status
  FROM "interviews" interview
  JOIN "applications" application
    ON application."agency_id" = interview."agency_id"
    AND application."id" = interview."application_id"
  WHERE interview."agency_id" = NEW."agency_id"
    AND interview."id" = NEW."interview_id";
  IF interview_status IS NULL THEN
    RAISE EXCEPTION 'The Interview for the feedback does not exist' USING ERRCODE = '55000';
  END IF;
  IF interview_status NOT IN ('SCHEDULED', 'COMPLETED') THEN
    RAISE EXCEPTION 'Feedback can only be recorded while the Interview is scheduled or completed' USING ERRCODE = '55000';
  END IF;
  IF application_status IN (
    'FOR_DELIBERATION', 'RECOMMENDED', 'NOT_RECOMMENDED',
    'SELECTED', 'NOT_SELECTED', 'WITHDRAWN', 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Interview feedback is frozen once deliberation begins' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(MAX(feedback."version_no"), 0)
    INTO latest_version
  FROM "interview_feedback_versions" feedback
  WHERE feedback."agency_id" = NEW."agency_id"
    AND feedback."interview_id" = NEW."interview_id"
    AND feedback."interviewer_membership_id" = NEW."interviewer_membership_id";
  IF NEW."version_no" <> latest_version + 1 THEN
    RAISE EXCEPTION 'Interview feedback versions must advance exactly once' USING ERRCODE = '55000';
  END IF;
  IF latest_version > 0 THEN
    SELECT feedback."id"
      INTO latest_feedback_id
    FROM "interview_feedback_versions" feedback
    WHERE feedback."agency_id" = NEW."agency_id"
      AND feedback."interview_id" = NEW."interview_id"
      AND feedback."interviewer_membership_id" = NEW."interviewer_membership_id"
      AND feedback."version_no" = latest_version;
    IF NEW."replaces_feedback_id" IS DISTINCT FROM latest_feedback_id THEN
      RAISE EXCEPTION 'Interview feedback replacements must reference the feedback they replace' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "assessments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "assessments"
  FOR EACH ROW EXECUTE FUNCTION guard_assessment_mutation();
CREATE TRIGGER "interviews_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "interviews"
  FOR EACH ROW EXECUTE FUNCTION guard_interview_mutation();
CREATE TRIGGER "assessment_result_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "assessment_result_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_assessment_result_mutation();
CREATE TRIGGER "interview_feedback_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "interview_feedback_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_interview_feedback_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "assessments" TO hris_app;
GRANT SELECT, INSERT ON TABLE "assessment_result_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "interviews" TO hris_app;
GRANT SELECT, INSERT ON TABLE "interview_feedback_versions" TO hris_app;

ALTER TABLE "assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assessment_result_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_result_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview_feedback_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview_feedback_versions" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'assessments', 'assessment_result_versions',
    'interviews', 'interview_feedback_versions'
  ] LOOP
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING ("agency_id" = app_agency_id())', table_name || '_rls', table_name);
    EXECUTE format('CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK ("agency_id" = app_agency_id() AND current_setting(''app.recruitment_transition'', true) = ''on'')', table_name || '_insert_rls', table_name);
  END LOOP;
END;
$$;

CREATE POLICY "assessments_update_rls"
  ON "assessments" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on');

CREATE POLICY "interviews_update_rls"
  ON "interviews" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on');

REVOKE UPDATE, DELETE ON TABLE "assessment_result_versions" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "interview_feedback_versions" FROM hris_app;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('recruitment.assessments.manage', 'recruitment', 'HIGH', 'Schedule and record configured assessment stages'),
  ('recruitment.interviews.manage', 'recruitment', 'HIGH', 'Schedule interviews and record interviewer feedback')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p
  ON p."code" IN ('recruitment.assessments.manage', 'recruitment.interviews.manage')
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'recruitment_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'assessments'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'assessment_result_versions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'interviews'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'interview_feedback_versions'::regclass), false) THEN
    RAISE EXCEPTION 'Assessment and interview capability migration verification failed';
  END IF;
END;
$$;
