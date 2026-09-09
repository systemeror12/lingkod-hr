-- Preserve frozen Request to Fill bindings and closed publication facts even
-- when a caller has the Recruitment transition capability.

CREATE OR REPLACE FUNCTION guard_frozen_recruitment_request_facts()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF OLD."binding_frozen_at" IS NOT NULL AND (
    OLD."justification" IS DISTINCT FROM NEW."justification"
    OR OLD."qualification_standard_version_id" IS DISTINCT FROM NEW."qualification_standard_version_id"
    OR OLD."msp_plan_version_id" IS DISTINCT FROM NEW."msp_plan_version_id"
    OR OLD."criteria_set_id" IS DISTINCT FROM NEW."criteria_set_id"
    OR OLD."board_definition_id" IS DISTINCT FROM NEW."board_definition_id"
    OR OLD."binding_set_no" IS DISTINCT FROM NEW."binding_set_no"
    OR OLD."bindings_resolved_at" IS DISTINCT FROM NEW."bindings_resolved_at"
    OR OLD."binding_frozen_at" IS DISTINCT FROM NEW."binding_frozen_at"
    OR OLD."approval_request_id" IS DISTINCT FROM NEW."approval_request_id"
    OR OLD."submitted_at" IS DISTINCT FROM NEW."submitted_at"
    OR OLD."approved_at" IS DISTINCT FROM NEW."approved_at"
  ) THEN
    RAISE EXCEPTION 'Frozen Request to Fill facts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "requests_to_fill_frozen_facts_trigger"
  BEFORE UPDATE ON "requests_to_fill"
  FOR EACH ROW EXECUTE FUNCTION guard_frozen_recruitment_request_facts();

CREATE OR REPLACE FUNCTION guard_closed_recruitment_publication_facts()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF OLD."status" IN ('CLOSED', 'CANCELLED')
    AND NEW."status" = 'REPUBLISHED'
    AND (
      (to_jsonb(OLD) - ARRAY['status', 'updated_by_membership_id', 'updated_at', 'row_version'])
      IS DISTINCT FROM
      (to_jsonb(NEW) - ARRAY['status', 'updated_by_membership_id', 'updated_at', 'row_version'])
    ) THEN
    RAISE EXCEPTION 'Closed or cancelled Vacancy Publication facts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vacancy_publications_closed_facts_trigger"
  BEFORE UPDATE ON "vacancy_publications"
  FOR EACH ROW EXECUTE FUNCTION guard_closed_recruitment_publication_facts();

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'approvals.requests.cancel'
WHERE r."code" = 'recruitment_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
