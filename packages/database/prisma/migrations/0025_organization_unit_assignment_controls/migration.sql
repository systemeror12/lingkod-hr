-- Keep Organization Unit assignments within the Agency and reject assignments
-- to a unit that is not ACTIVE as of the assignment transaction date.

ALTER TABLE "agency_memberships"
  ADD CONSTRAINT "agency_memberships_primary_organization_unit_fkey"
  FOREIGN KEY ("agency_id", "primary_organization_unit_id")
  REFERENCES "organization_units" ("agency_id", "id")
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION guard_agency_membership_primary_organization_unit()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  assigned_status TEXT;
BEGIN
  IF NEW."primary_organization_unit_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT v."domain_status"
    INTO assigned_status
  FROM "organization_unit_versions" v
  WHERE v."agency_id" = NEW."agency_id"
    AND v."organization_unit_id" = NEW."primary_organization_unit_id"
    AND v."status" IN ('ACTIVE', 'SUPERSEDED')
    AND v."effective_from" <= CURRENT_DATE
    AND (v."effective_to" IS NULL OR v."effective_to" >= CURRENT_DATE)
  ORDER BY v."effective_from" DESC, v."version_no" DESC
  LIMIT 1;

  IF assigned_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'An Agency Membership can only be assigned to an active Organization Unit'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "agency_membership_primary_organization_unit_trigger"
  ON "agency_memberships";
CREATE TRIGGER "agency_membership_primary_organization_unit_trigger"
  BEFORE INSERT OR UPDATE OF "agency_id", "primary_organization_unit_id"
  ON "agency_memberships"
  FOR EACH ROW
  EXECUTE FUNCTION guard_agency_membership_primary_organization_unit();

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
    OR NEW."responsibility_center_code" IS DISTINCT FROM OLD."responsibility_center_code"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
    OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'superseded Organization Unit versions are immutable except for correction voiding'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'VOIDED'
    AND current_setting('app.organization_unit_correction', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Activated Organization Unit versions require the correction transaction'
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
    OR NEW."responsibility_center_code" IS DISTINCT FROM OLD."responsibility_center_code"
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

ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'organization.units.read'
WHERE r."code" = 'internal_auditor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
