-- Phase 6 shared approval capability. Route definitions are configuration;
-- approval requests snapshot their resolved memberships into approval_steps.

CREATE TABLE "approval_route_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "route_code" CITEXT NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "domain" TEXT NOT NULL,
  "step_definition" JSONB NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_route_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_route_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  CONSTRAINT "approval_route_versions_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "approval_route_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "approval_route_versions_agency_route_version_key"
    UNIQUE ("agency_id", "route_code", "version_no"),
  CONSTRAINT "approval_route_versions_agency_id_key"
    UNIQUE ("agency_id", "id")
);

ALTER TABLE "approval_route_versions"
  ADD CONSTRAINT "approval_route_versions_active_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    ("route_code"::TEXT) WITH =,
    DATERANGE("effective_from", COALESCE("effective_to", 'infinity'::DATE), '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE INDEX "approval_route_versions_lookup_idx"
  ON "approval_route_versions" ("agency_id", "route_code", "status", "effective_from");

CREATE TABLE "approval_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "route_version_id" UUID NOT NULL,
  "subject_type" TEXT NOT NULL,
  "subject_id" UUID NOT NULL,
  "requested_by_membership_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "current_step_no" INTEGER,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_requests_status_check"
    CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT "approval_requests_current_step_check"
    CHECK ("current_step_no" IS NULL OR "current_step_no" > 0),
  CONSTRAINT "approval_requests_completion_check"
    CHECK (
      ("status" IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED') AND "completed_at" IS NOT NULL)
      OR ("status" IN ('PENDING', 'IN_PROGRESS', 'RETURNED') AND "completed_at" IS NULL)
    ),
  CONSTRAINT "approval_requests_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "approval_requests_route_version_fkey"
    FOREIGN KEY ("agency_id", "route_version_id")
    REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "approval_requests_requester_fkey"
    FOREIGN KEY ("agency_id", "requested_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "approval_requests_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "approval_requests_one_active_subject_uq"
  ON "approval_requests" ("agency_id", "subject_type", "subject_id")
  WHERE "status" IN ('PENDING', 'IN_PROGRESS', 'RETURNED');

CREATE INDEX "approval_requests_status_idx"
  ON "approval_requests" ("agency_id", "status", "requested_at");

CREATE TABLE "approval_steps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "approval_request_id" UUID NOT NULL,
  "step_no" INTEGER NOT NULL CHECK ("step_no" > 0),
  "step_mode" TEXT NOT NULL,
  "required_permission" CITEXT NOT NULL,
  "assigned_membership_id" UUID,
  "assigned_role_code" CITEXT,
  "requires_separate_review" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" TEXT NOT NULL,
  "activated_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_steps_mode_check"
    CHECK ("step_mode" IN ('SEQUENTIAL', 'PARALLEL_ANY', 'PARALLEL_ALL')),
  CONSTRAINT "approval_steps_status_check"
    CHECK ("status" IN ('PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'EXPIRED')),
  CONSTRAINT "approval_steps_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "approval_steps_request_fkey"
    FOREIGN KEY ("agency_id", "approval_request_id")
    REFERENCES "approval_requests"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "approval_steps_permission_fkey"
    FOREIGN KEY ("required_permission") REFERENCES "permissions"("code") ON DELETE RESTRICT,
  CONSTRAINT "approval_steps_assignee_fkey"
    FOREIGN KEY ("agency_id", "assigned_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "approval_steps_agency_id_key"
    UNIQUE ("agency_id", "id"),
  CONSTRAINT "approval_steps_request_step_assignee_key"
    UNIQUE ("approval_request_id", "step_no", "assigned_membership_id")
);

CREATE INDEX "approval_steps_request_status_idx"
  ON "approval_steps" ("agency_id", "approval_request_id", "step_no", "status");

CREATE TABLE "approval_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "approval_step_id" UUID NOT NULL,
  "decided_by_membership_id" UUID NOT NULL,
  "decision" TEXT NOT NULL,
  "comments" TEXT,
  "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delegated_authority_id" UUID,
  "request_id" TEXT,
  CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_decisions_decision_check"
    CHECK ("decision" IN ('APPROVE', 'REJECT', 'RETURN', 'ABSTAIN', 'DELEGATE')),
  CONSTRAINT "approval_decisions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "approval_decisions_step_fkey"
    FOREIGN KEY ("agency_id", "approval_step_id")
    REFERENCES "approval_steps"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "approval_decisions_decider_fkey"
    FOREIGN KEY ("agency_id", "decided_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "approval_decisions_delegation_fkey"
    FOREIGN KEY ("agency_id", "delegated_authority_id")
    REFERENCES "delegated_authorities"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "approval_decisions_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE INDEX "approval_decisions_step_idx"
  ON "approval_decisions" ("agency_id", "approval_step_id", "decided_at");

CREATE OR REPLACE FUNCTION guard_approval_route_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approval Route Versions are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.approval_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Approval Route changes require the application service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."route_code" IS DISTINCT FROM NEW."route_code"
    OR OLD."version_no" IS DISTINCT FROM NEW."version_no"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Approval Route Version identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Approval Route Versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ACTIVE' AND (
    NEW."status" <> 'SUPERSEDED'
    OR OLD."domain" IS DISTINCT FROM NEW."domain"
    OR OLD."step_definition" IS DISTINCT FROM NEW."step_definition"
    OR OLD."effective_from" IS DISTINCT FROM NEW."effective_from"
    OR NEW."effective_to" IS NULL
  ) THEN
    RAISE EXCEPTION 'Active Approval Route Version facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'Draft Approval Route Version has an invalid transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_approval_request_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approval Requests are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.approval_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Approval Request changes require the application service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."route_version_id" IS DISTINCT FROM NEW."route_version_id"
    OR OLD."subject_type" IS DISTINCT FROM NEW."subject_type"
    OR OLD."subject_id" IS DISTINCT FROM NEW."subject_id"
    OR OLD."requested_by_membership_id" IS DISTINCT FROM NEW."requested_by_membership_id"
    OR OLD."requested_at" IS DISTINCT FROM NEW."requested_at" THEN
    RAISE EXCEPTION 'Approval Request snapshot identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Completed Approval Requests are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'PENDING' AND NEW."status" NOT IN ('IN_PROGRESS', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pending Approval Request has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'RETURNED' AND NEW."status" NOT IN ('IN_PROGRESS', 'CANCELLED') THEN
    RAISE EXCEPTION 'Returned Approval Request has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'IN_PROGRESS' AND NEW."status" NOT IN ('IN_PROGRESS', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION 'In-progress Approval Request has an invalid transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_approval_step_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approval Steps are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.approval_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Approval Step changes require the application service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."approval_request_id" IS DISTINCT FROM NEW."approval_request_id"
    OR OLD."step_no" IS DISTINCT FROM NEW."step_no"
    OR OLD."step_mode" IS DISTINCT FROM NEW."step_mode"
    OR OLD."required_permission" IS DISTINCT FROM NEW."required_permission"
    OR OLD."assigned_membership_id" IS DISTINCT FROM NEW."assigned_membership_id"
    OR OLD."assigned_role_code" IS DISTINCT FROM NEW."assigned_role_code"
    OR OLD."requires_separate_review" IS DISTINCT FROM NEW."requires_separate_review" THEN
    RAISE EXCEPTION 'Approval Step snapshot facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('APPROVED', 'REJECTED', 'SKIPPED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Completed Approval Steps are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'PENDING' AND NEW."status" NOT IN ('ACTIVE', 'SKIPPED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Pending Approval Step has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Active Approval Step has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'RETURNED' AND NEW."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Returned Approval Step must be resumed or remain returned' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_approval_decision_append_only()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Approval Decisions are immutable' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.approval_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Approval Decisions require the application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "approval_route_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "approval_route_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_approval_route_version_mutation();
CREATE TRIGGER "approval_requests_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "approval_requests"
  FOR EACH ROW EXECUTE FUNCTION guard_approval_request_mutation();
CREATE TRIGGER "approval_steps_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "approval_steps"
  FOR EACH ROW EXECUTE FUNCTION guard_approval_step_mutation();
CREATE TRIGGER "approval_decisions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION guard_approval_decision_append_only();

GRANT SELECT, INSERT, UPDATE ON TABLE "approval_route_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "approval_requests" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "approval_steps" TO hris_app;
GRANT SELECT, INSERT ON TABLE "approval_decisions" TO hris_app;

ALTER TABLE "approval_route_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_route_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "approval_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_steps" FORCE ROW LEVEL SECURITY;
ALTER TABLE "approval_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_decisions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "approval_route_versions_select" ON "approval_route_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "approval_route_versions_insert" ON "approval_route_versions"
  FOR INSERT WITH CHECK (
    "agency_id" = app_agency_id()
    AND current_setting('app.approval_transition', true) = 'on'
  );
CREATE POLICY "approval_route_versions_update" ON "approval_route_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "approval_requests_select" ON "approval_requests"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "approval_requests_insert" ON "approval_requests"
  FOR INSERT WITH CHECK (
    "agency_id" = app_agency_id()
    AND current_setting('app.approval_transition', true) = 'on'
  );
CREATE POLICY "approval_requests_update" ON "approval_requests"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "approval_steps_select" ON "approval_steps"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "approval_steps_insert" ON "approval_steps"
  FOR INSERT WITH CHECK (
    "agency_id" = app_agency_id()
    AND current_setting('app.approval_transition', true) = 'on'
  );
CREATE POLICY "approval_steps_update" ON "approval_steps"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "approval_decisions_select" ON "approval_decisions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "approval_decisions_insert" ON "approval_decisions"
  FOR INSERT WITH CHECK (
    "agency_id" = app_agency_id()
    AND current_setting('app.approval_transition', true) = 'on'
  );

REVOKE DELETE, UPDATE ON TABLE "approval_decisions" FROM hris_app;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('approvals.routes.read', 'approvals', 'MEDIUM', 'Read Agency Approval Route Versions'),
  ('approvals.routes.create', 'approvals', 'HIGH', 'Create Draft Approval Route Versions'),
  ('approvals.routes.update', 'approvals', 'HIGH', 'Update Draft Approval Route Versions'),
  ('approvals.routes.activate', 'approvals', 'CRITICAL', 'Activate Approval Route Versions'),
  ('approvals.routes.supersede', 'approvals', 'CRITICAL', 'Supersede Approval Route Versions'),
  ('approvals.requests.read', 'approvals', 'MEDIUM', 'Read Agency Approval Requests'),
  ('approvals.requests.audit.read', 'approvals', 'HIGH', 'Read Approval Request History'),
  ('approvals.requests.create', 'approvals', 'HIGH', 'Create Approval Requests'),
  ('approvals.requests.submit', 'approvals', 'HIGH', 'Submit Approval Requests'),
  ('approvals.requests.approve', 'approvals', 'CRITICAL', 'Approve an Assigned Approval Step'),
  ('approvals.requests.return', 'approvals', 'HIGH', 'Return an Assigned Approval Step'),
  ('approvals.requests.reject', 'approvals', 'CRITICAL', 'Reject an Assigned Approval Step'),
  ('approvals.requests.cancel', 'approvals', 'HIGH', 'Cancel an Approval Request')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'approvals.routes.read', 'approvals.routes.create', 'approvals.routes.update',
  'approvals.routes.activate', 'approvals.routes.supersede', 'approvals.requests.read',
  'approvals.requests.audit.read', 'approvals.requests.create', 'approvals.requests.submit',
  'approvals.requests.cancel'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('approvals.requests.read', 'approvals.requests.audit.read')
WHERE r."code" = 'internal_auditor' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.approval_route_versions') IS NULL
    OR to_regclass('public.approval_requests') IS NULL
    OR to_regclass('public.approval_steps') IS NULL
    OR to_regclass('public.approval_decisions') IS NULL
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'approval_route_versions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'approval_requests'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'approval_steps'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'approval_decisions'::regclass), false) THEN
    RAISE EXCEPTION 'Approval capability migration verification failed';
  END IF;
END;
$$;
