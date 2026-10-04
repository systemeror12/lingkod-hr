-- Phase 7 Leave Type and Leave Policy Version maintenance. A Leave Type is the
-- stable Agency-owned identity for one entry of the government leave catalogue.
-- A Leave Policy Version freezes the entitlement basis, calendar basis, charged
-- Leave Type, fixed evaluator kind, validated national rule parameters,
-- personnel applicability, evidence requirements, and the exact national-rule
-- and Agency-configuration Document Versions that authorize it. Only one DRAFT
-- policy version may exist per Leave Type, published versions cannot overlap,
-- and every published or superseded version stays immutable.

CREATE TABLE "leave_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" CITEXT NOT NULL,
  "name" CITEXT NOT NULL,
  "status" TEXT NOT NULL,
  "current_policy_version_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_types_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "leave_types_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_types_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "leave_types_agency_code_key" UNIQUE ("agency_id", "code"),
  CONSTRAINT "leave_types_agency_name_key" UNIQUE ("agency_id", "name"),
  CONSTRAINT "leave_types_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_types_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "leave_policy_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_type_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "entitlement_basis" TEXT NOT NULL,
  "calendar_basis" TEXT NOT NULL,
  "charged_leave_type_id" UUID,
  "evaluator_kind" CITEXT NOT NULL,
  "rule_parameters" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "applicability_rules" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "document_requirements" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "approval_route_code" CITEXT,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "leave_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_policy_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  CONSTRAINT "leave_policy_versions_entitlement_basis_check"
    CHECK ("entitlement_basis" IN (
      'ACCRUED_ACCOUNT',
      'PERIODIC_ALLOWANCE',
      'QUALIFYING_EVENT',
      'NON_CREDIT_AUTHORIZATION'
    )),
  CONSTRAINT "leave_policy_versions_calendar_basis_check"
    CHECK ("calendar_basis" IN ('WORKING_DAY', 'CALENDAR_DAY', 'SOURCE_DEFINED')),
  CONSTRAINT "leave_policy_versions_version_check"
    CHECK ("version_no" > 0),
  CONSTRAINT "leave_policy_versions_rule_parameters_check"
    CHECK (jsonb_typeof("rule_parameters") = 'object'),
  CONSTRAINT "leave_policy_versions_applicability_check"
    CHECK (jsonb_typeof("applicability_rules") = 'object'),
  CONSTRAINT "leave_policy_versions_document_requirements_check"
    CHECK (jsonb_typeof("document_requirements") = 'object'),
  CONSTRAINT "leave_policy_versions_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "leave_policy_versions_charged_type_check"
    CHECK ("charged_leave_type_id" IS NULL OR "charged_leave_type_id" <> "leave_type_id"),
  CONSTRAINT "leave_policy_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_versions_leave_type_fkey"
    FOREIGN KEY ("agency_id", "leave_type_id")
    REFERENCES "leave_types"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_versions_charged_type_fkey"
    FOREIGN KEY ("agency_id", "charged_leave_type_id")
    REFERENCES "leave_types"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "leave_policy_versions_leave_type_version_key"
    UNIQUE ("leave_type_id", "version_no"),
  CONSTRAINT "leave_policy_versions_leave_type_id_key"
    UNIQUE ("agency_id", "leave_type_id", "id"),
  CONSTRAINT "leave_policy_versions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_versions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "leave_policy_authorities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_policy_version_id" UUID NOT NULL,
  "authority_class" TEXT NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "citation" TEXT NOT NULL,
  "validation_reason" TEXT,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_policy_authorities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_policy_authorities_class_check"
    CHECK ("authority_class" IN ('NATIONAL_RULE', 'AGENCY_CONFIGURATION')),
  CONSTRAINT "leave_policy_authorities_citation_check"
    CHECK (length(btrim("citation")) > 0),
  CONSTRAINT "leave_policy_authorities_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_authorities_version_fkey"
    FOREIGN KEY ("agency_id", "leave_policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_authorities_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_authorities_document_version_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_policy_authorities_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "leave_policy_authorities_version_document_key"
    UNIQUE ("leave_policy_version_id", "document_version_id"),
  CONSTRAINT "leave_policy_authorities_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

ALTER TABLE "leave_types"
  ADD CONSTRAINT "leave_types_current_policy_version_fkey"
  FOREIGN KEY ("agency_id", "current_policy_version_id")
  REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "leave_policy_versions_one_draft"
  ON "leave_policy_versions" ("leave_type_id")
  WHERE "status" = 'DRAFT';

ALTER TABLE "leave_policy_versions"
  ADD CONSTRAINT "leave_policy_versions_published_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "leave_type_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'SUPERSEDED'));

CREATE INDEX "leave_types_status_idx"
  ON "leave_types" ("agency_id", "status");
CREATE INDEX "leave_policy_versions_effective_idx"
  ON "leave_policy_versions" ("agency_id", "leave_type_id", "effective_from");
CREATE INDEX "leave_policy_authorities_version_idx"
  ON "leave_policy_authorities" ("agency_id", "leave_policy_version_id");

CREATE OR REPLACE FUNCTION set_leave_policy_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_type_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW."status" <> 'ACTIVE' OR NEW."current_policy_version_id" IS NOT NULL)
      AND current_setting('app.leave_policy_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Leave Type projections require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Types are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."code" IS DISTINCT FROM NEW."code"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Leave Type identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF (OLD."status" IS DISTINCT FROM NEW."status"
      OR OLD."current_policy_version_id" IS DISTINCT FROM NEW."current_policy_version_id")
    AND current_setting('app.leave_policy_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Leave Type projections require the application service'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_policy_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.leave_policy_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Leave Policy Version transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Policy Versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."leave_type_id" IS DISTINCT FROM OLD."leave_type_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."entitlement_basis" IS DISTINCT FROM OLD."entitlement_basis"
      OR NEW."calendar_basis" IS DISTINCT FROM OLD."calendar_basis"
      OR NEW."evaluator_kind" IS DISTINCT FROM OLD."evaluator_kind"
      OR NEW."rule_parameters" IS DISTINCT FROM OLD."rule_parameters"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Leave Policy Version national rules are immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('app.leave_policy_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Leave Policy Version transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."leave_type_id" IS DISTINCT FROM OLD."leave_type_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."entitlement_basis" IS DISTINCT FROM OLD."entitlement_basis"
      OR NEW."calendar_basis" IS DISTINCT FROM OLD."calendar_basis"
      OR NEW."charged_leave_type_id" IS DISTINCT FROM OLD."charged_leave_type_id"
      OR NEW."evaluator_kind" IS DISTINCT FROM OLD."evaluator_kind"
      OR NEW."rule_parameters" IS DISTINCT FROM OLD."rule_parameters"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Leave Policy Version activation cannot rewrite national rules'
        USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "leave_policy_authorities" a
      WHERE a."agency_id" = NEW."agency_id"
        AND a."leave_policy_version_id" = OLD."id"
        AND a."authority_class" = 'NATIONAL_RULE'
    ) THEN
      RAISE EXCEPTION 'Active Leave Policy Versions require a national rule authority'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."effective_to" IS NULL THEN
      RAISE EXCEPTION 'Superseded Leave Policy Versions require an end date'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."leave_type_id" IS DISTINCT FROM OLD."leave_type_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."entitlement_basis" IS DISTINCT FROM OLD."entitlement_basis"
      OR NEW."calendar_basis" IS DISTINCT FROM OLD."calendar_basis"
      OR NEW."charged_leave_type_id" IS DISTINCT FROM OLD."charged_leave_type_id"
      OR NEW."evaluator_kind" IS DISTINCT FROM OLD."evaluator_kind"
      OR NEW."rule_parameters" IS DISTINCT FROM OLD."rule_parameters"
      OR NEW."applicability_rules" IS DISTINCT FROM OLD."applicability_rules"
      OR NEW."document_requirements" IS DISTINCT FROM OLD."document_requirements"
      OR NEW."approval_route_code" IS DISTINCT FROM OLD."approval_route_code"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Active Leave Policy Versions are immutable except for supersession'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Leave Policy Version state cannot be changed through this path'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_policy_authority_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
BEGIN
  SELECT v."status" INTO version_status
  FROM "leave_policy_versions" v
  WHERE v."agency_id" = COALESCE(NEW."agency_id", OLD."agency_id")
    AND v."id" = COALESCE(NEW."leave_policy_version_id", OLD."leave_policy_version_id");

  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Leave Policy Version authority links are frozen once activated'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."leave_policy_version_id" IS DISTINCT FROM OLD."leave_policy_version_id"
      OR NEW."authority_class" IS DISTINCT FROM OLD."authority_class"
      OR NEW."document_id" IS DISTINCT FROM OLD."document_id"
      OR NEW."document_version_id" IS DISTINCT FROM OLD."document_version_id"
      OR NEW."citation" IS DISTINCT FROM OLD."citation"
      OR NEW."validation_reason" IS DISTINCT FROM OLD."validation_reason"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Leave Policy Version authority links are appended, not edited'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "leave_types_updated_at_trigger"
  BEFORE UPDATE ON "leave_types"
  FOR EACH ROW EXECUTE FUNCTION set_leave_policy_updated_at();
CREATE TRIGGER "leave_types_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_types"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_type_mutation();
CREATE TRIGGER "leave_policy_versions_updated_at_trigger"
  BEFORE UPDATE ON "leave_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION set_leave_policy_updated_at();
CREATE TRIGGER "leave_policy_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_policy_version_mutation();
CREATE TRIGGER "leave_policy_authorities_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_policy_authorities"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_policy_authority_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "leave_types" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "leave_policy_versions" TO hris_app;
GRANT SELECT, INSERT, DELETE ON TABLE "leave_policy_authorities" TO hris_app;

ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_policy_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policy_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_policy_authorities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policy_authorities" FORCE ROW LEVEL SECURITY;

CREATE POLICY "leave_types_select" ON "leave_types"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_types_insert" ON "leave_types"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_types_update" ON "leave_types"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_policy_versions_select" ON "leave_policy_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_policy_versions_insert" ON "leave_policy_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_policy_versions_update" ON "leave_policy_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_policy_authorities_select" ON "leave_policy_authorities"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_policy_authorities_insert" ON "leave_policy_authorities"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_policy_authorities_delete" ON "leave_policy_authorities"
  FOR DELETE USING ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.types.read', 'leave', 'MEDIUM', 'Read Agency Leave Types and Leave Policy Versions'),
  ('leave.types.manage', 'leave', 'HIGH', 'Maintain Agency Leave Types and Leave Policy Versions')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.types.manage'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.types.read'
WHERE r."code" IN (
  'agency_administrator',
  'hrmo_administrator',
  'personnel_records_officer',
  'budget_officer',
  'payroll_preparer',
  'appointing_authority',
  'internal_auditor'
)
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'leave_policy_versions_one_draft'
  ) THEN
    RAISE EXCEPTION 'Leave Policy migration verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_policy_versions_published_no_overlap'
  ) THEN
    RAISE EXCEPTION 'Leave Policy overlap guard verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.types.read') THEN
    RAISE EXCEPTION 'Leave Type read permission verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.types.manage') THEN
    RAISE EXCEPTION 'Leave Type manage permission verification failed';
  END IF;
END;
$$;
