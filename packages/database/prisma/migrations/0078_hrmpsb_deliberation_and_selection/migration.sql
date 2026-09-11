-- Phase 6 HRMPSB deliberation and Selection Decision. Board Definitions and
-- Board Appointments remain versioned Agency configuration. Each Selection
-- Board Session freezes an immutable roster snapshot and applicant-specific
-- quorum, records actual participation, conflict declarations, and recusals,
-- and produces advisory Board Recommendations and a versioned Comprehensive
-- Candidate Evaluation Report. The appointing authority's Selection Decision
-- stays a separate Recruitment record, and a selected candidate is handed to
-- Appointment with the Plantilla Position reserved through Plantilla.

-- Applications now enter and leave deliberation. Final statuses require the
-- existing decision evidence, and a returned board output reopens deliberation
-- rather than creating a new Application.
ALTER TABLE "applications" DROP CONSTRAINT "applications_status_check";
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_check"
  CHECK ("status" IN (
    'RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED',
    'FOR_ASSESSMENT', 'FOR_INTERVIEW', 'FOR_DELIBERATION',
    'RECOMMENDED', 'NOT_RECOMMENDED', 'SELECTED',
    'NOT_SELECTED', 'WITHDRAWN', 'CLOSED'
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
  IF OLD."status" = 'SELECTED' AND NEW."status" NOT IN ('SELECTED') THEN
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

CREATE TABLE "selection_board_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "vacancy_publication_id" UUID NOT NULL,
  "board_definition_id" UUID NOT NULL,
  "session_date" DATE NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  "roster_frozen_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "cancellation_reason" TEXT,
  "minutes_document_version_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "selection_board_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "selection_board_sessions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "selection_board_sessions_publication_fkey"
    FOREIGN KEY ("agency_id", "vacancy_publication_id")
    REFERENCES "vacancy_publications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_board_sessions_board_fkey"
    FOREIGN KEY ("agency_id", "board_definition_id")
    REFERENCES "board_definitions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_board_sessions_minutes_fkey"
    FOREIGN KEY ("agency_id", "minutes_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_board_sessions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_board_sessions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_board_sessions_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "selection_board_sessions_lookup_idx"
  ON "selection_board_sessions" ("agency_id", "vacancy_publication_id", "status");

-- One active deliberation per vacancy. A returned board output completes its
-- Session before a new round can convene.
CREATE UNIQUE INDEX "selection_board_sessions_active_publication_key"
  ON "selection_board_sessions" ("agency_id", "vacancy_publication_id")
  WHERE "status" = 'IN_PROGRESS';

CREATE TABLE "board_roster_snapshot_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "board_appointment_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "seat_code" CITEXT NOT NULL CHECK (btrim("seat_code") <> ''),
  "board_role" TEXT NOT NULL CHECK ("board_role" IN ('CHAIR', 'MEMBER', 'SECRETARIAT', 'OBSERVER')),
  "appointment_kind" TEXT NOT NULL CHECK (btrim("appointment_kind") <> ''),
  "is_voting" BOOLEAN NOT NULL,
  CONSTRAINT "board_roster_snapshot_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_roster_snapshot_members_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "board_roster_snapshot_members_session_fkey"
    FOREIGN KEY ("agency_id", "session_id")
    REFERENCES "selection_board_sessions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_roster_snapshot_members_appointment_fkey"
    FOREIGN KEY ("agency_id", "board_appointment_id")
    REFERENCES "board_appointments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_roster_snapshot_members_membership_fkey"
    FOREIGN KEY ("agency_id", "membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_roster_snapshot_members_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "board_roster_snapshot_members_agency_membership_key"
    UNIQUE ("agency_id", "id", "membership_id"),
  CONSTRAINT "board_roster_snapshot_members_appointment_key"
    UNIQUE ("session_id", "board_appointment_id"),
  CONSTRAINT "board_roster_snapshot_members_membership_key"
    UNIQUE ("session_id", "membership_id")
);

CREATE INDEX "board_roster_snapshot_members_lookup_idx"
  ON "board_roster_snapshot_members" ("agency_id", "session_id", "seat_code");

CREATE TABLE "board_member_participations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "roster_snapshot_member_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "board_role" TEXT NOT NULL CHECK ("board_role" IN ('CHAIR', 'MEMBER', 'SECRETARIAT', 'OBSERVER')),
  "attendance_status" TEXT NOT NULL CHECK ("attendance_status" IN ('PRESENT', 'ABSENT', 'RECUSED')),
  "signed_at" TIMESTAMPTZ(6),
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "board_member_participations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_member_participations_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "board_member_participations_session_fkey"
    FOREIGN KEY ("agency_id", "session_id")
    REFERENCES "selection_board_sessions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_member_participations_roster_fkey"
    FOREIGN KEY ("agency_id", "roster_snapshot_member_id", "membership_id")
    REFERENCES "board_roster_snapshot_members"("agency_id", "id", "membership_id") ON DELETE RESTRICT,
  CONSTRAINT "board_member_participations_membership_fkey"
    FOREIGN KEY ("agency_id", "membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_member_participations_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_member_participations_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "board_member_participations_membership_key" UNIQUE ("session_id", "membership_id")
);

CREATE INDEX "board_member_participations_lookup_idx"
  ON "board_member_participations" ("agency_id", "session_id");

CREATE TABLE "conflict_declarations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "participation_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "has_conflict" BOOLEAN NOT NULL,
  "details" TEXT,
  "declared_by_membership_id" UUID NOT NULL,
  "declared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conflict_declarations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conflict_declarations_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "conflict_declarations_session_fkey"
    FOREIGN KEY ("agency_id", "session_id")
    REFERENCES "selection_board_sessions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "conflict_declarations_participation_fkey"
    FOREIGN KEY ("agency_id", "participation_id")
    REFERENCES "board_member_participations"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "conflict_declarations_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "conflict_declarations_declarer_fkey"
    FOREIGN KEY ("agency_id", "declared_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "conflict_declarations_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "conflict_declarations_pair_key" UNIQUE ("participation_id", "application_id")
);

CREATE INDEX "conflict_declarations_lookup_idx"
  ON "conflict_declarations" ("agency_id", "session_id", "application_id");

CREATE TABLE "applicant_quorum_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "voting_seats" INTEGER NOT NULL CHECK ("voting_seats" >= 0),
  "national_floor" INTEGER NOT NULL CHECK ("national_floor" >= 0),
  "eligible_voting_members" INTEGER NOT NULL CHECK ("eligible_voting_members" >= 0),
  "required_voting_members" INTEGER NOT NULL CHECK ("required_voting_members" > 0),
  "present_voting_members" INTEGER NOT NULL CHECK ("present_voting_members" >= 0),
  "satisfied" BOOLEAN NOT NULL,
  "frozen_by_membership_id" UUID NOT NULL,
  "frozen_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "applicant_quorum_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "applicant_quorum_snapshots_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "applicant_quorum_snapshots_session_fkey"
    FOREIGN KEY ("agency_id", "session_id")
    REFERENCES "selection_board_sessions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applicant_quorum_snapshots_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applicant_quorum_snapshots_frozer_fkey"
    FOREIGN KEY ("agency_id", "frozen_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applicant_quorum_snapshots_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "applicant_quorum_snapshots_application_key" UNIQUE ("session_id", "application_id")
);

CREATE INDEX "applicant_quorum_snapshots_lookup_idx"
  ON "applicant_quorum_snapshots" ("agency_id", "session_id", "satisfied");

CREATE TABLE "board_recommendations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "rank_no" INTEGER CHECK ("rank_no" IS NULL OR "rank_no" > 0),
  "recommendation" TEXT NOT NULL CHECK ("recommendation" IN ('RECOMMENDED', 'NOT_RECOMMENDED', 'RESERVE')),
  "composite_score" NUMERIC(12, 4),
  "reason" TEXT,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "board_recommendations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_recommendations_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "board_recommendations_session_fkey"
    FOREIGN KEY ("agency_id", "session_id")
    REFERENCES "selection_board_sessions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_recommendations_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_recommendations_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_recommendations_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "board_recommendations_application_key" UNIQUE ("session_id", "application_id")
);

CREATE INDEX "board_recommendations_lookup_idx"
  ON "board_recommendations" ("agency_id", "session_id", "rank_no");

CREATE TABLE "candidate_evaluation_report_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "report_document_version_id" UUID NOT NULL,
  "report_data" JSONB NOT NULL,
  "reason" TEXT,
  "issued_by_membership_id" UUID NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "candidate_evaluation_report_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidate_evaluation_report_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "candidate_evaluation_report_versions_session_fkey"
    FOREIGN KEY ("agency_id", "session_id")
    REFERENCES "selection_board_sessions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "candidate_evaluation_report_versions_document_fkey"
    FOREIGN KEY ("agency_id", "report_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "candidate_evaluation_report_versions_issuer_fkey"
    FOREIGN KEY ("agency_id", "issued_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "candidate_evaluation_report_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "candidate_evaluation_report_versions_version_key" UNIQUE ("session_id", "version_no")
);

CREATE INDEX "candidate_evaluation_report_versions_lookup_idx"
  ON "candidate_evaluation_report_versions" ("agency_id", "session_id", "issued_at");

CREATE TABLE "selection_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "board_recommendation_id" UUID NOT NULL,
  "decision" TEXT NOT NULL CHECK ("decision" IN ('SELECTED', 'NOT_SELECTED', 'RETURNED')),
  "reason" TEXT NOT NULL CHECK (btrim("reason") <> ''),
  "authority_document_version_id" UUID,
  "decided_by_membership_id" UUID NOT NULL,
  "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "selection_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "selection_decisions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "selection_decisions_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_decisions_session_fkey"
    FOREIGN KEY ("agency_id", "session_id")
    REFERENCES "selection_board_sessions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_decisions_recommendation_fkey"
    FOREIGN KEY ("agency_id", "board_recommendation_id")
    REFERENCES "board_recommendations"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_decisions_authority_fkey"
    FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_decisions_decider_fkey"
    FOREIGN KEY ("agency_id", "decided_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "selection_decisions_agency_id_key" UNIQUE ("agency_id", "id")
);

-- At most one effective final Selection Decision per Application. A return
-- for further review remains repeatable and never masquerades as a final
-- selection.
CREATE UNIQUE INDEX "selection_decisions_final_application_key"
  ON "selection_decisions" ("application_id")
  WHERE "decision" IN ('SELECTED', 'NOT_SELECTED');

CREATE INDEX "selection_decisions_lookup_idx"
  ON "selection_decisions" ("agency_id", "application_id", "decided_at");

CREATE INDEX "selection_decisions_session_idx"
  ON "selection_decisions" ("agency_id", "session_id", "decision");

CREATE TABLE "recruitment_appointment_handoffs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "selection_decision_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "position_id" UUID NOT NULL,
  "selection_package" JSONB NOT NULL,
  "idempotency_key" TEXT NOT NULL CHECK (btrim("idempotency_key") <> ''),
  "handed_off_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMPTZ(6),
  CONSTRAINT "recruitment_appointment_handoffs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recruitment_appointment_handoffs_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "recruitment_appointment_handoffs_decision_fkey"
    FOREIGN KEY ("agency_id", "selection_decision_id")
    REFERENCES "selection_decisions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "recruitment_appointment_handoffs_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "recruitment_appointment_handoffs_position_fkey"
    FOREIGN KEY ("agency_id", "position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "recruitment_appointment_handoffs_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "recruitment_appointment_handoffs_decision_key" UNIQUE ("selection_decision_id"),
  CONSTRAINT "recruitment_appointment_handoffs_agency_decision_key"
    UNIQUE ("agency_id", "selection_decision_id"),
  CONSTRAINT "recruitment_appointment_handoffs_idempotency_key"
    UNIQUE ("agency_id", "idempotency_key")
);

CREATE OR REPLACE FUNCTION guard_selection_board_session_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Selection Board Sessions require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Selection Board Sessions are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Selection Board Sessions begin as drafts' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "vacancy_publications" publication
      JOIN "requests_to_fill" request
        ON request."agency_id" = publication."agency_id"
        AND request."id" = publication."request_to_fill_id"
      WHERE publication."agency_id" = NEW."agency_id"
        AND publication."id" = NEW."vacancy_publication_id"
        AND publication."status" = 'PUBLISHED'
        AND request."board_definition_id" = NEW."board_definition_id"
    ) THEN
      RAISE EXCEPTION 'Sessions must bind a published Vacancy Publication and its bound Board Definition' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."vacancy_publication_id" IS DISTINCT FROM NEW."vacancy_publication_id"
    OR OLD."board_definition_id" IS DISTINCT FROM NEW."board_definition_id"
    OR OLD."session_date" IS DISTINCT FROM NEW."session_date"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Selection Board Session identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Completed or cancelled Sessions are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('IN_PROGRESS', 'CANCELLED') THEN
    RAISE EXCEPTION 'Draft Session has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'IN_PROGRESS' AND NEW."status" NOT IN ('COMPLETED') THEN
    RAISE EXCEPTION 'Session under deliberation has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'IN_PROGRESS'
    AND (NEW."started_at" IS NULL OR NEW."roster_frozen_at" IS NULL) THEN
    RAISE EXCEPTION 'Deliberation requires a frozen roster and start time' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'COMPLETED' AND NEW."completed_at" IS NULL THEN
    RAISE EXCEPTION 'Completed Sessions require a completion time' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'CANCELLED'
    AND (NEW."cancelled_at" IS NULL OR NEW."cancellation_reason" IS NULL) THEN
    RAISE EXCEPTION 'Cancelled Sessions require a cancellation time and reason' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_board_roster_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  session_status TEXT;
  frozen_at TIMESTAMPTZ;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Board roster snapshots require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Board roster snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT session."status", session."roster_frozen_at" INTO session_status, frozen_at
  FROM "selection_board_sessions" session
  WHERE session."agency_id" = NEW."agency_id" AND session."id" = NEW."session_id";
  IF session_status IS NULL THEN
    RAISE EXCEPTION 'The Session for the roster snapshot does not exist' USING ERRCODE = '55000';
  END IF;
  IF session_status <> 'DRAFT' OR frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'The Board roster is frozen once deliberation begins' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_board_member_participation_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  session_status TEXT;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Board participation requires the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Board participation records are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT "status" INTO session_status
  FROM "selection_board_sessions"
  WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."session_id";
  IF session_status IS NULL THEN
    RAISE EXCEPTION 'The Session for the participation does not exist' USING ERRCODE = '55000';
  END IF;
  IF session_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Participation and attendance are frozen once deliberation begins' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "board_roster_snapshot_members" member
    WHERE member."agency_id" = NEW."agency_id"
      AND member."id" = NEW."roster_snapshot_member_id"
      AND member."session_id" = NEW."session_id"
      AND member."membership_id" = NEW."membership_id"
  ) THEN
    RAISE EXCEPTION 'Participation must reference the frozen Session roster' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_conflict_declaration_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  session_status TEXT;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Conflict declarations require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Conflict declarations are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT session."status" INTO session_status
  FROM "selection_board_sessions" session
  WHERE session."agency_id" = NEW."agency_id" AND session."id" = NEW."session_id";
  IF session_status IS NULL THEN
    RAISE EXCEPTION 'The Session for the conflict declaration does not exist' USING ERRCODE = '55000';
  END IF;
  IF session_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Conflict declarations are frozen once deliberation begins' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "board_member_participations" participation
    JOIN "applications" application
      ON application."agency_id" = participation."agency_id"
      AND application."vacancy_publication_id" = (
        SELECT session."vacancy_publication_id"
        FROM "selection_board_sessions" session
        WHERE session."agency_id" = participation."agency_id"
          AND session."id" = participation."session_id"
      )
    WHERE participation."agency_id" = NEW."agency_id"
      AND participation."id" = NEW."participation_id"
      AND participation."session_id" = NEW."session_id"
      AND application."id" = NEW."application_id"
  ) THEN
    RAISE EXCEPTION 'A conflict declaration must reference a Session participant and its publication Application' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_applicant_quorum_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  session_status TEXT;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Applicant quorum snapshots require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Applicant quorum snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT session."status" INTO session_status
  FROM "selection_board_sessions" session
  WHERE session."agency_id" = NEW."agency_id" AND session."id" = NEW."session_id";
  IF session_status IS NULL OR session_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Applicant quorum is frozen only when deliberation starts' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "applications" application
    JOIN "selection_board_sessions" session
      ON session."agency_id" = application."agency_id"
      AND session."vacancy_publication_id" = application."vacancy_publication_id"
    WHERE application."agency_id" = NEW."agency_id"
      AND application."id" = NEW."application_id"
      AND session."id" = NEW."session_id"
  ) THEN
    RAISE EXCEPTION 'An applicant quorum snapshot must reference an Application of the Session publication' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_board_recommendation_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  session_status TEXT;
  application_status TEXT;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Board Recommendations require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Board Recommendations are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT session."status" INTO session_status
  FROM "selection_board_sessions" session
  WHERE session."agency_id" = NEW."agency_id" AND session."id" = NEW."session_id";
  IF session_status IS NULL OR session_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Board Recommendations require an active Session' USING ERRCODE = '55000';
  END IF;
  SELECT application."status" INTO application_status
  FROM "applications" application
  WHERE application."agency_id" = NEW."agency_id" AND application."id" = NEW."application_id";
  IF application_status IS DISTINCT FROM 'FOR_DELIBERATION' THEN
    RAISE EXCEPTION 'Board Recommendations require an Application under deliberation' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "applicant_quorum_snapshots" quorum
    WHERE quorum."agency_id" = NEW."agency_id"
      AND quorum."session_id" = NEW."session_id"
      AND quorum."application_id" = NEW."application_id"
      AND quorum."satisfied"
  ) THEN
    RAISE EXCEPTION 'A satisfied applicant quorum is required before recommending' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_candidate_evaluation_report_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  session_status TEXT;
  latest_version INTEGER;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Candidate evaluation reports require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Candidate evaluation report versions are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT session."status" INTO session_status
  FROM "selection_board_sessions" session
  WHERE session."agency_id" = NEW."agency_id" AND session."id" = NEW."session_id";
  IF session_status NOT IN ('IN_PROGRESS', 'COMPLETED') THEN
    RAISE EXCEPTION 'Candidate evaluation reports require a started Session' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(MAX(report."version_no"), 0) INTO latest_version
  FROM "candidate_evaluation_report_versions" report
  WHERE report."agency_id" = NEW."agency_id" AND report."session_id" = NEW."session_id";
  IF NEW."version_no" <> latest_version + 1 THEN
    RAISE EXCEPTION 'Candidate evaluation report versions must advance exactly once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_selection_decision_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  session_status TEXT;
  application_status TEXT;
  source_session_id UUID;
  source_application_id UUID;
  source_recommendation TEXT;
  recommendation_found BOOLEAN;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Selection Decisions require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Selection Decisions are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT session."status" INTO session_status
  FROM "selection_board_sessions" session
  WHERE session."agency_id" = NEW."agency_id" AND session."id" = NEW."session_id";
  IF session_status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'Selection Decisions require a completed Board Session' USING ERRCODE = '55000';
  END IF;
  SELECT application."status" INTO application_status
  FROM "applications" application
  WHERE application."agency_id" = NEW."agency_id" AND application."id" = NEW."application_id";
  IF application_status IS DISTINCT FROM 'RECOMMENDED' THEN
    RAISE EXCEPTION 'Selection Decisions require a recommended Application' USING ERRCODE = '55000';
  END IF;
  SELECT TRUE, board_recommendation."session_id", board_recommendation."application_id",
         board_recommendation."recommendation"
    INTO recommendation_found, source_session_id, source_application_id, source_recommendation
  FROM "board_recommendations" board_recommendation
  WHERE board_recommendation."agency_id" = NEW."agency_id"
    AND board_recommendation."id" = NEW."board_recommendation_id";
  IF NOT COALESCE(recommendation_found, false) THEN
    RAISE EXCEPTION 'A Selection Decision must follow its Board Recommendation' USING ERRCODE = '55000';
  END IF;
  IF source_session_id IS DISTINCT FROM NEW."session_id"
    OR source_application_id IS DISTINCT FROM NEW."application_id" THEN
    RAISE EXCEPTION 'A Selection Decision must follow its Board Recommendation' USING ERRCODE = '55000';
  END IF;
  IF NEW."decision" IN ('SELECTED', 'NOT_SELECTED')
    AND source_recommendation <> 'RECOMMENDED' THEN
    RAISE EXCEPTION 'Only a recommended Board output can be selected or declined' USING ERRCODE = '55000';
  END IF;
  IF NEW."decision" = 'SELECTED' AND NEW."authority_document_version_id" IS NULL THEN
    RAISE EXCEPTION 'A selection requires the appointing authority evidence' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_recruitment_appointment_handoff_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  decision_type TEXT;
  application_status TEXT;
  position_status TEXT;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Recruitment handoffs require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Recruitment handoffs are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT decision."decision" INTO decision_type
  FROM "selection_decisions" decision
  WHERE decision."agency_id" = NEW."agency_id" AND decision."id" = NEW."selection_decision_id";
  IF decision_type IS DISTINCT FROM 'SELECTED' THEN
    RAISE EXCEPTION 'Only a selected candidate is handed to Appointment' USING ERRCODE = '55000';
  END IF;
  SELECT application."status" INTO application_status
  FROM "applications" application
  WHERE application."agency_id" = NEW."agency_id" AND application."id" = NEW."application_id";
  IF application_status IS DISTINCT FROM 'SELECTED' THEN
    RAISE EXCEPTION 'Handoffs require the selected Application' USING ERRCODE = '55000';
  END IF;
  SELECT position."status" INTO position_status
  FROM "plantilla_positions" position
  WHERE position."agency_id" = NEW."agency_id" AND position."id" = NEW."position_id";
  IF position_status IS DISTINCT FROM 'RESERVED' THEN
    RAISE EXCEPTION 'Handoffs require a reserved Plantilla Position' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "applications" application
    JOIN "vacancy_publications" publication
      ON publication."agency_id" = application."agency_id"
      AND publication."id" = application."vacancy_publication_id"
    JOIN "requests_to_fill" request
      ON request."agency_id" = publication."agency_id"
      AND request."id" = publication."request_to_fill_id"
    WHERE application."agency_id" = NEW."agency_id"
      AND application."id" = NEW."application_id"
      AND request."position_id" = NEW."position_id"
  ) THEN
    RAISE EXCEPTION 'The handed-off Position must be the Application vacancy item' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "selection_board_sessions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "selection_board_sessions"
  FOR EACH ROW EXECUTE FUNCTION guard_selection_board_session_mutation();
CREATE TRIGGER "board_roster_snapshot_members_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "board_roster_snapshot_members"
  FOR EACH ROW EXECUTE FUNCTION guard_board_roster_snapshot_mutation();
CREATE TRIGGER "board_member_participations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "board_member_participations"
  FOR EACH ROW EXECUTE FUNCTION guard_board_member_participation_mutation();
CREATE TRIGGER "conflict_declarations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "conflict_declarations"
  FOR EACH ROW EXECUTE FUNCTION guard_conflict_declaration_mutation();
CREATE TRIGGER "applicant_quorum_snapshots_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "applicant_quorum_snapshots"
  FOR EACH ROW EXECUTE FUNCTION guard_applicant_quorum_snapshot_mutation();
CREATE TRIGGER "board_recommendations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "board_recommendations"
  FOR EACH ROW EXECUTE FUNCTION guard_board_recommendation_mutation();
CREATE TRIGGER "candidate_evaluation_report_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "candidate_evaluation_report_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_candidate_evaluation_report_mutation();
CREATE TRIGGER "selection_decisions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "selection_decisions"
  FOR EACH ROW EXECUTE FUNCTION guard_selection_decision_mutation();
CREATE TRIGGER "recruitment_appointment_handoffs_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "recruitment_appointment_handoffs"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_appointment_handoff_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "selection_board_sessions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "board_roster_snapshot_members" TO hris_app;
GRANT SELECT, INSERT ON TABLE "board_member_participations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "conflict_declarations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "applicant_quorum_snapshots" TO hris_app;
GRANT SELECT, INSERT ON TABLE "board_recommendations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "candidate_evaluation_report_versions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "selection_decisions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "recruitment_appointment_handoffs" TO hris_app;

REVOKE UPDATE, DELETE ON TABLE "board_roster_snapshot_members" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "board_member_participations" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "conflict_declarations" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "applicant_quorum_snapshots" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "board_recommendations" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "candidate_evaluation_report_versions" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "selection_decisions" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "recruitment_appointment_handoffs" FROM hris_app;
REVOKE DELETE ON TABLE "selection_board_sessions" FROM hris_app;

ALTER TABLE "selection_board_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "selection_board_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "board_roster_snapshot_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_roster_snapshot_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "board_member_participations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_member_participations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "conflict_declarations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conflict_declarations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "applicant_quorum_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applicant_quorum_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "board_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_recommendations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "candidate_evaluation_report_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_evaluation_report_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "selection_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "selection_decisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "recruitment_appointment_handoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recruitment_appointment_handoffs" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'selection_board_sessions', 'board_roster_snapshot_members',
    'board_member_participations', 'conflict_declarations',
    'applicant_quorum_snapshots', 'board_recommendations',
    'candidate_evaluation_report_versions', 'selection_decisions',
    'recruitment_appointment_handoffs'
  ] LOOP
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING ("agency_id" = app_agency_id())', table_name || '_rls', table_name);
    EXECUTE format('CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK ("agency_id" = app_agency_id() AND current_setting(''app.recruitment_transition'', true) = ''on'')', table_name || '_insert_rls', table_name);
  END LOOP;
END;
$$;

CREATE POLICY "selection_board_sessions_update_rls"
  ON "selection_board_sessions" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on');

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('hrmpsb_member', 'HRMPSB Member', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('recruitment.deliberations.read', 'recruitment', 'MEDIUM', 'Read Selection Board Sessions and advisory board output'),
  ('recruitment.deliberations.submit', 'recruitment', 'HIGH', 'Administer Selection Board Sessions, participation, and deliberation'),
  ('recruitment.deliberations.recommend', 'recruitment', 'CRITICAL', 'Record board participation conflict declarations and recommendations'),
  ('recruitment.selection.select', 'recruitment', 'CRITICAL', 'Record the appointing authority Selection Decision'),
  ('recruitment.selection.decide', 'recruitment', 'CRITICAL', 'Decline selection or return board output for further review')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'recruitment.deliberations.read', 'recruitment.deliberations.submit'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'recruitment_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'recruitment.deliberations.read', 'recruitment.deliberations.recommend'
)
WHERE r."code" = 'hrmpsb_member' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'recruitment.deliberations.read', 'recruitment.selection.select', 'recruitment.selection.decide'
)
WHERE r."code" = 'appointing_authority' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'recruitment.deliberations.read'
WHERE r."code" = 'internal_auditor' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'selection_board_sessions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'board_roster_snapshot_members'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'board_member_participations'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'conflict_declarations'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'applicant_quorum_snapshots'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'board_recommendations'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'candidate_evaluation_report_versions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'selection_decisions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'recruitment_appointment_handoffs'::regclass), false) THEN
    RAISE EXCEPTION 'HRMPSB deliberation migration verification failed';
  END IF;
END;
$$;
