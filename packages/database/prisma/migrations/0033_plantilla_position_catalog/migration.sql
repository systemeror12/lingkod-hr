-- Plantilla Positions keep a stable, never-reused Item Number while their
-- effective definitions move through immutable version records.

CREATE TABLE "plantilla_positions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "item_number" CITEXT NOT NULL,
  "status" TEXT NOT NULL,
  "current_version_id" UUID,
  "created_from_authority_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "plantilla_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plantilla_positions_status_check"
    CHECK ("status" IN ('PROPOSED', 'AUTHORIZED', 'VACANT', 'RESERVED', 'OCCUPIED', 'FROZEN', 'ABOLISHED')),
  CONSTRAINT "plantilla_positions_item_number_check"
    CHECK (btrim("item_number"::TEXT) <> ''),
  CONSTRAINT "plantilla_positions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_positions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "plantilla_positions_agency_item_number_key" UNIQUE ("agency_id", "item_number"),
  CONSTRAINT "plantilla_positions_created_from_authority_fkey"
    FOREIGN KEY ("agency_id", "created_from_authority_id")
    REFERENCES "staffing_authorities"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_positions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_positions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "plantilla_position_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "position_id" UUID NOT NULL,
  "organization_unit_id" UUID NOT NULL,
  "qualification_standard_version_id" UUID NOT NULL,
  "staffing_authority_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "position_title" TEXT NOT NULL,
  "parenthetical_title" TEXT,
  "salary_grade" INTEGER NOT NULL,
  "funding_source" TEXT NOT NULL,
  "employment_category" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "domain_status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "plantilla_position_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plantilla_position_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'VOIDED')),
  CONSTRAINT "plantilla_position_versions_domain_status_check"
    CHECK ("domain_status" IN ('PROPOSED', 'AUTHORIZED', 'VACANT', 'RESERVED', 'OCCUPIED', 'FROZEN', 'ABOLISHED')),
  CONSTRAINT "plantilla_position_versions_version_check"
    CHECK ("version_no" > 0),
  CONSTRAINT "plantilla_position_versions_salary_grade_check"
    CHECK ("salary_grade" BETWEEN 1 AND 33),
  CONSTRAINT "plantilla_position_versions_title_check"
    CHECK (btrim("position_title") <> ''),
  CONSTRAINT "plantilla_position_versions_funding_check"
    CHECK (btrim("funding_source") <> ''),
  CONSTRAINT "plantilla_position_versions_employment_check"
    CHECK ("employment_category" IN ('PLANTILLA', 'CASUAL', 'CONTRACTUAL', 'OTHER')),
  CONSTRAINT "plantilla_position_versions_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "plantilla_position_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_position_versions_position_fkey"
    FOREIGN KEY ("agency_id", "position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_position_versions_organization_unit_fkey"
    FOREIGN KEY ("agency_id", "organization_unit_id")
    REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_position_versions_qualification_standard_version_fkey"
    FOREIGN KEY ("agency_id", "qualification_standard_version_id")
    REFERENCES "qualification_standard_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_position_versions_staffing_authority_fkey"
    FOREIGN KEY ("agency_id", "staffing_authority_id")
    REFERENCES "staffing_authorities"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_position_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "plantilla_position_versions_position_version_key" UNIQUE ("position_id", "version_no"),
  CONSTRAINT "plantilla_position_versions_position_id_key" UNIQUE ("agency_id", "position_id", "id"),
  CONSTRAINT "plantilla_position_versions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "plantilla_position_versions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

ALTER TABLE "plantilla_positions"
  ADD CONSTRAINT "plantilla_positions_current_version_fkey"
  FOREIGN KEY ("agency_id", "current_version_id")
  REFERENCES "plantilla_position_versions"("agency_id", "id") ON DELETE RESTRICT;

ALTER TABLE "organization_unit_versions"
  ADD CONSTRAINT "organization_unit_versions_head_position_fkey"
  FOREIGN KEY ("agency_id", "head_position_id")
  REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "plantilla_position_versions_one_draft"
  ON "plantilla_position_versions" ("position_id")
  WHERE "status" = 'DRAFT';

ALTER TABLE "plantilla_position_versions"
  ADD CONSTRAINT "plantilla_position_versions_published_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "position_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'SUPERSEDED'));

CREATE INDEX "plantilla_positions_status_item_number_idx"
  ON "plantilla_positions" ("agency_id", "status", "item_number");
CREATE INDEX "plantilla_position_versions_effective_idx"
  ON "plantilla_position_versions" ("agency_id", "position_id", "effective_from");
CREATE INDEX "plantilla_position_versions_search_idx"
  ON "plantilla_position_versions" ("agency_id", "organization_unit_id", "salary_grade");

CREATE OR REPLACE FUNCTION set_plantilla_position_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_plantilla_position_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW."status" <> 'PROPOSED' OR NEW."current_version_id" IS NOT NULL)
      AND current_setting('app.plantilla_position_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Plantilla Position projections require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plantilla Positions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."item_number" IS DISTINCT FROM NEW."item_number"
    OR OLD."created_from_authority_id" IS DISTINCT FROM NEW."created_from_authority_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Plantilla Position identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF (OLD."status" IS DISTINCT FROM NEW."status"
      OR OLD."current_version_id" IS DISTINCT FROM NEW."current_version_id")
    AND current_setting('app.plantilla_position_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Plantilla Position projections require the application service'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_plantilla_position_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.plantilla_position_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Plantilla Position transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plantilla Position versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'Plantilla Position versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."position_id" IS DISTINCT FROM OLD."position_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Plantilla Position identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('app.plantilla_position_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Plantilla Position transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."position_id" IS DISTINCT FROM OLD."position_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."organization_unit_id" IS DISTINCT FROM OLD."organization_unit_id"
      OR NEW."qualification_standard_version_id" IS DISTINCT FROM OLD."qualification_standard_version_id"
      OR NEW."staffing_authority_id" IS DISTINCT FROM OLD."staffing_authority_id"
      OR NEW."position_title" IS DISTINCT FROM OLD."position_title"
      OR NEW."parenthetical_title" IS DISTINCT FROM OLD."parenthetical_title"
      OR NEW."salary_grade" IS DISTINCT FROM OLD."salary_grade"
      OR NEW."funding_source" IS DISTINCT FROM OLD."funding_source"
      OR NEW."employment_category" IS DISTINCT FROM OLD."employment_category"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR NEW."effective_to" IS NULL THEN
      RAISE EXCEPTION 'Active Plantilla Position versions are immutable except for supersession'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('ACTIVE', 'SUPERSEDED') AND NEW."status" = 'VOIDED' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."position_id" IS DISTINCT FROM OLD."position_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."organization_unit_id" IS DISTINCT FROM OLD."organization_unit_id"
      OR NEW."qualification_standard_version_id" IS DISTINCT FROM OLD."qualification_standard_version_id"
      OR NEW."staffing_authority_id" IS DISTINCT FROM OLD."staffing_authority_id"
      OR NEW."position_title" IS DISTINCT FROM OLD."position_title"
      OR NEW."parenthetical_title" IS DISTINCT FROM OLD."parenthetical_title"
      OR NEW."salary_grade" IS DISTINCT FROM OLD."salary_grade"
      OR NEW."funding_source" IS DISTINCT FROM OLD."funding_source"
      OR NEW."employment_category" IS DISTINCT FROM OLD."employment_category"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
      OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Published Plantilla Position versions are immutable except for correction voiding'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."position_id" IS DISTINCT FROM OLD."position_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Plantilla Position activation cannot rewrite identity'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Plantilla Position version state cannot be changed through this path'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "plantilla_positions_updated_at_trigger"
  BEFORE UPDATE ON "plantilla_positions"
  FOR EACH ROW EXECUTE FUNCTION set_plantilla_position_updated_at();
CREATE TRIGGER "plantilla_positions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "plantilla_positions"
  FOR EACH ROW EXECUTE FUNCTION guard_plantilla_position_mutation();
CREATE TRIGGER "plantilla_position_versions_updated_at_trigger"
  BEFORE UPDATE ON "plantilla_position_versions"
  FOR EACH ROW EXECUTE FUNCTION set_plantilla_position_updated_at();
CREATE TRIGGER "plantilla_position_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "plantilla_position_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_plantilla_position_version_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "plantilla_positions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "plantilla_position_versions" TO hris_app;

ALTER TABLE "plantilla_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plantilla_positions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "plantilla_position_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plantilla_position_versions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "plantilla_positions_select" ON "plantilla_positions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "plantilla_positions_insert" ON "plantilla_positions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "plantilla_positions_update" ON "plantilla_positions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "plantilla_position_versions_select" ON "plantilla_position_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "plantilla_position_versions_insert" ON "plantilla_position_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "plantilla_position_versions_update" ON "plantilla_position_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('positions.items.read', 'positions', 'MEDIUM', 'Read Agency Plantilla Positions'),
  ('positions.items.create', 'positions', 'HIGH', 'Create Agency Plantilla Positions'),
  ('positions.items.update', 'positions', 'HIGH', 'Edit Plantilla Position Drafts and Successors'),
  ('positions.history.read', 'positions', 'MEDIUM', 'Read Plantilla Position History')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'positions.items.read',
  'positions.items.create',
  'positions.items.update',
  'positions.history.read'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'plantilla_officer', 'budget_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('positions.items.read', 'positions.history.read')
WHERE r."code" IN ('recruitment_officer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
