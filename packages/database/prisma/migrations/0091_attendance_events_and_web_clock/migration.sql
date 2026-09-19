-- Phase 7 attendance capture.
--
-- Attendance Events are immutable raw facts. WEB_CLOCK and MANUAL are the only
-- MVP sources; biometric devices and imports are out of scope. AM In, AM Out,
-- PM In, and PM Out are DTR presentation slots derived from semantic events,
-- never stored event types.
--
-- WEB_CLOCK enablement is Agency-level and effective-dated. It is disabled by
-- default: with no active version every web clock attempt fails closed. Each
-- activation closes its predecessor the day before and is retained forever.

CREATE TABLE "attendance_web_clock_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "activated_by_membership_id" UUID NOT NULL,
  "activated_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "attendance_web_clock_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_web_clock_versions_version_no_check" CHECK ("version_no" > 0),
  CONSTRAINT "attendance_web_clock_versions_status_check" CHECK (
    "status" IN ('ACTIVE', 'SUPERSEDED')
  ),
  CONSTRAINT "attendance_web_clock_versions_reason_check" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "attendance_web_clock_versions_effective_period_check" CHECK (
    "effective_to" IS NULL OR "effective_to" >= "effective_from"
  ),
  CONSTRAINT "attendance_web_clock_versions_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_web_clock_versions_activator_fkey" FOREIGN KEY ("agency_id", "activated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_web_clock_versions_version_key" UNIQUE ("agency_id", "version_no"),
  CONSTRAINT "attendance_web_clock_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "attendance_web_clock_versions"
  ADD CONSTRAINT "attendance_web_clock_versions_effective_excl"
  EXCLUDE USING gist (
    "agency_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE INDEX "attendance_web_clock_versions_effective_idx"
  ON "attendance_web_clock_versions" ("agency_id", "effective_from");

CREATE TABLE "attendance_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "event_time" TIMESTAMPTZ(6) NOT NULL,
  "event_type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "source_reference" TEXT,
  "entered_by_membership_id" UUID,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_events_event_type_check" CHECK (
    "event_type" IN ('TIME_IN', 'BREAK_OUT', 'BREAK_IN', 'TIME_OUT')
  ),
  CONSTRAINT "attendance_events_source_check" CHECK ("source" IN ('WEB_CLOCK', 'MANUAL')),
  CONSTRAINT "attendance_events_manual_check" CHECK (
    "source" <> 'MANUAL'
    OR ("entered_by_membership_id" IS NOT NULL AND "reason" IS NOT NULL)
  ),
  CONSTRAINT "attendance_events_reason_check" CHECK (
    "reason" IS NULL OR length(btrim("reason")) > 0
  ),
  CONSTRAINT "attendance_events_source_reference_check" CHECK (
    "source_reference" IS NULL OR length(btrim("source_reference")) > 0
  ),
  CONSTRAINT "attendance_events_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_events_employee_fkey" FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_events_entered_by_fkey" FOREIGN KEY ("agency_id", "entered_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_events_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_events_employee_time_idx"
  ON "attendance_events" ("agency_id", "employee_id", "event_time");
CREATE INDEX "attendance_events_time_idx"
  ON "attendance_events" ("agency_id", "event_time");

CREATE OR REPLACE FUNCTION guard_attendance_web_clock_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE'
      OR current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Attendance web clock transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."effective_to" IS NOT NULL THEN
      RAISE EXCEPTION 'An Attendance web clock version starts open-ended'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance web clock versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Attendance web clock versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Attendance web clock transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."effective_to" IS NULL
      OR NEW."effective_to" < OLD."effective_from"
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."enabled" IS DISTINCT FROM OLD."enabled"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."reason" IS DISTINCT FROM OLD."reason"
      OR NEW."activated_by_membership_id" IS DISTINCT FROM OLD."activated_by_membership_id"
      OR NEW."activated_at" IS DISTINCT FROM OLD."activated_at"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Attendance web clock supersession may only close the effective period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported Attendance web clock version transition'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "attendance_web_clock_versions_updated_at_trigger"
  BEFORE UPDATE ON "attendance_web_clock_versions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "attendance_web_clock_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_web_clock_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_web_clock_version_mutation();
CREATE TRIGGER "attendance_events_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "attendance_web_clock_versions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "attendance_events" TO hris_app;

ALTER TABLE "attendance_web_clock_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_web_clock_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attendance_web_clock_versions_select" ON "attendance_web_clock_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_web_clock_versions_insert" ON "attendance_web_clock_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_web_clock_versions_update" ON "attendance_web_clock_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_events_select" ON "attendance_events"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_events_insert" ON "attendance_events"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('attendance.events.create_manual', 'attendance', 'HIGH', 'Record an authorized manual Attendance Event with a reason'),
  ('attendance.events.clock', 'attendance', 'MEDIUM', 'Use the optional Employee web clock under Attendance Applicability'),
  ('attendance.events.read', 'attendance', 'MEDIUM', 'Read Attendance Events within the granted scope')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.events.create_manual',
  'attendance.events.clock',
  'attendance.events.read'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.events.clock'
WHERE r."code" IN ('personnel_records_officer', 'employee') AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.events.read'
WHERE r."code" IN ('personnel_records_officer', 'payroll_preparer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.events.read'
WHERE r."code" = 'employee' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
