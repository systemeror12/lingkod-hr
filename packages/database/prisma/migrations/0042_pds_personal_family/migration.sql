-- PDS Version, Personal Information, and Family Background for the
-- CS Form No. 212, Revised 2026 implementation seam.

CREATE TABLE "pds_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "form_version" TEXT NOT NULL DEFAULT 'CS_FORM_212_REVISED_2026',
  "as_of_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "supersedes_version_id" UUID,
  "correction_reason" TEXT,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "pds_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_versions_version_no_check" CHECK ("version_no" > 0),
  CONSTRAINT "pds_versions_form_version_check"
    CHECK ("form_version" = 'CS_FORM_212_REVISED_2026'),
  CONSTRAINT "pds_versions_status_check"
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'CERTIFIED', 'SUPERSEDED')),
  CONSTRAINT "pds_versions_supersedes_self_check"
    CHECK ("supersedes_version_id" IS NULL OR "supersedes_version_id" <> "id"),
  CONSTRAINT "pds_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_versions_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_versions_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_versions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_versions_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_versions_employee_version_key"
    UNIQUE ("agency_id", "employee_id", "version_no")
);

CREATE UNIQUE INDEX "pds_versions_one_editable"
  ON "pds_versions" ("agency_id", "employee_id")
  WHERE "status" IN ('DRAFT', 'RETURNED');
CREATE INDEX "pds_versions_employee_status_idx"
  ON "pds_versions" ("agency_id", "employee_id", "status");
CREATE INDEX "pds_versions_supersedes_idx"
  ON "pds_versions" ("agency_id", "supersedes_version_id");

CREATE TABLE "pds_personal_details" (
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "surname" TEXT,
  "first_name" TEXT,
  "name_extension" TEXT,
  "middle_name" TEXT,
  "birth_date" DATE,
  "birth_place" TEXT,
  "sex" TEXT,
  "civil_status" TEXT,
  "civil_status_detail" TEXT,
  "height_meters" NUMERIC(8,3),
  "weight_kilograms" NUMERIC(8,3),
  "blood_type" TEXT,
  "umid_id_number" TEXT,
  "pagibig_id_number" TEXT,
  "philhealth_number" TEXT,
  "phil_sys_card_number" TEXT,
  "tin_number" TEXT,
  "agency_employee_number" TEXT,
  "citizenship" TEXT,
  "dual_citizenship_type" TEXT,
  "dual_citizenship_country" TEXT,
  "residential_address" JSONB,
  "permanent_address" JSONB,
  "telephone_number" TEXT,
  "mobile_number" TEXT,
  "email_address" TEXT,
  CONSTRAINT "pds_personal_details_pkey" PRIMARY KEY ("pds_version_id"),
  CONSTRAINT "pds_personal_details_agency_id_key" UNIQUE ("agency_id", "pds_version_id"),
  CONSTRAINT "pds_personal_details_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_personal_details_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_personal_details_sex_check"
    CHECK ("sex" IS NULL OR "sex" IN ('MALE', 'FEMALE')),
  CONSTRAINT "pds_personal_details_civil_status_check"
    CHECK ("civil_status" IS NULL OR "civil_status" IN ('SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED', 'OTHER')),
  CONSTRAINT "pds_personal_details_citizenship_check"
    CHECK ("citizenship" IS NULL OR "citizenship" IN ('FILIPINO', 'DUAL_CITIZENSHIP')),
  CONSTRAINT "pds_personal_details_dual_type_check"
    CHECK ("dual_citizenship_type" IS NULL OR "dual_citizenship_type" IN ('BY_BIRTH', 'BY_NATURALIZATION')),
  CONSTRAINT "pds_personal_details_height_check"
    CHECK ("height_meters" IS NULL OR "height_meters" >= 0),
  CONSTRAINT "pds_personal_details_weight_check"
    CHECK ("weight_kilograms" IS NULL OR "weight_kilograms" >= 0),
  CONSTRAINT "pds_personal_details_birth_date_check"
    CHECK ("birth_date" IS NULL OR "birth_date" <= CURRENT_DATE)
);

CREATE TABLE "pds_family_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "relationship_type" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "full_name" TEXT,
  "surname" TEXT,
  "first_name" TEXT,
  "middle_name" TEXT,
  "name_extension" TEXT,
  "birth_date" DATE,
  "occupation" TEXT,
  "employer_business_name" TEXT,
  "business_address" JSONB,
  "telephone_number" TEXT,
  CONSTRAINT "pds_family_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_family_records_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_family_records_relationship_check"
    CHECK ("relationship_type" IN ('SPOUSE', 'CHILD', 'FATHER', 'MOTHER')),
  CONSTRAINT "pds_family_records_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_family_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_family_records_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_family_records_birth_date_check"
    CHECK ("birth_date" IS NULL OR "birth_date" <= CURRENT_DATE),
  CONSTRAINT "pds_family_records_sequence_key"
    UNIQUE ("pds_version_id", "relationship_type", "sequence_no")
);

CREATE UNIQUE INDEX "pds_family_records_singleton_relationship"
  ON "pds_family_records" ("pds_version_id", "relationship_type")
  WHERE "relationship_type" IN ('SPOUSE', 'FATHER', 'MOTHER');
CREATE INDEX "pds_family_records_version_idx"
  ON "pds_family_records" ("agency_id", "pds_version_id", "relationship_type", "sequence_no");

CREATE OR REPLACE FUNCTION guard_pds_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.pds_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'PDS versions are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PDS versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'Only editable PDS versions may be changed'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."version_no" IS DISTINCT FROM NEW."version_no"
    OR OLD."form_version" IS DISTINCT FROM NEW."form_version"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'PDS version identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_pds_child_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
  version_agency_id UUID;
  version_id UUID;
BEGIN
  IF current_setting('app.pds_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'PDS section rows are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    version_agency_id := OLD."agency_id";
    version_id := OLD."pds_version_id";
  ELSE
    version_agency_id := NEW."agency_id";
    version_id := NEW."pds_version_id";
  END IF;

  SELECT "status" INTO version_status
  FROM "pds_versions"
  WHERE "agency_id" = version_agency_id
    AND "id" = version_id;
  IF version_status IS NULL OR version_status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'Certified or submitted PDS section rows are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "pds_versions_updated_at_trigger"
  BEFORE UPDATE ON "pds_versions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "pds_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_version_mutation();
CREATE TRIGGER "pds_personal_details_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_personal_details"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_family_records_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_family_records"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "pds_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "pds_personal_details" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_family_records" TO hris_app;

ALTER TABLE "pds_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_personal_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_personal_details" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_family_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_family_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pds_versions_isolation" ON "pds_versions"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_personal_details_isolation" ON "pds_personal_details"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_family_records_isolation" ON "pds_family_records"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.pds.read', 'personnel', 'HIGH', 'Read permitted PDS personal and family information'),
  ('personnel.pds.update', 'personnel', 'HIGH', 'Create and edit permitted PDS drafts')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('employee', 'Employee', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('personnel.pds.read', 'personnel.pds.update')
WHERE r."code" IN ('personnel_records_officer', 'hrmo_administrator', 'agency_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('personnel.pds.read', 'personnel.pds.update')
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
