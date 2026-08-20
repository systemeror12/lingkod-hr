-- Additive Organization Unit history fields and transition permissions.
-- Keep published versions immutable; corrections may only void and replace them.

ALTER TABLE "organization_unit_versions"
  ADD COLUMN "responsibility_center_code" TEXT;

CREATE INDEX "agency_memberships_agency_primary_organization_unit_idx"
  ON "agency_memberships" ("agency_id", "primary_organization_unit_id")
  WHERE "primary_organization_unit_id" IS NOT NULL;

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

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('organization.units.update', 'organization', 'HIGH', 'Prepare Organization Unit successors'),
  ('organization.units.inactivate', 'organization', 'HIGH', 'Inactivate Organization Units'),
  ('organization.units.abolish', 'organization', 'HIGH', 'Abolish Organization Units')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p
  ON p."code" IN (
    'organization.units.update',
    'organization.units.inactivate',
    'organization.units.abolish'
  )
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
