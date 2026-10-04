-- Phase 6 Recruitment foundation. Recruitment owns request-to-fill and
-- publication records; Plantilla, Documents, and Approvals remain owners of
-- their respective records and are reached through their service contracts.

CREATE TABLE "agency_merit_selection_plan_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "plan_code" CITEXT NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "applicability" JSONB NOT NULL DEFAULT '{}',
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "approval_document_version_id" UUID,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agency_merit_selection_plan_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_merit_selection_plan_versions_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "agency_merit_selection_plan_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "agency_merit_selection_plan_versions_approval_document_version_fkey"
    FOREIGN KEY ("agency_id", "approval_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "agency_merit_selection_plan_versions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "agency_merit_selection_plan_versions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "agency_merit_selection_plan_versions_agency_id_key"
    UNIQUE ("agency_id", "id"),
  CONSTRAINT "agency_merit_selection_plan_versions_agency_plan_version_key"
    UNIQUE ("agency_id", "plan_code", "version_no")
);

CREATE INDEX "agency_merit_selection_plan_versions_lookup_idx"
  ON "agency_merit_selection_plan_versions" ("agency_id", "status", "effective_from");

CREATE TABLE "merit_selection_criteria_sets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "plan_version_id" UUID NOT NULL,
  "criteria_code" CITEXT NOT NULL,
  "applicability" JSONB NOT NULL DEFAULT '{}',
  "criteria_definition" JSONB NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merit_selection_criteria_sets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "merit_selection_criteria_sets_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "merit_selection_criteria_sets_plan_fkey"
    FOREIGN KEY ("agency_id", "plan_version_id")
    REFERENCES "agency_merit_selection_plan_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "merit_selection_criteria_sets_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "merit_selection_criteria_sets_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "merit_selection_criteria_sets_agency_id_key"
    UNIQUE ("agency_id", "id"),
  CONSTRAINT "merit_selection_criteria_sets_plan_code_key"
    UNIQUE ("agency_id", "plan_version_id", "criteria_code")
);

CREATE INDEX "merit_selection_criteria_sets_lookup_idx"
  ON "merit_selection_criteria_sets" ("agency_id", "status");

CREATE TABLE "board_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "plan_version_id" UUID NOT NULL,
  "board_code" CITEXT NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "applicability" JSONB NOT NULL DEFAULT '{}',
  "seat_definition" JSONB NOT NULL,
  "quorum_definition" JSONB NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "board_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_definitions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "board_definitions_plan_fkey"
    FOREIGN KEY ("agency_id", "plan_version_id")
    REFERENCES "agency_merit_selection_plan_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_definitions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_definitions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_definitions_agency_id_key"
    UNIQUE ("agency_id", "id"),
  CONSTRAINT "board_definitions_plan_board_version_key"
    UNIQUE ("agency_id", "plan_version_id", "board_code", "version_no")
);

CREATE INDEX "board_definitions_lookup_idx"
  ON "board_definitions" ("agency_id", "status");

CREATE TABLE "board_appointments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "board_definition_id" UUID NOT NULL,
  "seat_code" CITEXT NOT NULL,
  "membership_id" UUID NOT NULL,
  "appointment_kind" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "authority_document_version_id" UUID,
  "status" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "board_appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_appointments_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "board_appointments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "board_appointments_board_fkey"
    FOREIGN KEY ("agency_id", "board_definition_id")
    REFERENCES "board_definitions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_appointments_membership_fkey"
    FOREIGN KEY ("agency_id", "membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_appointments_authority_document_version_fkey"
    FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_appointments_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "board_appointments_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "board_appointments_identity_key"
    UNIQUE ("agency_id", "board_definition_id", "seat_code", "membership_id", "effective_from")
);

CREATE INDEX "board_appointments_lookup_idx"
  ON "board_appointments" ("agency_id", "board_definition_id", "seat_code", "effective_from");

CREATE SEQUENCE "requests_to_fill_request_no_seq";

CREATE TABLE "requests_to_fill" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "request_no" INTEGER NOT NULL DEFAULT nextval('requests_to_fill_request_no_seq'),
  "position_id" UUID NOT NULL,
  "requesting_unit_id" UUID NOT NULL,
  "requested_by_membership_id" UUID NOT NULL,
  "justification" TEXT NOT NULL,
  "qualification_standard_version_id" UUID NOT NULL,
  "msp_plan_version_id" UUID,
  "criteria_set_id" UUID,
  "board_definition_id" UUID,
  "binding_set_no" INTEGER NOT NULL DEFAULT 0 CHECK ("binding_set_no" >= 0),
  "bindings_resolved_at" TIMESTAMPTZ(6),
  "binding_frozen_at" TIMESTAMPTZ(6),
  "approval_request_id" UUID,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'FOR_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'CLOSED')),
  "submitted_at" TIMESTAMPTZ(6),
  "approved_at" TIMESTAMPTZ(6),
  "closed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "requests_to_fill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "requests_to_fill_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_position_fkey"
    FOREIGN KEY ("agency_id", "position_id") REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_requesting_unit_fkey"
    FOREIGN KEY ("agency_id", "requesting_unit_id") REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_requester_fkey"
    FOREIGN KEY ("agency_id", "requested_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_qualification_fkey"
    FOREIGN KEY ("agency_id", "qualification_standard_version_id") REFERENCES "qualification_standard_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_msp_plan_fkey"
    FOREIGN KEY ("agency_id", "msp_plan_version_id") REFERENCES "agency_merit_selection_plan_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_criteria_fkey"
    FOREIGN KEY ("agency_id", "criteria_set_id") REFERENCES "merit_selection_criteria_sets"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_board_fkey"
    FOREIGN KEY ("agency_id", "board_definition_id") REFERENCES "board_definitions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "requests_to_fill_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "requests_to_fill_agency_request_no_key" UNIQUE ("agency_id", "request_no")
);

CREATE UNIQUE INDEX "requests_to_fill_one_active_position_uq"
  ON "requests_to_fill" ("agency_id", "position_id")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'FOR_REVIEW', 'APPROVED');

CREATE INDEX "requests_to_fill_status_idx"
  ON "requests_to_fill" ("agency_id", "status", "created_at");
CREATE INDEX "requests_to_fill_position_idx"
  ON "requests_to_fill" ("agency_id", "position_id", "status");

CREATE TABLE "request_approval_route_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "request_to_fill_id" UUID NOT NULL,
  "binding_set_no" INTEGER NOT NULL CHECK ("binding_set_no" > 0),
  "checkpoint_code" TEXT NOT NULL,
  "approval_route_version_id" UUID NOT NULL,
  "bound_by_membership_id" UUID NOT NULL,
  "bound_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "request_approval_route_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "request_approval_route_bindings_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "request_approval_route_bindings_request_fkey"
    FOREIGN KEY ("agency_id", "request_to_fill_id") REFERENCES "requests_to_fill"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_approval_route_bindings_route_fkey"
    FOREIGN KEY ("agency_id", "approval_route_version_id") REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_approval_route_bindings_member_fkey"
    FOREIGN KEY ("agency_id", "bound_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_approval_route_bindings_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "request_approval_route_bindings_identity_key"
    UNIQUE ("agency_id", "request_to_fill_id", "binding_set_no", "checkpoint_code")
);

CREATE INDEX "request_approval_route_bindings_lookup_idx"
  ON "request_approval_route_bindings" ("agency_id", "request_to_fill_id", "binding_set_no");

CREATE TABLE "request_msp_rebaselines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "request_to_fill_id" UUID NOT NULL,
  "from_msp_plan_version_id" UUID,
  "from_criteria_set_id" UUID,
  "from_board_definition_id" UUID,
  "to_msp_plan_version_id" UUID,
  "to_criteria_set_id" UUID,
  "to_board_definition_id" UUID,
  "reason" TEXT NOT NULL,
  "authorized_by_membership_id" UUID NOT NULL,
  "authority_document_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "request_msp_rebaselines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "request_msp_rebaselines_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_request_fkey"
    FOREIGN KEY ("agency_id", "request_to_fill_id") REFERENCES "requests_to_fill"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_from_plan_fkey"
    FOREIGN KEY ("agency_id", "from_msp_plan_version_id") REFERENCES "agency_merit_selection_plan_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_from_criteria_fkey"
    FOREIGN KEY ("agency_id", "from_criteria_set_id") REFERENCES "merit_selection_criteria_sets"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_from_board_fkey"
    FOREIGN KEY ("agency_id", "from_board_definition_id") REFERENCES "board_definitions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_to_plan_fkey"
    FOREIGN KEY ("agency_id", "to_msp_plan_version_id") REFERENCES "agency_merit_selection_plan_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_to_criteria_fkey"
    FOREIGN KEY ("agency_id", "to_criteria_set_id") REFERENCES "merit_selection_criteria_sets"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_to_board_fkey"
    FOREIGN KEY ("agency_id", "to_board_definition_id") REFERENCES "board_definitions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_authorizer_fkey"
    FOREIGN KEY ("agency_id", "authorized_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_authority_document_version_fkey"
    FOREIGN KEY ("agency_id", "authority_document_version_id") REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "request_msp_rebaselines_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "request_msp_rebaselines_lookup_idx"
  ON "request_msp_rebaselines" ("agency_id", "request_to_fill_id", "created_at");

CREATE SEQUENCE "vacancy_publications_publication_no_seq";

CREATE TABLE "vacancy_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "publication_no" INTEGER NOT NULL DEFAULT nextval('vacancy_publications_publication_no_seq'),
  "request_to_fill_id" UUID NOT NULL,
  "qualification_standard_version_id" UUID NOT NULL,
  "form_document_version_id" UUID NOT NULL,
  "approval_route_version_id" UUID NOT NULL,
  "approval_request_id" UUID,
  "opening_date" DATE NOT NULL,
  "closing_date" DATE NOT NULL,
  "channels" JSONB NOT NULL DEFAULT '[]',
  "position_details" JSONB NOT NULL DEFAULT '{}',
  "application_requirements" JSONB NOT NULL DEFAULT '[]',
  "contact_details" JSONB NOT NULL DEFAULT '{}',
  "hrmo_certification" JSONB,
  "certified_by_membership_id" UUID,
  "certified_at" TIMESTAMPTZ(6),
  "republication_of_id" UUID,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'FOR_APPROVAL', 'PUBLISHED', 'CLOSED', 'CANCELLED', 'REPUBLISHED')),
  "closed_at" TIMESTAMPTZ(6),
  "cancellation_reason" TEXT,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "vacancy_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vacancy_publications_period_check" CHECK ("closing_date" >= "opening_date"),
  CONSTRAINT "vacancy_publications_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_request_fkey"
    FOREIGN KEY ("agency_id", "request_to_fill_id") REFERENCES "requests_to_fill"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_qualification_fkey"
    FOREIGN KEY ("agency_id", "qualification_standard_version_id") REFERENCES "qualification_standard_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_form_fkey"
    FOREIGN KEY ("agency_id", "form_document_version_id") REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_route_fkey"
    FOREIGN KEY ("agency_id", "approval_route_version_id") REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_certifier_fkey"
    FOREIGN KEY ("agency_id", "certified_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_republication_fkey"
    FOREIGN KEY ("agency_id", "republication_of_id") REFERENCES "vacancy_publications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publications_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "vacancy_publications_agency_publication_no_key" UNIQUE ("agency_id", "publication_no")
);

CREATE UNIQUE INDEX "vacancy_publications_one_active_request_uq"
  ON "vacancy_publications" ("agency_id", "request_to_fill_id")
  WHERE "status" IN ('DRAFT', 'FOR_APPROVAL', 'PUBLISHED');

CREATE INDEX "vacancy_publications_status_idx"
  ON "vacancy_publications" ("agency_id", "status", "opening_date");
CREATE INDEX "vacancy_publications_request_idx"
  ON "vacancy_publications" ("agency_id", "request_to_fill_id", "status");

CREATE TABLE "vacancy_publication_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "publication_id" UUID NOT NULL,
  "channel_type" TEXT NOT NULL CHECK ("channel_type" IN ('CSC_FIELD_OFFICE', 'CSC_JOB_PORTAL', 'AGENCY_POSTING_PLACE', 'SUPPLEMENTAL')),
  "location" TEXT NOT NULL,
  "reference" TEXT,
  "published_at" TIMESTAMPTZ(6) NOT NULL,
  "removed_at" TIMESTAMPTZ(6),
  "evidence_document_version_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vacancy_publication_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vacancy_publication_evidence_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publication_evidence_publication_fkey"
    FOREIGN KEY ("agency_id", "publication_id") REFERENCES "vacancy_publications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publication_evidence_document_version_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id") REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publication_evidence_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "vacancy_publication_evidence_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "vacancy_publication_evidence_lookup_idx"
  ON "vacancy_publication_evidence" ("agency_id", "publication_id", "channel_type");

CREATE OR REPLACE FUNCTION guard_recruitment_configuration_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Recruitment configuration is retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Recruitment configuration changes require the application service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Recruitment configuration identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Recruitment configuration is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Active Recruitment configuration can only be superseded' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'Draft Recruitment configuration has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ACTIVE'
    AND (to_jsonb(OLD) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'Active Recruitment configuration facts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_recruitment_request_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Requests to Fill are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Requests to Fill require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."request_no" IS DISTINCT FROM NEW."request_no"
    OR OLD."position_id" IS DISTINCT FROM NEW."position_id"
    OR OLD."requesting_unit_id" IS DISTINCT FROM NEW."requesting_unit_id"
    OR OLD."requested_by_membership_id" IS DISTINCT FROM NEW."requested_by_membership_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Request to Fill identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('REJECTED', 'CANCELLED', 'CLOSED') THEN
    RAISE EXCEPTION 'Completed Request to Fill records are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'SUBMITTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Draft Request to Fill has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'SUBMITTED' AND NEW."status" NOT IN ('SUBMITTED', 'FOR_REVIEW', 'CANCELLED') THEN
    RAISE EXCEPTION 'Submitted Request to Fill has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'FOR_REVIEW' AND NEW."status" NOT IN ('FOR_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Request to Fill under review has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Approved Request to Fill has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."binding_frozen_at" IS NOT NULL AND (
    OLD."justification" IS DISTINCT FROM NEW."justification"
    OR OLD."qualification_standard_version_id" IS DISTINCT FROM NEW."qualification_standard_version_id"
    OR OLD."msp_plan_version_id" IS DISTINCT FROM NEW."msp_plan_version_id"
    OR OLD."criteria_set_id" IS DISTINCT FROM NEW."criteria_set_id"
    OR OLD."board_definition_id" IS DISTINCT FROM NEW."board_definition_id"
  ) THEN
    RAISE EXCEPTION 'Frozen Request to Fill bindings are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_recruitment_publication_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Vacancy Publications are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Vacancy Publications require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."publication_no" IS DISTINCT FROM NEW."publication_no"
    OR OLD."request_to_fill_id" IS DISTINCT FROM NEW."request_to_fill_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Vacancy Publication identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Closed or cancelled Vacancy Publications are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'FOR_APPROVAL', 'CANCELLED') THEN
    RAISE EXCEPTION 'Draft Vacancy Publication has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'FOR_APPROVAL' AND NEW."status" NOT IN ('FOR_APPROVAL', 'DRAFT', 'PUBLISHED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Vacancy Publication under approval has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'PUBLISHED' AND NEW."status" NOT IN ('PUBLISHED', 'CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Published Vacancy Publication has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'PUBLISHED' AND (
    OLD."request_to_fill_id" IS DISTINCT FROM NEW."request_to_fill_id"
    OR OLD."qualification_standard_version_id" IS DISTINCT FROM NEW."qualification_standard_version_id"
    OR OLD."form_document_version_id" IS DISTINCT FROM NEW."form_document_version_id"
    OR OLD."approval_route_version_id" IS DISTINCT FROM NEW."approval_route_version_id"
    OR OLD."opening_date" IS DISTINCT FROM NEW."opening_date"
    OR OLD."closing_date" IS DISTINCT FROM NEW."closing_date"
    OR OLD."channels" IS DISTINCT FROM NEW."channels"
    OR OLD."position_details" IS DISTINCT FROM NEW."position_details"
    OR OLD."application_requirements" IS DISTINCT FROM NEW."application_requirements"
    OR OLD."contact_details" IS DISTINCT FROM NEW."contact_details"
    OR OLD."hrmo_certification" IS DISTINCT FROM NEW."hrmo_certification"
  ) THEN
    RAISE EXCEPTION 'Published Vacancy Publication facts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_recruitment_append_only()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Recruitment evidence and snapshots are append-only' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Recruitment evidence and snapshots require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agency_merit_selection_plan_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "agency_merit_selection_plan_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_configuration_mutation();
CREATE TRIGGER "merit_selection_criteria_sets_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "merit_selection_criteria_sets"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_configuration_mutation();
CREATE TRIGGER "board_definitions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "board_definitions"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_configuration_mutation();
CREATE TRIGGER "board_appointments_append_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "board_appointments"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_append_only();
CREATE TRIGGER "requests_to_fill_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "requests_to_fill"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_request_mutation();
CREATE TRIGGER "request_approval_route_bindings_append_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "request_approval_route_bindings"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_append_only();
CREATE TRIGGER "request_msp_rebaselines_append_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "request_msp_rebaselines"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_append_only();
CREATE TRIGGER "vacancy_publications_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "vacancy_publications"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_publication_mutation();
CREATE TRIGGER "vacancy_publication_evidence_append_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "vacancy_publication_evidence"
  FOR EACH ROW EXECUTE FUNCTION guard_recruitment_append_only();

GRANT USAGE, SELECT ON SEQUENCE "requests_to_fill_request_no_seq" TO hris_app;
GRANT USAGE, SELECT ON SEQUENCE "vacancy_publications_publication_no_seq" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "agency_merit_selection_plan_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "merit_selection_criteria_sets" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "board_definitions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "board_appointments" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "requests_to_fill" TO hris_app;
GRANT SELECT, INSERT ON TABLE "request_approval_route_bindings" TO hris_app;
GRANT SELECT, INSERT ON TABLE "request_msp_rebaselines" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "vacancy_publications" TO hris_app;
GRANT SELECT, INSERT ON TABLE "vacancy_publication_evidence" TO hris_app;

ALTER TABLE "agency_merit_selection_plan_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_merit_selection_plan_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "merit_selection_criteria_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merit_selection_criteria_sets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "board_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "board_appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_appointments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "requests_to_fill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requests_to_fill" FORCE ROW LEVEL SECURITY;
ALTER TABLE "request_approval_route_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_approval_route_bindings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "request_msp_rebaselines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_msp_rebaselines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_publications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_publication_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_publication_evidence" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agency_merit_selection_plan_versions', 'merit_selection_criteria_sets',
    'board_definitions', 'board_appointments', 'requests_to_fill',
    'request_approval_route_bindings', 'request_msp_rebaselines',
    'vacancy_publications', 'vacancy_publication_evidence'
  ] LOOP
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING ("agency_id" = app_agency_id())', table_name || '_rls', table_name);
    EXECUTE format('CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK ("agency_id" = app_agency_id() AND current_setting(''app.recruitment_transition'', true) = ''on'')', table_name || '_insert_rls', table_name);
  END LOOP;
END;
$$;

CREATE POLICY "agency_merit_selection_plan_versions_update_rls"
  ON "agency_merit_selection_plan_versions" FOR UPDATE
  USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "merit_selection_criteria_sets_update_rls"
  ON "merit_selection_criteria_sets" FOR UPDATE
  USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "board_definitions_update_rls"
  ON "board_definitions" FOR UPDATE
  USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "requests_to_fill_update_rls"
  ON "requests_to_fill" FOR UPDATE
  USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "vacancy_publications_update_rls"
  ON "vacancy_publications" FOR UPDATE
  USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

REVOKE UPDATE, DELETE ON TABLE "board_appointments" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "request_approval_route_bindings" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "request_msp_rebaselines" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "vacancy_publication_evidence" FROM hris_app;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('recruitment.requests.read', 'recruitment', 'MEDIUM', 'Read Requests to Fill'),
  ('recruitment.requests.create', 'recruitment', 'HIGH', 'Create Requests to Fill'),
  ('recruitment.requests.submit', 'recruitment', 'HIGH', 'Submit Requests to Fill'),
  ('recruitment.requests.review', 'recruitment', 'HIGH', 'Resolve Request to Fill governing configuration'),
  ('recruitment.requests.rebaseline', 'recruitment', 'CRITICAL', 'Rebaseline Request to Fill governing configuration'),
  ('recruitment.requests.approve', 'recruitment', 'CRITICAL', 'Approve Requests to Fill'),
  ('recruitment.requests.reject', 'recruitment', 'CRITICAL', 'Reject Requests to Fill'),
  ('recruitment.requests.cancel', 'recruitment', 'HIGH', 'Cancel Requests to Fill'),
  ('recruitment.requests.close', 'recruitment', 'HIGH', 'Close Requests to Fill'),
  ('recruitment.vacancies.read', 'recruitment', 'MEDIUM', 'Read Vacancy Publications'),
  ('recruitment.vacancies.create', 'recruitment', 'HIGH', 'Create Vacancy Publications'),
  ('recruitment.vacancies.submit', 'recruitment', 'HIGH', 'Submit Vacancy Publications'),
  ('recruitment.vacancies.publish', 'recruitment', 'CRITICAL', 'Publish Vacancy Publications'),
  ('recruitment.vacancies.return', 'recruitment', 'HIGH', 'Return Vacancy Publications'),
  ('recruitment.vacancies.close', 'recruitment', 'HIGH', 'Close Vacancy Publications'),
  ('recruitment.vacancies.cancel', 'recruitment', 'CRITICAL', 'Cancel Vacancy Publications'),
  ('recruitment.vacancies.republish', 'recruitment', 'CRITICAL', 'Republish Vacancy Publications')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" LIKE 'recruitment.%'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'recruitment.requests.read', 'recruitment.requests.create', 'recruitment.requests.submit',
  'recruitment.requests.review', 'recruitment.requests.rebaseline', 'recruitment.requests.approve',
  'recruitment.requests.reject', 'recruitment.requests.cancel', 'recruitment.requests.close',
  'recruitment.vacancies.read', 'recruitment.vacancies.create', 'recruitment.vacancies.submit',
  'recruitment.vacancies.publish', 'recruitment.vacancies.return', 'recruitment.vacancies.close',
  'recruitment.vacancies.cancel', 'recruitment.vacancies.republish'
)
WHERE r."code" = 'recruitment_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'recruitment.requests.read', 'recruitment.requests.create', 'recruitment.requests.submit'
)
WHERE r."code" = 'plantilla_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'recruitment.requests.read', 'recruitment.requests.review', 'recruitment.vacancies.read'
)
WHERE r."code" = 'internal_auditor' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'recruitment.requests.read', 'recruitment.requests.approve', 'recruitment.requests.reject',
  'recruitment.vacancies.read', 'recruitment.vacancies.publish'
)
WHERE r."code" = 'appointing_authority' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'requests_to_fill'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'vacancy_publications'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'vacancy_publication_evidence'::regclass), false) THEN
    RAISE EXCEPTION 'Recruitment capability migration verification failed';
  END IF;
END;
$$;
