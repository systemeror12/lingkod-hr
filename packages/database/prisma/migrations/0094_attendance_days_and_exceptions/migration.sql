-- Phase 7 Attendance calculation. One Attendance Day calculation version
-- preserves the exact resolved Attendance Applicability, Schedule Assignment,
-- Work Schedule Version, Work Arrangement Version, Holiday Calendar Version,
-- Attendance Events, Attendance Context, and Leave-owned coverage used for one
-- Work Date. Attendance Day Segments are immutable, non-overlapping, and carry
-- their expected-duty relation, coverage or deficit classification, holiday
-- classification, and source references. All Attendance Exceptions in the MVP
-- are blocking; calculation never invents a timestamp or silently picks a
-- configuration. Outside-schedule and statutory-night-window minutes stay
-- factual candidates and never authorize overtime, COC, or compensation.

CREATE TABLE "attendance_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_periods_status_check" CHECK ("status" IN ('OPEN', 'FINALIZED')),
  CONSTRAINT "attendance_periods_range_check" CHECK ("date_to" >= "date_from"),
  CONSTRAINT "attendance_periods_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_periods_code_key" UNIQUE ("agency_id", "code"),
  CONSTRAINT "attendance_periods_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_periods_range_idx"
  ON "attendance_periods" ("agency_id", "date_from", "date_to");

CREATE TABLE "attendance_days" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_period_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "schedule_assignment_id" UUID,
  "work_schedule_version_id" UUID,
  "work_arrangement_version_id" UUID,
  "holiday_calendar_version_id" UUID,
  "day_classification" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expected_minutes" INTEGER NOT NULL DEFAULT 0,
  "worked_minutes" INTEGER NOT NULL DEFAULT 0,
  "coverage_minutes" INTEGER NOT NULL DEFAULT 0,
  "late_minutes" INTEGER NOT NULL DEFAULT 0,
  "undertime_minutes" INTEGER NOT NULL DEFAULT 0,
  "absence_minutes" INTEGER NOT NULL DEFAULT 0,
  "official_business_minutes" INTEGER NOT NULL DEFAULT 0,
  "official_travel_minutes" INTEGER NOT NULL DEFAULT 0,
  "training_minutes" INTEGER NOT NULL DEFAULT 0,
  "approved_absence_minutes" INTEGER NOT NULL DEFAULT 0,
  "posted_leave_minutes" INTEGER NOT NULL DEFAULT 0,
  "outside_schedule_minutes" INTEGER NOT NULL DEFAULT 0,
  "statutory_night_window_minutes" INTEGER NOT NULL DEFAULT 0,
  "calculation_version" INTEGER NOT NULL DEFAULT 1,
  "rule_snapshot" JSONB NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT TRUE,
  "calculated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_days_day_classification_check" CHECK (
    "day_classification" IN ('SCHEDULED', 'UNSCHEDULED_SERVICE')
  ),
  CONSTRAINT "attendance_days_status_check" CHECK (
    "status" IN ('PENDING', 'CALCULATED', 'EXCEPTION', 'APPROVED')
  ),
  CONSTRAINT "attendance_days_calculation_version_check" CHECK ("calculation_version" > 0),
  CONSTRAINT "attendance_days_expected_minutes_check" CHECK ("expected_minutes" >= 0),
  CONSTRAINT "attendance_days_worked_minutes_check" CHECK ("worked_minutes" >= 0),
  CONSTRAINT "attendance_days_coverage_minutes_check" CHECK ("coverage_minutes" >= 0),
  CONSTRAINT "attendance_days_late_minutes_check" CHECK ("late_minutes" >= 0),
  CONSTRAINT "attendance_days_undertime_minutes_check" CHECK ("undertime_minutes" >= 0),
  CONSTRAINT "attendance_days_absence_minutes_check" CHECK ("absence_minutes" >= 0),
  CONSTRAINT "attendance_days_official_business_minutes_check" CHECK ("official_business_minutes" >= 0),
  CONSTRAINT "attendance_days_official_travel_minutes_check" CHECK ("official_travel_minutes" >= 0),
  CONSTRAINT "attendance_days_training_minutes_check" CHECK ("training_minutes" >= 0),
  CONSTRAINT "attendance_days_approved_absence_minutes_check" CHECK ("approved_absence_minutes" >= 0),
  CONSTRAINT "attendance_days_posted_leave_minutes_check" CHECK ("posted_leave_minutes" >= 0),
  CONSTRAINT "attendance_days_outside_schedule_minutes_check" CHECK ("outside_schedule_minutes" >= 0),
  CONSTRAINT "attendance_days_statutory_night_window_minutes_check" CHECK ("statutory_night_window_minutes" >= 0),
  CONSTRAINT "attendance_days_period_fkey" FOREIGN KEY ("agency_id", "attendance_period_id")
    REFERENCES "attendance_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_days_employee_fkey" FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_days_assignment_fkey" FOREIGN KEY ("agency_id", "schedule_assignment_id")
    REFERENCES "schedule_assignments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_days_schedule_version_fkey" FOREIGN KEY ("agency_id", "work_schedule_version_id")
    REFERENCES "work_schedule_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_days_arrangement_version_fkey" FOREIGN KEY ("agency_id", "work_arrangement_version_id")
    REFERENCES "work_arrangement_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_days_holiday_version_fkey" FOREIGN KEY ("agency_id", "holiday_calendar_version_id")
    REFERENCES "holiday_calendar_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_days_version_key" UNIQUE (
    "attendance_period_id", "employee_id", "work_date", "calculation_version"
  ),
  CONSTRAINT "attendance_days_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "attendance_days_one_current_uq"
  ON "attendance_days" ("agency_id", "employee_id", "work_date")
  WHERE "is_current";

CREATE INDEX "attendance_days_employee_date_idx"
  ON "attendance_days" ("agency_id", "employee_id", "work_date");
CREATE INDEX "attendance_days_period_status_idx"
  ON "attendance_days" ("agency_id", "attendance_period_id", "status");

CREATE TABLE "attendance_day_segments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_day_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "duty_relation" TEXT NOT NULL,
  "coverage_type" TEXT NOT NULL,
  "deficit_type" TEXT,
  "holiday_classification" TEXT,
  "source_references" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_day_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_day_segments_sequence_no_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "attendance_day_segments_interval_check" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "attendance_day_segments_duty_relation_check" CHECK (
    "duty_relation" IN ('EXPECTED', 'OUTSIDE_SCHEDULE')
  ),
  CONSTRAINT "attendance_day_segments_coverage_type_check" CHECK (
    "coverage_type" IN (
      'WORKED', 'OFFICIAL_BUSINESS', 'OFFICIAL_TRAVEL', 'TRAINING',
      'APPROVED_ABSENCE', 'POSTED_LEAVE', 'UNCOVERED'
    )
  ),
  CONSTRAINT "attendance_day_segments_deficit_type_check" CHECK (
    "deficit_type" IS NULL OR "deficit_type" IN ('TARDINESS', 'UNDERTIME', 'ABSENCE')
  ),
  CONSTRAINT "attendance_day_segments_deficit_pairing_check" CHECK (
    ("coverage_type" = 'UNCOVERED') = ("deficit_type" IS NOT NULL)
  ),
  CONSTRAINT "attendance_day_segments_day_fkey" FOREIGN KEY ("agency_id", "attendance_day_id")
    REFERENCES "attendance_days"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_day_segments_sequence_key" UNIQUE ("attendance_day_id", "sequence_no"),
  CONSTRAINT "attendance_day_segments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_day_segments_day_idx"
  ON "attendance_day_segments" ("agency_id", "attendance_day_id", "starts_at");

CREATE TABLE "attendance_exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_day_id" UUID NOT NULL,
  "exception_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "resolved_at" TIMESTAMPTZ(6),
  "resolved_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_exceptions_status_check" CHECK (
    "status" IN ('OPEN', 'RESOLVED', 'WAIVED')
  ),
  CONSTRAINT "attendance_exceptions_type_check" CHECK (length(btrim("exception_type")) > 0),
  CONSTRAINT "attendance_exceptions_resolution_check" CHECK (
    "status" = 'OPEN' OR ("resolved_at" IS NOT NULL AND "resolved_by_membership_id" IS NOT NULL)
  ),
  CONSTRAINT "attendance_exceptions_day_fkey" FOREIGN KEY ("agency_id", "attendance_day_id")
    REFERENCES "attendance_days"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_exceptions_resolver_fkey" FOREIGN KEY ("agency_id", "resolved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_exceptions_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_exceptions_day_idx"
  ON "attendance_exceptions" ("agency_id", "attendance_day_id", "status");
CREATE INDEX "attendance_exceptions_open_idx"
  ON "attendance_exceptions" ("agency_id", "status", "exception_type");

-- One Attendance Day calculation version owns non-overlapping segments. The
-- union of coverage types may not be expressed as overlapping rows because the
-- derived totals must never double-count one minute.
ALTER TABLE "attendance_day_segments"
  ADD CONSTRAINT "attendance_day_segments_no_overlap_excl"
  EXCLUDE USING gist (
    "attendance_day_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  );

-- Attendance Day versions are immutable. Only the current-version pointer may
-- move to a successor revision so historical versions stay reproducible.
CREATE OR REPLACE FUNCTION guard_attendance_day_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance Day versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."is_current" IS DISTINCT FROM OLD."is_current"
     AND NEW."status" = OLD."status"
     AND NEW."calculation_version" = OLD."calculation_version"
     AND NEW."expected_minutes" = OLD."expected_minutes"
     AND NEW."worked_minutes" = OLD."worked_minutes"
     AND NEW."coverage_minutes" = OLD."coverage_minutes"
     AND NEW."late_minutes" = OLD."late_minutes"
     AND NEW."undertime_minutes" = OLD."undertime_minutes"
     AND NEW."absence_minutes" = OLD."absence_minutes"
     AND NEW."official_business_minutes" = OLD."official_business_minutes"
     AND NEW."official_travel_minutes" = OLD."official_travel_minutes"
     AND NEW."training_minutes" = OLD."training_minutes"
     AND NEW."approved_absence_minutes" = OLD."approved_absence_minutes"
     AND NEW."posted_leave_minutes" = OLD."posted_leave_minutes"
     AND NEW."outside_schedule_minutes" = OLD."outside_schedule_minutes"
     AND NEW."statutory_night_window_minutes" = OLD."statutory_night_window_minutes"
     AND NEW."rule_snapshot" IS NOT DISTINCT FROM OLD."rule_snapshot"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Attendance Day versions are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "attendance_days_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_days"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_day_mutation();

CREATE OR REPLACE FUNCTION guard_attendance_day_segment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Attendance Day Segments are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance Day Segments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_day_segments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_day_segments"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_day_segment_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "attendance_periods" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "attendance_days" TO hris_app;
GRANT SELECT, INSERT ON TABLE "attendance_day_segments" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "attendance_exceptions" TO hris_app;

ALTER TABLE "attendance_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_days" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_day_segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_day_segments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_exceptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attendance_periods_select" ON "attendance_periods"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_periods_insert" ON "attendance_periods"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_periods_update" ON "attendance_periods"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_days_select" ON "attendance_days"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_days_insert" ON "attendance_days"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_days_update" ON "attendance_days"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_day_segments_select" ON "attendance_day_segments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_day_segments_insert" ON "attendance_day_segments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_exceptions_select" ON "attendance_exceptions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_exceptions_insert" ON "attendance_exceptions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_exceptions_update" ON "attendance_exceptions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  (
    'attendance.days.calculate',
    'attendance',
    'HIGH',
    'Create an Attendance Day calculation version from the resolved configuration, events, context, and Leave-owned coverage'
  ),
  (
    'attendance.days.read',
    'attendance',
    'MEDIUM',
    'Read Attendance Day calculations, segments, and Attendance Exceptions within the granted scope'
  ),
  (
    'attendance.days.flag',
    'attendance',
    'HIGH',
    'Flag a calculated Attendance Day with a blocking Attendance Exception'
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.days.calculate',
  'attendance.days.read',
  'attendance.days.flag'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'ASSIGNED_OFFICE'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.days.read'
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.days.read'
WHERE r."code" IN ('payroll_preparer', 'internal_auditor') AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.days.read'
WHERE r."code" = 'employee' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_day_segments_no_overlap_excl'
  ) THEN
    RAISE EXCEPTION 'Attendance Day Segment non-overlap verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_day_segments_deficit_pairing_check'
  ) THEN
    RAISE EXCEPTION 'Attendance Day Segment deficit pairing verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_days_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance Day immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_day_segments_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance Day Segment immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'attendance_days_one_current_uq'
  ) THEN
    RAISE EXCEPTION 'Attendance Day current-version verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.days.calculate'
  ) THEN
    RAISE EXCEPTION 'Attendance Day calculate permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.days.read'
  ) THEN
    RAISE EXCEPTION 'Attendance Day read permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.days.flag'
  ) THEN
    RAISE EXCEPTION 'Attendance Day flag permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator'
      AND p."code" = 'attendance.days.calculate'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'HR Administrator Attendance Day calculate grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee'
      AND p."code" = 'attendance.days.read'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'Employee Attendance Day read grant verification failed';
  END IF;
END;
$$;
