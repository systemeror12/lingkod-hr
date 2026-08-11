ALTER TABLE "agencies"
  ADD COLUMN "acronym" TEXT,
  ADD COLUMN "agency_type" TEXT NOT NULL DEFAULT 'NGA',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "default_timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
  ADD COLUMN "default_currency" CHAR(3) NOT NULL DEFAULT 'PHP',
  ADD COLUMN "current_profile_version_id" UUID;

ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_agency_type_check"
    CHECK ("agency_type" IN ('NGA', 'LGU', 'SUC', 'GOCC_ORIGINAL_CHARTER', 'OTHER')),
  ADD CONSTRAINT "agencies_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  ADD CONSTRAINT "agencies_id_code_key" UNIQUE ("id", "code");

CREATE OR REPLACE FUNCTION app_agency_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.agency_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_platform_security()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT current_setting('app.platform_security', true) = 'true'
$$;

CREATE OR REPLACE FUNCTION set_updated_at_and_row_version()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  NEW.row_version = OLD.row_version + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE "agency_profile_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "appointing_authority_title" TEXT,
  "deployment_profile" TEXT NOT NULL
    CHECK ("deployment_profile" IN ('SHARED_SAAS', 'DEDICATED_CLOUD', 'AGENCY_HOSTED')),
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "configuration" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agency_profile_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_profile_versions_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "agency_profile_versions_agency_version_key"
    UNIQUE ("agency_id", "version_no"),
  CONSTRAINT "agency_profile_versions_agency_id_key"
    UNIQUE ("agency_id", "id"),
  CONSTRAINT "agency_profile_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT
);

ALTER TABLE "agency_profile_versions"
  ADD CONSTRAINT "agency_profile_versions_active_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    DATERANGE("effective_from", COALESCE("effective_to", 'infinity'::DATE), '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_current_profile_fkey"
    FOREIGN KEY ("id", "current_profile_version_id")
    REFERENCES "agency_profile_versions"("agency_id", "id")
    ON DELETE RESTRICT;

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "identity_provider" TEXT NOT NULL,
  "external_subject" TEXT NOT NULL,
  "email_normalized" CITEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "global_status" TEXT NOT NULL
    CHECK ("global_status" IN ('ACTIVE', 'LOCKED', 'DEACTIVATED')),
  "email_verified_at" TIMESTAMPTZ(6),
  "last_login_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_identity_key" UNIQUE ("identity_provider", "external_subject"),
  CONSTRAINT "users_email_key" UNIQUE ("email_normalized")
);

CREATE TABLE "external_identity_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('ACTIVE', 'SUPERSEDED')),
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMPTZ(6),
  "reason" TEXT,
  CONSTRAINT "external_identity_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_identity_links_identity_key" UNIQUE ("issuer", "subject"),
  CONSTRAINT "external_identity_links_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "agency_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "employee_id" UUID,
  "primary_organization_unit_id" UUID,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('INVITED', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'DEACTIVATED')),
  "activated_at" TIMESTAMPTZ(6),
  "deactivated_at" TIMESTAMPTZ(6),
  "deactivation_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agency_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_memberships_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "agency_memberships_agency_id_user_id_key" UNIQUE ("agency_id", "id", "user_id"),
  CONSTRAINT "agency_memberships_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "agency_memberships_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "agency_memberships_active_user_uq"
  ON "agency_memberships" ("agency_id", "user_id")
  WHERE "status" IN ('INVITED', 'ACTIVE', 'LOCKED', 'SUSPENDED');

CREATE TABLE "invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "email_normalized" CITEXT NOT NULL,
  "invited_by_membership_id" UUID NOT NULL,
  "token_hash" BYTEA NOT NULL,
  "requested_role_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL CHECK ("status" IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED')),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invitations_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "invitations_period_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "invitations_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "invitations_inviter_fkey"
    FOREIGN KEY ("agency_id", "invited_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "invitations_one_pending_email_uq"
  ON "invitations" ("agency_id", "email_normalized")
  WHERE "status" = 'PENDING';

CREATE TABLE "roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_system_template" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" TEXT NOT NULL CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roles_template_scope_check"
    CHECK (("agency_id" IS NULL AND "is_system_template") OR ("agency_id" IS NOT NULL AND NOT "is_system_template")),
  CONSTRAINT "roles_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "roles_agency_code_uq"
  ON "roles" ("agency_id", "code")
  WHERE "agency_id" IS NOT NULL;

CREATE UNIQUE INDEX "roles_global_code_uq"
  ON "roles" ("code")
  WHERE "agency_id" IS NULL;

CREATE TABLE "permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" CITEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "risk_level" TEXT NOT NULL CHECK ("risk_level" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  "description" TEXT NOT NULL,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "permissions_code_key" UNIQUE ("code")
);

REVOKE INSERT, UPDATE, DELETE ON "permissions" FROM hris_app;

CREATE TABLE "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "scope_policy" TEXT NOT NULL
    CHECK ("scope_policy" IN ('OWN', 'DIRECT_REPORTS', 'ASSIGNED_OFFICE', 'AGENCY', 'RESTRICTED')),
  "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "granted_by_membership_id" UUID,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id", "scope_policy"),
  CONSTRAINT "role_permissions_role_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
  CONSTRAINT "role_permissions_permission_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT,
  CONSTRAINT "role_permissions_grantor_fkey"
    FOREIGN KEY ("granted_by_membership_id") REFERENCES "agency_memberships"("id") ON DELETE SET NULL
);

CREATE OR REPLACE FUNCTION validate_role_permission_grantor()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_agency UUID;
  grantor_agency UUID;
BEGIN
  SELECT "agency_id" INTO role_agency FROM "roles" WHERE "id" = NEW."role_id";
  IF NEW."granted_by_membership_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "agency_id" INTO grantor_agency
  FROM "agency_memberships"
  WHERE "id" = NEW."granted_by_membership_id";
  IF role_agency IS NULL OR grantor_agency IS NULL OR role_agency <> grantor_agency THEN
    RAISE EXCEPTION 'role permission grantor must belong to the role Agency'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "role_permissions_grantor_agency_trigger"
  BEFORE INSERT OR UPDATE ON "role_permissions"
  FOR EACH ROW EXECUTE FUNCTION validate_role_permission_grantor();

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "role_permissions_select" ON "role_permissions"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND ("roles"."agency_id" IS NULL OR "roles"."agency_id" = app_agency_id())
    )
  );

CREATE POLICY "role_permissions_insert" ON "role_permissions"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  );

CREATE POLICY "role_permissions_update" ON "role_permissions"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  );

CREATE POLICY "role_permissions_delete" ON "role_permissions"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  );

CREATE TABLE "membership_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_to" TIMESTAMPTZ(6),
  "assigned_by_membership_id" UUID NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "membership_roles_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  CONSTRAINT "membership_roles_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "membership_roles_membership_fkey"
    FOREIGN KEY ("agency_id", "membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "membership_roles_assigner_fkey"
    FOREIGN KEY ("agency_id", "assigned_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "membership_roles_role_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT
);

CREATE INDEX "membership_roles_active_idx"
  ON "membership_roles" ("agency_id", "membership_id", "role_id")
  WHERE "effective_to" IS NULL;

ALTER TABLE "membership_roles"
  ADD CONSTRAINT "membership_roles_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "membership_id" WITH =,
    "role_id" WITH =,
    TSTZRANGE("effective_from", COALESCE("effective_to", 'infinity'::TIMESTAMPTZ), '[)') WITH &&
  );

CREATE OR REPLACE FUNCTION validate_membership_role_agency()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE role_agency UUID;
BEGIN
  SELECT "agency_id" INTO role_agency FROM "roles" WHERE "id" = NEW."role_id";
  IF role_agency IS NOT NULL AND role_agency <> NEW."agency_id" THEN
    RAISE EXCEPTION 'role belongs to another Agency' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "membership_roles_agency_trigger"
  BEFORE INSERT OR UPDATE ON "membership_roles"
  FOR EACH ROW EXECUTE FUNCTION validate_membership_role_agency();

CREATE TABLE "delegated_authorities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "delegator_membership_id" UUID NOT NULL,
  "delegate_membership_id" UUID NOT NULL,
  "permission_code" CITEXT NOT NULL,
  "organization_unit_id" UUID,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_to" TIMESTAMPTZ(6) NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  "authority_document_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delegated_authorities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delegated_authorities_period_check" CHECK ("effective_to" > "effective_from"),
  CONSTRAINT "delegated_authorities_distinct_members_check"
    CHECK ("delegator_membership_id" <> "delegate_membership_id"),
  CONSTRAINT "delegated_authorities_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "delegated_authorities_delegator_fkey"
    FOREIGN KEY ("agency_id", "delegator_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id"),
  CONSTRAINT "delegated_authorities_delegate_fkey"
    FOREIGN KEY ("agency_id", "delegate_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id"),
  CONSTRAINT "delegated_authorities_permission_fkey"
    FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT
);

CREATE INDEX "delegated_authorities_delegate_active_idx"
  ON "delegated_authorities" ("agency_id", "delegate_membership_id", "effective_from", "effective_to")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "user_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "agency_id" UUID NOT NULL,
  "agency_membership_id" UUID NOT NULL,
  "session_token_hash" BYTEA NOT NULL,
  "provider_sid" TEXT,
  "auth_time" TIMESTAMPTZ(6),
  "authentication_methods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "revocation_reason" TEXT,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_sessions_token_hash_key" UNIQUE ("session_token_hash"),
  CONSTRAINT "user_sessions_period_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "user_sessions_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "user_sessions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "user_sessions_membership_fkey"
    FOREIGN KEY ("agency_id", "agency_membership_id", "user_id")
    REFERENCES "agency_memberships"("agency_id", "id", "user_id") ON DELETE RESTRICT
);

CREATE INDEX "user_sessions_user_active_idx"
  ON "user_sessions" ("user_id", "revoked_at");

CREATE TABLE "security_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_key" TEXT,
  "agency_id" UUID,
  "user_id" UUID,
  "membership_id" UUID,
  "event_type" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "request_id" TEXT,
  "ip_address" INET,
  "user_agent" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_events_event_key_key" UNIQUE ("event_key"),
  CONSTRAINT "security_events_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "security_events_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "security_events_membership_fkey"
    FOREIGN KEY ("agency_id", "membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE SET NULL
);

CREATE INDEX "security_events_agency_time_idx"
  ON "security_events" ("agency_id", "occurred_at" DESC);

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "actor_membership_id" UUID,
  "actor_type" TEXT NOT NULL CHECK ("actor_type" IN ('USER', 'SYSTEM', 'INTEGRATION')),
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "previous_status" TEXT,
  "new_status" TEXT,
  "reason" TEXT,
  "request_id" TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_events_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "audit_events_user_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "audit_events_membership_fkey"
    FOREIGN KEY ("agency_id", "actor_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE SET NULL
);

CREATE INDEX "audit_events_agency_time_idx"
  ON "audit_events" ("agency_id", "occurred_at" DESC);

CREATE TRIGGER "agencies_updated_at_trigger"
  BEFORE UPDATE ON "agencies"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();

CREATE TRIGGER "security_events_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "security_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER "audit_events_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE POLICY "agencies_isolation" ON "agencies"
  USING ("id" = app_agency_id())
  WITH CHECK ("id" = app_agency_id());

CREATE POLICY "agency_profiles_isolation" ON "agency_profile_versions"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "agency_memberships_isolation" ON "agency_memberships"
  USING ("agency_id" = app_agency_id() OR "user_id" = app_user_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "invitations_isolation" ON "invitations"
  USING (
    "agency_id" = app_agency_id()
    OR encode("token_hash", 'hex') = current_setting('app.invitation_token_hash', true)
  )
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "roles_select" ON "roles"
  FOR SELECT
  USING ("agency_id" IS NULL OR "agency_id" = app_agency_id());

CREATE POLICY "roles_insert" ON "roles"
  FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "roles_update" ON "roles"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "roles_delete" ON "roles"
  FOR DELETE
  USING ("agency_id" = app_agency_id());

CREATE POLICY "membership_roles_isolation" ON "membership_roles"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "delegated_authorities_isolation" ON "delegated_authorities"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "user_sessions_isolation" ON "user_sessions"
  USING (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR "provider_sid" = current_setting('app.provider_sid', true)
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  )
  WITH CHECK (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR "provider_sid" = current_setting('app.provider_sid', true)
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  );

CREATE POLICY "security_events_isolation" ON "security_events"
  USING (
    "agency_id" = app_agency_id()
    OR ("agency_id" IS NULL AND app_platform_security())
  )
  WITH CHECK (
    "agency_id" = app_agency_id()
    OR ("agency_id" IS NULL AND app_platform_security())
  );

CREATE POLICY "audit_events_isolation" ON "audit_events"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "agencies" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_profile_versions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_memberships" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "delegated_authorities" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "security_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('security.users.read', 'security', 'MEDIUM', 'View Agency user accounts and memberships'),
  ('security.users.invite', 'security', 'HIGH', 'Invite a user to an Agency'),
  ('security.users.update_roles', 'security', 'CRITICAL', 'Assign and revoke Agency roles'),
  ('security.users.suspend', 'security', 'HIGH', 'Suspend an Agency Membership'),
  ('security.users.deactivate', 'security', 'HIGH', 'Deactivate an Agency Membership'),
  ('security.users.reactivate', 'security', 'HIGH', 'Reactivate an Agency Membership'),
  ('security.users.lock', 'security', 'CRITICAL', 'Lock a global User identity'),
  ('security.users.unlock', 'security', 'CRITICAL', 'Unlock a global User identity'),
  ('security.sessions.revoke', 'security', 'HIGH', 'Revoke application sessions'),
  ('security.events.read', 'security', 'HIGH', 'Read Security Events'),
  ('security.mfa.manage_policy', 'security', 'CRITICAL', 'Manage Agency MFA policy'),
  ('security.permissions.manage', 'security', 'CRITICAL', 'Manage Agency permissions'),
  ('audit.events.read', 'audit', 'MEDIUM', 'Read Agency audit events'),
  ('audit.events.create', 'audit', 'HIGH', 'Create an audit event')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES
  ('agency_administrator', 'Agency Administrator', TRUE, 'ACTIVE'),
  ('security_administrator', 'Security Administrator', TRUE, 'ACTIVE'),
  ('internal_auditor', 'Internal Auditor / COA Auditor', TRUE, 'ACTIVE'),
  ('hrmo_administrator', 'HRMO Administrator', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'security.users.read',
  'security.users.invite',
  'security.users.update_roles',
  'security.users.suspend',
  'security.users.deactivate',
  'security.users.reactivate',
  'security.sessions.revoke',
  'security.events.read',
  'security.mfa.manage_policy',
  'security.permissions.manage',
  'audit.events.read',
  'audit.events.create'
)
WHERE r."code" = 'agency_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'security.users.read',
  'security.users.lock',
  'security.users.unlock',
  'security.sessions.revoke',
  'security.events.read',
  'security.mfa.manage_policy',
  'security.permissions.manage',
  'audit.events.read',
  'audit.events.create'
)
WHERE r."code" = 'security_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('security.events.read', 'audit.events.read')
WHERE r."code" = 'internal_auditor' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'security.users.read',
  'security.users.invite',
  'security.users.suspend',
  'security.users.deactivate',
  'security.users.reactivate',
  'audit.events.read'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "agencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agencies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agency_profile_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_profile_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agency_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "delegated_authorities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delegated_authorities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
