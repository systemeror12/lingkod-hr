-- Agency Profile administration extends the original Phase 1 profile table
-- without rewriting its stable Agency identity or historical versions.

ALTER TABLE "agency_profile_versions"
  ADD COLUMN "official_name" TEXT,
  ADD COLUMN "acronym" TEXT,
  ADD COLUMN "agency_type" TEXT NOT NULL DEFAULT 'NGA',
  ADD COLUMN "parent_organization" TEXT,
  ADD COLUMN "reporting_identifiers" TEXT,
  ADD COLUMN "default_timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
  ADD COLUMN "default_currency" CHAR(3) NOT NULL DEFAULT 'PHP',
  ADD COLUMN "domain_status" TEXT NOT NULL DEFAULT 'ACTIVE';

UPDATE "agency_profile_versions" p
SET
  "official_name" = a."name",
  "acronym" = a."acronym",
  "agency_type" = a."agency_type",
  "default_timezone" = a."default_timezone",
  "default_currency" = a."default_currency",
  "domain_status" = a."status"
FROM "agencies" a
WHERE a."id" = p."agency_id";

INSERT INTO "agency_profile_versions" (
  "agency_id",
  "version_no",
  "official_name",
  "acronym",
  "agency_type",
  "appointing_authority_title",
  "deployment_profile",
  "effective_from",
  "configuration",
  "status",
  "domain_status"
)
SELECT
  a."id",
  1,
  a."name",
  a."acronym",
  a."agency_type",
  NULL,
  'SHARED_SAAS',
  a."created_at"::date,
  '{}'::jsonb,
  'ACTIVE',
  a."status"
FROM "agencies" a
WHERE NOT EXISTS (
  SELECT 1
  FROM "agency_profile_versions" p
  WHERE p."agency_id" = a."id"
);

ALTER TABLE "agency_profile_versions"
  ALTER COLUMN "official_name" SET NOT NULL;

ALTER TABLE "agency_profile_versions"
  DROP CONSTRAINT "agency_profile_versions_status_check",
  ADD CONSTRAINT "agency_profile_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'VOIDED')),
  ADD CONSTRAINT "agency_profile_versions_agency_type_check"
    CHECK ("agency_type" IN ('NGA', 'LGU', 'SUC', 'GOCC_ORIGINAL_CHARTER', 'OTHER')),
  ADD CONSTRAINT "agency_profile_versions_domain_status_check"
    CHECK ("domain_status" IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  ADD CONSTRAINT "agency_profile_versions_currency_check"
    CHECK ("default_currency" ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX "agency_profile_versions_one_draft"
  ON "agency_profile_versions" ("agency_id")
  WHERE "status" = 'DRAFT';

CREATE INDEX "agency_profile_versions_agency_effective_from_idx"
  ON "agency_profile_versions" ("agency_id", "effective_from");

CREATE OR REPLACE FUNCTION guard_agency_profile_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agency profile versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IN ('SUPERSEDED', 'VOIDED') THEN
    RAISE EXCEPTION 'agency profile versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' AND (
    NEW."status" NOT IN ('SUPERSEDED', 'VOIDED')
    OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
    OR NEW."official_name" IS DISTINCT FROM OLD."official_name"
    OR NEW."acronym" IS DISTINCT FROM OLD."acronym"
    OR NEW."agency_type" IS DISTINCT FROM OLD."agency_type"
    OR NEW."parent_organization" IS DISTINCT FROM OLD."parent_organization"
    OR NEW."reporting_identifiers" IS DISTINCT FROM OLD."reporting_identifiers"
    OR NEW."appointing_authority_title" IS DISTINCT FROM OLD."appointing_authority_title"
    OR NEW."default_timezone" IS DISTINCT FROM OLD."default_timezone"
    OR NEW."default_currency" IS DISTINCT FROM OLD."default_currency"
    OR NEW."deployment_profile" IS DISTINCT FROM OLD."deployment_profile"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
    OR NEW."configuration" IS DISTINCT FROM OLD."configuration"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'activated Agency Profile versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'a Draft Agency Profile can only be edited or activated'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "agency_profile_versions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "agency_profile_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_agency_profile_version_mutation();

UPDATE "agencies" a
SET "current_profile_version_id" = p."id"
FROM "agency_profile_versions" p
WHERE p."agency_id" = a."id"
  AND p."status" = 'ACTIVE'
  AND p."effective_from" <= CURRENT_DATE
  AND (p."effective_to" IS NULL OR p."effective_to" >= CURRENT_DATE)
  AND a."current_profile_version_id" IS NULL;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('organization.agency.read', 'organization', 'MEDIUM', 'Read effective-dated Agency Profile versions'),
  ('organization.agency.update', 'organization', 'HIGH', 'Prepare and activate Agency Profile versions')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'organization.agency.read'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'organization.agency.update'
WHERE r."code" = 'agency_administrator'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON "agency_profile_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON "agency_profile_versions" TO hris_operator;
