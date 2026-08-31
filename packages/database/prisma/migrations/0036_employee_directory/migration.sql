-- Employees are the stable Agency personnel identity. This ticket creates
-- PREBOARDING records only: active service, position, and compensation facts
-- arrive through their owning domains later in Phase 5.

CREATE TABLE "employees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_number" CITEXT NOT NULL,
  "legal_name" CITEXT NOT NULL,
  "birth_date" DATE NOT NULL,
  "sex" TEXT NOT NULL,
  "civil_status" TEXT NOT NULL,
  "contact_email" CITEXT NOT NULL,
  "service_status" TEXT NOT NULL DEFAULT 'PREBOARDING',
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employees_sex_check"
    CHECK ("sex" IN ('FEMALE', 'MALE')),
  CONSTRAINT "employees_civil_status_check"
    CHECK ("civil_status" IN ('SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED')),
  CONSTRAINT "employees_service_status_check"
    CHECK ("service_status" IN ('PREBOARDING')),
  CONSTRAINT "employees_employee_number_check"
    CHECK (btrim("employee_number"::TEXT) <> ''),
  CONSTRAINT "employees_legal_name_check"
    CHECK (btrim("legal_name"::TEXT) <> ''),
  CONSTRAINT "employees_contact_email_check"
    CHECK (btrim("contact_email"::TEXT) <> ''),
  CONSTRAINT "employees_birth_date_check"
    CHECK ("birth_date" <= CURRENT_DATE),
  CONSTRAINT "employees_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "employees_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "employees_agency_employee_number_key" UNIQUE ("agency_id", "employee_number"),
  CONSTRAINT "employees_agency_person_identity_key" UNIQUE ("agency_id", "legal_name", "birth_date"),
  CONSTRAINT "employees_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employees_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT
);

-- One Employee links to at most one same-Agency Agency Membership, and one
-- Agency Membership represents at most one Employee.
ALTER TABLE "agency_memberships"
  ADD CONSTRAINT "agency_memberships_employee_fkey"
  FOREIGN KEY ("agency_id", "employee_id")
  REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "agency_memberships_one_employee"
  ON "agency_memberships" ("agency_id", "employee_id")
  WHERE "employee_id" IS NOT NULL;

-- Employee Membership links change only through the application service so
-- that each change is recorded with an audit event in the same transaction.
CREATE OR REPLACE FUNCTION guard_membership_employee_link()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."employee_id" IS NOT NULL
      AND current_setting('app.employee_membership_link', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Employee Membership links are managed by the application service'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    AND current_setting('app.employee_membership_link', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Employee Membership links are managed by the application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agency_memberships_employee_link_trigger"
  BEFORE INSERT OR UPDATE OF "employee_id" ON "agency_memberships"
  FOR EACH ROW EXECUTE FUNCTION guard_membership_employee_link();

CREATE OR REPLACE FUNCTION set_employee_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_employee_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employees are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
      OR OLD."employee_number" IS DISTINCT FROM NEW."employee_number"
      OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
      OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
      RAISE EXCEPTION 'Employee identity is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "employees_updated_at_trigger"
  BEFORE UPDATE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION set_employee_updated_at();
CREATE TRIGGER "employees_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION guard_employee_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "employees" TO hris_app;

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;

CREATE POLICY "employees_select" ON "employees"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "employees_insert" ON "employees"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "employees_update" ON "employees"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.employees.read', 'personnel', 'MEDIUM', 'Read the Agency Employee directory'),
  ('personnel.employees.create', 'personnel', 'HIGH', 'Create PREBOARDING Employees'),
  ('personnel.employees.update', 'personnel', 'HIGH', 'Manage Employee Agency Membership links')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES
  ('personnel_records_officer', 'Personnel Records Officer', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.employees.read',
  'personnel.employees.create',
  'personnel.employees.update'
)
WHERE r."code" IN ('personnel_records_officer', 'hrmo_administrator', 'agency_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
