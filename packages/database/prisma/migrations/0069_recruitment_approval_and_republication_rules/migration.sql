-- Recruitment uses Approval as an app-service contract. Its operational roles
-- may resolve and submit the route snapshot without receiving route-admin power.

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'approvals.routes.read', 'approvals.requests.read', 'approvals.requests.create',
  'approvals.requests.submit'
)
WHERE r."code" = 'recruitment_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

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
  IF OLD."status" = 'FOR_REVIEW' AND NEW."status" NOT IN ('FOR_REVIEW', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED') THEN
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
  IF OLD."status" = 'REPUBLISHED' THEN
    RAISE EXCEPTION 'Completed or superseded Vacancy Publications are immutable' USING ERRCODE = '55000';
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
  IF OLD."status" IN ('CLOSED', 'CANCELLED') AND NEW."status" <> 'REPUBLISHED' THEN
    RAISE EXCEPTION 'Closed or cancelled Vacancy Publication has an invalid transition' USING ERRCODE = '55000';
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
