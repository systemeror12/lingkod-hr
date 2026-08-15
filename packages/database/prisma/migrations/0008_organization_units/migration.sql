-- Correction plan: this is an additive, forward-only migration. If deployment
-- fails before it is recorded, resolve the failed migration and rerun it after
-- correcting the SQL. If it has been applied to a database with data, use a
-- reviewed forward migration for corrections; do not drop these tables in
-- production. A local-only rollback may remove the grants and policies, then
-- drop the version table before the unit table and remove the seeded permission
-- rows after dependent role-permission rows have been removed.

CREATE TABLE "organization_units" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" CITEXT NOT NULL,
  "unit_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_units_unit_type_check"
    CHECK ("unit_type" IN ('DEPARTMENT', 'BUREAU', 'SERVICE', 'DIVISION', 'SECTION', 'OFFICE', 'OTHER')),
  CONSTRAINT "organization_units_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ABOLISHED')),
  CONSTRAINT "organization_units_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "organization_units_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "organization_units_agency_code_key" UNIQUE ("agency_id", "code")
);

CREATE TABLE "organization_unit_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "organization_unit_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "parent_unit_id" UUID,
  "head_position_id" UUID,
  "cost_center_code" TEXT,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_unit_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_unit_versions_version_check" CHECK ("version_no" > 0),
  CONSTRAINT "organization_unit_versions_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "organization_unit_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  CONSTRAINT "organization_unit_versions_agency_unit_fkey"
    FOREIGN KEY ("agency_id", "organization_unit_id")
    REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "organization_unit_versions_agency_parent_fkey"
    FOREIGN KEY ("agency_id", "parent_unit_id")
    REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "organization_unit_versions_unit_version_key"
    UNIQUE ("organization_unit_id", "version_no"),
  CONSTRAINT "organization_unit_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "organization_units"
  ADD CONSTRAINT "organization_units_current_version_fkey"
  FOREIGN KEY ("agency_id", "current_version_id")
  REFERENCES "organization_unit_versions"("agency_id", "id") ON DELETE RESTRICT;

ALTER TABLE "organization_unit_versions"
  ADD CONSTRAINT "organization_unit_versions_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "organization_unit_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("status" <> 'SUPERSEDED');

CREATE INDEX "organization_unit_versions_parent_idx"
  ON "organization_unit_versions" ("agency_id", "parent_unit_id", "effective_from");

CREATE POLICY "organization_units_select" ON "organization_units"
  FOR SELECT
  USING ("agency_id" = app_agency_id());

CREATE POLICY "organization_units_insert" ON "organization_units"
  FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "organization_units_update" ON "organization_units"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "organization_unit_versions_select" ON "organization_unit_versions"
  FOR SELECT
  USING ("agency_id" = app_agency_id());

CREATE POLICY "organization_unit_versions_insert" ON "organization_unit_versions"
  FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "organization_unit_versions_update" ON "organization_unit_versions"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('organization.units.read', 'organization', 'MEDIUM', 'Read Agency Organization Units'),
  ('organization.units.create', 'organization', 'HIGH', 'Create Draft Agency Organization Units')
ON CONFLICT ("code") DO NOTHING;

-- System-role templates are global records. Seed them through the migration
-- boundary rather than pretending that an Agency Context exists.
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('organization.units.read', 'organization.units.create')
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE "organization_units" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "organization_unit_versions" TO hris_app;

ALTER TABLE "organization_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "organization_unit_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_unit_versions" FORCE ROW LEVEL SECURITY;
