-- Phase 8 Overtime Authority (#319), as overtime-coc-cto-schema.md §1 leaves
-- it. A draft names its requesting Organization Unit, purpose, Work Dates,
-- proposed compensation method, funding reference, and each covered
-- Employee's authorized hours. Review and approval come later (#532), which
-- fix the method and write each Employee's eligibility snapshot once.

CREATE TABLE "overtime_authorities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "requesting_unit_id" UUID NOT NULL,
  "authority_no" CITEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "work_date_from" DATE NOT NULL,
  "work_date_to" DATE NOT NULL,
  "compensation_method" TEXT NOT NULL,
  "funding_reference" TEXT,
  "status" TEXT NOT NULL,
  "approved_by_membership_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "overtime_authorities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "overtime_authorities_authority_no_check"
    CHECK (btrim("authority_no"::text) <> ''),
  CONSTRAINT "overtime_authorities_purpose_check"
    CHECK (btrim("purpose") <> ''),
  CONSTRAINT "overtime_authorities_method_check"
    CHECK ("compensation_method" IN ('COC', 'OVERTIME_PAY')),
  CONSTRAINT "overtime_authorities_status_check"
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'FOR_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT "overtime_authorities_work_dates_check"
    CHECK ("work_date_to" >= "work_date_from"),
  CONSTRAINT "overtime_authorities_funding_check"
    CHECK (
      "compensation_method" = 'COC'
      OR ("funding_reference" IS NOT NULL AND btrim("funding_reference") <> '')
    ),
  CONSTRAINT "overtime_authorities_approval_check"
    CHECK (
      "status" <> 'APPROVED'
      OR ("approved_by_membership_id" IS NOT NULL AND "approved_at" IS NOT NULL)
    ),
  CONSTRAINT "overtime_authorities_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_authorities_requesting_unit_fkey"
    FOREIGN KEY ("agency_id", "requesting_unit_id")
    REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_authorities_approved_by_fkey"
    FOREIGN KEY ("agency_id", "approved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_authorities_authority_no_key" UNIQUE ("agency_id", "authority_no"),
  CONSTRAINT "overtime_authorities_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "overtime_authorities_status_idx"
  ON "overtime_authorities" ("agency_id", "status", "work_date_from");

CREATE TABLE "overtime_authority_employees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "overtime_authority_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "authorized_hours" NUMERIC(12,4) NOT NULL,
  "task_description" TEXT,
  "eligibility_snapshot" JSONB,
  CONSTRAINT "overtime_authority_employees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "overtime_authority_employees_hours_check"
    CHECK ("authorized_hours" > 0),
  CONSTRAINT "overtime_authority_employees_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_authority_employees_authority_fkey"
    FOREIGN KEY ("agency_id", "overtime_authority_id")
    REFERENCES "overtime_authorities"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_authority_employees_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_authority_employees_employee_key"
    UNIQUE ("overtime_authority_id", "employee_id"),
  CONSTRAINT "overtime_authority_employees_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "overtime_authority_employees_employee_idx"
  ON "overtime_authority_employees" ("agency_id", "employee_id");

-- Only a DRAFT's content may change. A REJECTED or CANCELLED authority is
-- final, and an APPROVED one keeps its content, including its fixed method;
-- its status may still move, for cancellation before service.
CREATE OR REPLACE FUNCTION guard_overtime_authority_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'overtime_authorities records cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % Overtime Authority is final', OLD."status"
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."requesting_unit_id" IS DISTINCT FROM OLD."requesting_unit_id"
    OR NEW."authority_no" IS DISTINCT FROM OLD."authority_no"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."work_date_from" IS DISTINCT FROM OLD."work_date_from"
    OR NEW."work_date_to" IS DISTINCT FROM OLD."work_date_to"
    OR NEW."funding_reference" IS DISTINCT FROM OLD."funding_reference"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Only a DRAFT Overtime Authority can be edited'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'APPROVED' AND (
    NEW."compensation_method" IS DISTINCT FROM OLD."compensation_method"
    OR NEW."approved_by_membership_id" IS DISTINCT FROM OLD."approved_by_membership_id"
    OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
  ) THEN
    RAISE EXCEPTION 'An APPROVED Overtime Authority is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "overtime_authorities_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "overtime_authorities"
  FOR EACH ROW EXECUTE FUNCTION guard_overtime_authority_mutation();

-- Covered Employees change only while their authority is a DRAFT. The
-- eligibility snapshot is the one exception: it is written once, at approval.
CREATE OR REPLACE FUNCTION guard_overtime_authority_employee_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  authority_status TEXT;
BEGIN
  SELECT "status" INTO authority_status
  FROM "overtime_authorities"
  WHERE "id" = CASE WHEN TG_OP = 'INSERT' THEN NEW."overtime_authority_id"
                    ELSE OLD."overtime_authority_id" END;

  IF TG_OP = 'UPDATE'
    AND OLD."eligibility_snapshot" IS NULL
    AND NEW."eligibility_snapshot" IS NOT NULL
    AND NEW."agency_id" = OLD."agency_id"
    AND NEW."overtime_authority_id" = OLD."overtime_authority_id"
    AND NEW."employee_id" = OLD."employee_id"
    AND NEW."authorized_hours" = OLD."authorized_hours"
    AND NEW."task_description" IS NOT DISTINCT FROM OLD."task_description"
  THEN
    RETURN NEW;
  END IF;

  IF authority_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Covered Employees change only while the Overtime Authority is a DRAFT'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."overtime_authority_id" IS DISTINCT FROM OLD."overtime_authority_id"
    OR NEW."eligibility_snapshot" IS DISTINCT FROM OLD."eligibility_snapshot"
  ) THEN
    RAISE EXCEPTION 'A covered Employee cannot move authority or rewrite its snapshot'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "overtime_authority_employees_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "overtime_authority_employees"
  FOR EACH ROW EXECUTE FUNCTION guard_overtime_authority_employee_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "overtime_authorities" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "overtime_authority_employees" TO hris_app;

ALTER TABLE "overtime_authorities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overtime_authorities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "overtime_authority_employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overtime_authority_employees" FORCE ROW LEVEL SECURITY;

CREATE POLICY "overtime_authorities_select" ON "overtime_authorities"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "overtime_authorities_insert" ON "overtime_authorities"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "overtime_authorities_update" ON "overtime_authorities"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "overtime_authority_employees_select" ON "overtime_authority_employees"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "overtime_authority_employees_insert" ON "overtime_authority_employees"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "overtime_authority_employees_update" ON "overtime_authority_employees"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "overtime_authority_employees_delete" ON "overtime_authority_employees"
  FOR DELETE USING ("agency_id" = app_agency_id());

-- hris-controls §6.9: HR Admin `A` and Supervisor `S` on
-- `overtime.authorities.create`, `.submit`, and `.cancel`. The Supervisor's
-- grant is DIRECT_REPORTS (ADR 0007): every covered Employee must be one of
-- their direct reports. The Approving Official's `A` on `.cancel` covers
-- cancelling an APPROVED authority before service, which is not built yet, so
-- it is not granted here.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.authorities.create', 'overtime', 'MEDIUM', 'Create and edit a draft Overtime Authority'),
  ('overtime.authorities.submit', 'overtime', 'MEDIUM', 'Submit a draft Overtime Authority for review'),
  ('overtime.authorities.cancel', 'overtime', 'MEDIUM', 'Cancel an Overtime Authority')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'overtime.authorities.create',
  'overtime.authorities.submit',
  'overtime.authorities.cancel'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'overtime.authorities.create',
  'overtime.authorities.submit',
  'overtime.authorities.cancel'
)
WHERE r."code" = 'supervisor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'overtime_authorities'
      AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'overtime_authority_employees'
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Overtime Authority row-level security verification failed';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."agency_id" IS NULL
      AND p."code" IN (
        'overtime.authorities.create',
        'overtime.authorities.submit',
        'overtime.authorities.cancel'
      )
      AND (
        (r."code" IN ('agency_administrator', 'hrmo_administrator') AND rp."scope_policy" = 'AGENCY')
        OR (r."code" = 'supervisor' AND rp."scope_policy" = 'DIRECT_REPORTS')
      )
  ) <> 9 THEN
    RAISE EXCEPTION 'Overtime Authority grant verification failed';
  END IF;
END;
$$;
