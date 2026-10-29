-- Phase 8 Overtime Service Records (#320), as overtime-coc-cto-schema.md §2
-- leaves them. Recording creates a RENDERED record under an APPROVED
-- authority covering the Employee and Work Date; submitting stores the Actual
-- Overtime Hours read from locked Attendance and moves it to
-- FOR_CERTIFICATION. Certification (#535) fills the certification columns.

CREATE TABLE "overtime_service_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "overtime_authority_employee_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "claimed_hours" NUMERIC(12,4) NOT NULL,
  "accomplishment" TEXT NOT NULL,
  "actual_minutes" INTEGER,
  "source_attendance_day_id" UUID,
  "day_classification" TEXT,
  "certified_minutes" INTEGER,
  "decline_reason" TEXT,
  "status" TEXT NOT NULL,
  "recorded_by_membership_id" UUID NOT NULL,
  "certified_by_membership_id" UUID,
  "certified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "overtime_service_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "overtime_service_records_claimed_hours_check"
    CHECK ("claimed_hours" > 0),
  CONSTRAINT "overtime_service_records_accomplishment_check"
    CHECK (btrim("accomplishment") <> ''),
  CONSTRAINT "overtime_service_records_actual_minutes_check"
    CHECK ("actual_minutes" IS NULL OR "actual_minutes" >= 0),
  CONSTRAINT "overtime_service_records_certified_minutes_check"
    CHECK ("certified_minutes" IS NULL OR "certified_minutes" >= 0),
  CONSTRAINT "overtime_service_records_status_check"
    CHECK ("status" IN ('RENDERED', 'FOR_CERTIFICATION', 'CERTIFIED', 'NOT_CERTIFIED')),
  CONSTRAINT "overtime_service_records_actual_check"
    CHECK (
      "status" = 'RENDERED'
      OR (
        "actual_minutes" IS NOT NULL
        AND "source_attendance_day_id" IS NOT NULL
        AND "day_classification" IS NOT NULL
      )
    ),
  CONSTRAINT "overtime_service_records_certified_check"
    CHECK (("status" = 'CERTIFIED') = ("certified_minutes" IS NOT NULL)),
  CONSTRAINT "overtime_service_records_certified_within_actual_check"
    CHECK ("certified_minutes" IS NULL OR "certified_minutes" <= "actual_minutes"),
  CONSTRAINT "overtime_service_records_decline_check"
    CHECK (("status" = 'NOT_CERTIFIED') = ("decline_reason" IS NOT NULL)),
  CONSTRAINT "overtime_service_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_service_records_authority_employee_fkey"
    FOREIGN KEY ("agency_id", "overtime_authority_employee_id")
    REFERENCES "overtime_authority_employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_service_records_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_service_records_source_day_fkey"
    FOREIGN KEY ("agency_id", "source_attendance_day_id")
    REFERENCES "attendance_days"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_service_records_recorded_by_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_service_records_certified_by_fkey"
    FOREIGN KEY ("agency_id", "certified_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "overtime_service_records_agency_id_key" UNIQUE ("agency_id", "id")
);

-- One record per Employee and Work Date that is not NOT_CERTIFIED, across all
-- authorities. A declined record frees the date for a new one.
CREATE UNIQUE INDEX "overtime_service_one_live_per_date_uq"
  ON "overtime_service_records" ("agency_id", "employee_id", "work_date")
  WHERE "status" <> 'NOT_CERTIFIED';

CREATE INDEX "overtime_service_records_authority_employee_idx"
  ON "overtime_service_records" ("agency_id", "overtime_authority_employee_id");

-- A record starts RENDERED under an APPROVED authority that covers its
-- Employee and Work Date. Locking the authority row FOR SHARE serializes
-- recording with cancellation, which locks it FOR UPDATE and then refuses
-- once any record exists.
CREATE OR REPLACE FUNCTION guard_overtime_service_record_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  covered_employee_id UUID;
  authority_status TEXT;
  authority_from DATE;
  authority_to DATE;
BEGIN
  IF NEW."status" <> 'RENDERED'
    OR NEW."actual_minutes" IS NOT NULL
    OR NEW."source_attendance_day_id" IS NOT NULL
    OR NEW."day_classification" IS NOT NULL
    OR NEW."certified_by_membership_id" IS NOT NULL
    OR NEW."certified_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'An Overtime Service Record is recorded as RENDERED'
      USING ERRCODE = '55000';
  END IF;

  SELECT ae."employee_id", a."status", a."work_date_from", a."work_date_to"
  INTO covered_employee_id, authority_status, authority_from, authority_to
  FROM "overtime_authority_employees" ae
  JOIN "overtime_authorities" a
    ON a."agency_id" = ae."agency_id" AND a."id" = ae."overtime_authority_id"
  WHERE ae."agency_id" = NEW."agency_id"
    AND ae."id" = NEW."overtime_authority_employee_id"
  FOR SHARE OF a;

  IF authority_status IS DISTINCT FROM 'APPROVED'
    OR covered_employee_id IS DISTINCT FROM NEW."employee_id"
    OR NEW."work_date" NOT BETWEEN authority_from AND authority_to
  THEN
    RAISE EXCEPTION 'No APPROVED Overtime Authority covers the Employee and Work Date'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "overtime_service_records_insert_trigger"
  BEFORE INSERT ON "overtime_service_records"
  FOR EACH ROW EXECUTE FUNCTION guard_overtime_service_record_insert();

-- Records are retained. What was recorded never changes; status moves only
-- forward, and the actual hours are written once, on submission.
CREATE OR REPLACE FUNCTION guard_overtime_service_record_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'overtime_service_records records cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."overtime_authority_employee_id" IS DISTINCT FROM OLD."overtime_authority_employee_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."work_date" IS DISTINCT FROM OLD."work_date"
    OR NEW."claimed_hours" IS DISTINCT FROM OLD."claimed_hours"
    OR NEW."accomplishment" IS DISTINCT FROM OLD."accomplishment"
    OR NEW."recorded_by_membership_id" IS DISTINCT FROM OLD."recorded_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'A recorded Overtime Service Record cannot be rewritten'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD."status" = 'RENDERED' AND NEW."status" = 'FOR_CERTIFICATION')
    OR (OLD."status" = 'FOR_CERTIFICATION' AND NEW."status" IN ('CERTIFIED', 'NOT_CERTIFIED'))
  ) THEN
    RAISE EXCEPTION 'An Overtime Service Record cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'RENDERED' AND (
    NEW."actual_minutes" IS DISTINCT FROM OLD."actual_minutes"
    OR NEW."source_attendance_day_id" IS DISTINCT FROM OLD."source_attendance_day_id"
    OR NEW."day_classification" IS DISTINCT FROM OLD."day_classification"
  ) THEN
    RAISE EXCEPTION 'Actual Overtime Hours are written once, on submission'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "overtime_service_records_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "overtime_service_records"
  FOR EACH ROW EXECUTE FUNCTION guard_overtime_service_record_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "overtime_service_records" TO hris_app;

ALTER TABLE "overtime_service_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overtime_service_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY "overtime_service_records_select" ON "overtime_service_records"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "overtime_service_records_insert" ON "overtime_service_records"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "overtime_service_records_update" ON "overtime_service_records"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

-- hris-controls §6.9: Supervisor `S` and Employee `O` on
-- `overtime.service.record` and `.submit`. The Supervisor's grant is
-- DIRECT_REPORTS (ADR 0007); the Employee's is OWN. The HR Administrator's
-- `C` (agency-configurable) is not a baseline grant.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.service.record', 'overtime', 'MEDIUM', 'Record overtime service rendered under an approved Overtime Authority'),
  ('overtime.service.submit', 'overtime', 'MEDIUM', 'Submit an Overtime Service Record for certification')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.service.record', 'overtime.service.submit')
WHERE r."code" = 'supervisor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.service.record', 'overtime.service.submit')
WHERE r."code" = 'employee'
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
    WHERE relname = 'overtime_service_records'
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Overtime Service Record row-level security verification failed';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."agency_id" IS NULL
      AND p."code" IN ('overtime.service.record', 'overtime.service.submit')
      AND (
        (r."code" = 'supervisor' AND rp."scope_policy" = 'DIRECT_REPORTS')
        OR (r."code" = 'employee' AND rp."scope_policy" = 'OWN')
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Overtime Service Record grant verification failed';
  END IF;
END;
$$;
