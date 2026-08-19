-- Correction plan: before the first activation, a forward correction may drop the trigger,
-- partial index, and domain column and restore the prior status/overlap constraints. After an
-- activation exists, preserve published versions and correct forward; never delete history.

ALTER TABLE "organization_unit_versions"
  ADD COLUMN "domain_status" TEXT NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "organization_unit_versions"
  DROP CONSTRAINT "organization_unit_versions_status_check",
  ADD CONSTRAINT "organization_unit_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'VOIDED')),
  ADD CONSTRAINT "organization_unit_versions_domain_status_check"
    CHECK ("domain_status" IN ('ACTIVE', 'INACTIVE', 'ABOLISHED')),
  ADD CONSTRAINT "organization_unit_versions_parent_not_self_check"
    CHECK ("parent_unit_id" IS NULL OR "parent_unit_id" <> "organization_unit_id");

ALTER TABLE "organization_unit_versions"
  DROP CONSTRAINT "organization_unit_versions_no_overlap";

ALTER TABLE "organization_unit_versions"
  ADD CONSTRAINT "organization_unit_versions_active_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "organization_unit_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE UNIQUE INDEX "organization_unit_versions_one_draft"
  ON "organization_unit_versions" ("organization_unit_id")
  WHERE "status" = 'DRAFT';

CREATE OR REPLACE FUNCTION guard_organization_unit_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Organization Unit versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'Organization Unit versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUPERSEDED' AND (
    NEW."status" <> 'VOIDED'
    OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."organization_unit_id" IS DISTINCT FROM OLD."organization_unit_id"
    OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."parent_unit_id" IS DISTINCT FROM OLD."parent_unit_id"
    OR NEW."head_position_id" IS DISTINCT FROM OLD."head_position_id"
    OR NEW."cost_center_code" IS DISTINCT FROM OLD."cost_center_code"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
    OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'superseded Organization Unit versions are immutable except for correction voiding'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' AND (
    NEW."status" NOT IN ('SUPERSEDED', 'VOIDED')
    OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."organization_unit_id" IS DISTINCT FROM OLD."organization_unit_id"
    OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."parent_unit_id" IS DISTINCT FROM OLD."parent_unit_id"
    OR NEW."head_position_id" IS DISTINCT FROM OLD."head_position_id"
    OR NEW."cost_center_code" IS DISTINCT FROM OLD."cost_center_code"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'activated Organization Unit versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'a Draft Organization Unit can only be edited or activated'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "organization_unit_versions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "organization_unit_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_organization_unit_version_mutation();

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES ('organization.units.activate', 'organization', 'HIGH', 'Activate Organization Units')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'organization.units.activate'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
