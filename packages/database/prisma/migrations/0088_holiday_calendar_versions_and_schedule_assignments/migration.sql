-- Phase 7 Attendance configuration, continued.
--
-- A Holiday Calendar is a stable Agency, office, or worksite identity. Its
-- versions are immutable, authority-backed effective periods whose entries
-- categorize holiday, non-working, working, local, or suspension days. A Work
-- Arrangement Version selects exactly one stable Holiday Calendar, so a new
-- annual calendar version does not rewrite employee assignments.
--
-- A Schedule Assignment separately binds one Appointed Personnel record to one
-- active Work Schedule Version and one active Work Arrangement Version for a
-- non-overlapping effective period, with its own exact assignment authority.
-- Historical Attendance Days resolve the exact assignment and versions for the
-- Work Date; a missing or ambiguous input fails closed.

CREATE TABLE "holiday_calendar_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "holiday_calendar_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "authority_document_version_id" UUID,
  "approving_authority" TEXT,
  "status" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "activated_by_membership_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "holiday_calendar_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holiday_calendar_versions_version_no_check" CHECK ("version_no" > 0),
  CONSTRAINT "holiday_calendar_versions_status_check" CHECK (
    "status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')
  ),
  CONSTRAINT "holiday_calendar_versions_effective_period_check" CHECK (
    "effective_to" IS NULL OR "effective_to" >= "effective_from"
  ),
  CONSTRAINT "holiday_calendar_versions_approving_authority_check" CHECK (
    "approving_authority" IS NULL OR length(btrim("approving_authority")) > 0
  ),
  CONSTRAINT "holiday_calendar_versions_activated_evidence_check" CHECK (
    "status" = 'DRAFT' OR (
      "authority_document_version_id" IS NOT NULL
      AND "approving_authority" IS NOT NULL
      AND "activated_by_membership_id" IS NOT NULL
      AND "activated_at" IS NOT NULL
    )
  ),
  CONSTRAINT "holiday_calendar_versions_calendar_fkey" FOREIGN KEY ("agency_id", "holiday_calendar_id")
    REFERENCES "holiday_calendars"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "holiday_calendar_versions_authority_fkey" FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "holiday_calendar_versions_activator_fkey" FOREIGN KEY ("agency_id", "activated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "holiday_calendar_versions_version_key" UNIQUE ("holiday_calendar_id", "version_no"),
  CONSTRAINT "holiday_calendar_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "holiday_calendar_versions"
  ADD CONSTRAINT "holiday_calendar_versions_effective_excl"
  EXCLUDE USING gist (
    "holiday_calendar_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE INDEX "holiday_calendar_versions_calendar_status_idx"
  ON "holiday_calendar_versions" ("agency_id", "holiday_calendar_id", "status");
CREATE INDEX "holiday_calendar_versions_effective_idx"
  ON "holiday_calendar_versions" ("agency_id", "effective_from");

CREATE TABLE "holiday_calendar_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "holiday_calendar_version_id" UUID NOT NULL,
  "holiday_date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "day_type" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "holiday_calendar_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holiday_calendar_entries_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "holiday_calendar_entries_day_type_check" CHECK (
    "day_type" IN (
      'REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING', 'SPECIAL_WORKING',
      'LOCAL_HOLIDAY', 'WORK_SUSPENSION'
    )
  ),
  CONSTRAINT "holiday_calendar_entries_source_reference_check" CHECK (
    length(btrim("source_reference")) > 0
  ),
  CONSTRAINT "holiday_calendar_entries_version_fkey" FOREIGN KEY ("agency_id", "holiday_calendar_version_id")
    REFERENCES "holiday_calendar_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "holiday_calendar_entries_date_type_key" UNIQUE (
    "holiday_calendar_version_id", "holiday_date", "day_type"
  ),
  CONSTRAINT "holiday_calendar_entries_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "holiday_calendar_entries_date_idx"
  ON "holiday_calendar_entries" ("agency_id", "holiday_calendar_version_id", "holiday_date");

CREATE TABLE "schedule_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "work_schedule_version_id" UUID NOT NULL,
  "work_arrangement_version_id" UUID NOT NULL,
  "authority_document_version_id" UUID NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "assigned_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "schedule_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_assignments_effective_period_check" CHECK (
    "effective_to" IS NULL OR "effective_to" >= "effective_from"
  ),
  CONSTRAINT "schedule_assignments_employee_fkey" FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "schedule_assignments_schedule_version_fkey" FOREIGN KEY ("agency_id", "work_schedule_version_id")
    REFERENCES "work_schedule_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "schedule_assignments_arrangement_version_fkey" FOREIGN KEY ("agency_id", "work_arrangement_version_id")
    REFERENCES "work_arrangement_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "schedule_assignments_authority_fkey" FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "schedule_assignments_assigner_fkey" FOREIGN KEY ("agency_id", "assigned_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "schedule_assignments_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "schedule_assignments"
  ADD CONSTRAINT "schedule_assignments_effective_excl"
  EXCLUDE USING gist (
    "agency_id" WITH =,
    "employee_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  );

CREATE INDEX "schedule_assignments_employee_effective_idx"
  ON "schedule_assignments" ("agency_id", "employee_id", "effective_from");

CREATE OR REPLACE FUNCTION guard_holiday_calendar_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Holiday Calendars are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."current_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Holiday Calendars are created without a current version'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."scope_type" IS DISTINCT FROM OLD."scope_type"
    OR NEW."scope_reference" IS DISTINCT FROM OLD."scope_reference"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Holiday Calendar identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."current_version_id" IS NOT NULL THEN
    SELECT v."status" INTO version_status
    FROM "holiday_calendar_versions" v
    WHERE v."agency_id" = NEW."agency_id"
      AND v."id" = NEW."current_version_id"
      AND v."holiday_calendar_id" = NEW."id";
    IF version_status IS NULL OR version_status = 'DRAFT' THEN
      RAISE EXCEPTION 'Holiday Calendar current version must be a published version of the same calendar'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_holiday_calendar_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.holiday_calendar_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Holiday Calendar version transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Holiday Calendar versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Holiday Calendar versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."holiday_calendar_id" IS DISTINCT FROM OLD."holiday_calendar_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Holiday Calendar version identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('app.holiday_calendar_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Holiday Calendar version transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."authority_document_version_id" IS NULL
      OR NEW."approving_authority" IS NULL
      OR NEW."activated_by_membership_id" IS NULL
      OR NEW."activated_at" IS NULL
      OR NEW."effective_to" IS NOT NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."holiday_calendar_id" IS DISTINCT FROM OLD."holiday_calendar_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Holiday Calendar activation must preserve the draft definition and carry authority evidence'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."effective_to" IS NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."holiday_calendar_id" IS DISTINCT FROM OLD."holiday_calendar_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."authority_document_version_id" IS DISTINCT FROM OLD."authority_document_version_id"
      OR NEW."approving_authority" IS DISTINCT FROM OLD."approving_authority"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."activated_by_membership_id" IS DISTINCT FROM OLD."activated_by_membership_id"
      OR NEW."activated_at" IS DISTINCT FROM OLD."activated_at"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Holiday Calendar supersession may only close the effective period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported Holiday Calendar version transition'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_holiday_calendar_entry_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  parent_status TEXT;
  parent_version_id UUID;
  parent_agency_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_version_id := OLD."holiday_calendar_version_id";
    parent_agency_id := OLD."agency_id";
  ELSE
    parent_version_id := NEW."holiday_calendar_version_id";
    parent_agency_id := NEW."agency_id";
  END IF;
  SELECT v."status" INTO parent_status
  FROM "holiday_calendar_versions" v
  WHERE v."agency_id" = parent_agency_id
    AND v."id" = parent_version_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Holiday Calendar entries may only change while the version is a draft'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."holiday_calendar_version_id" IS DISTINCT FROM OLD."holiday_calendar_version_id"
      OR NEW."holiday_date" IS DISTINCT FROM OLD."holiday_date"
      OR NEW."day_type" IS DISTINCT FROM OLD."day_type" THEN
      RAISE EXCEPTION 'Holiday Calendar entry identity is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_schedule_assignment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Schedule Assignments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF current_setting('app.schedule_assignment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Schedule Assignments require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."effective_to" IS NOT NULL THEN
      RAISE EXCEPTION 'A new Schedule Assignment is open-ended until it is explicitly ended'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."effective_to" IS NOT NULL THEN
    RAISE EXCEPTION 'Ended Schedule Assignments are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."effective_to" IS NULL THEN
    RAISE EXCEPTION 'An ended Schedule Assignment cannot be reopened'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."work_schedule_version_id" IS DISTINCT FROM OLD."work_schedule_version_id"
    OR NEW."work_arrangement_version_id" IS DISTINCT FROM OLD."work_arrangement_version_id"
    OR NEW."authority_document_version_id" IS DISTINCT FROM OLD."authority_document_version_id"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."assigned_by_membership_id" IS DISTINCT FROM OLD."assigned_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Ending a Schedule Assignment may only set the effective end date'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "holiday_calendar_versions_updated_at_trigger"
  BEFORE UPDATE ON "holiday_calendar_versions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "holiday_calendar_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "holiday_calendar_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_holiday_calendar_version_mutation();
CREATE TRIGGER "holiday_calendar_entries_updated_at_trigger"
  BEFORE UPDATE ON "holiday_calendar_entries"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "holiday_calendar_entries_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "holiday_calendar_entries"
  FOR EACH ROW EXECUTE FUNCTION guard_holiday_calendar_entry_mutation();
CREATE TRIGGER "schedule_assignments_updated_at_trigger"
  BEFORE UPDATE ON "schedule_assignments"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "schedule_assignments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "schedule_assignments"
  FOR EACH ROW EXECUTE FUNCTION guard_schedule_assignment_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "holiday_calendar_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "holiday_calendar_entries" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "schedule_assignments" TO hris_app;

ALTER TABLE "holiday_calendar_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holiday_calendar_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "holiday_calendar_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holiday_calendar_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "schedule_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "holiday_calendar_versions_select" ON "holiday_calendar_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendar_versions_insert" ON "holiday_calendar_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendar_versions_update" ON "holiday_calendar_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendar_entries_select" ON "holiday_calendar_entries"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendar_entries_insert" ON "holiday_calendar_entries"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendar_entries_update" ON "holiday_calendar_entries"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "holiday_calendar_entries_delete" ON "holiday_calendar_entries"
  FOR DELETE USING ("agency_id" = app_agency_id());
CREATE POLICY "schedule_assignments_select" ON "schedule_assignments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "schedule_assignments_insert" ON "schedule_assignments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "schedule_assignments_update" ON "schedule_assignments"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('attendance.assignments.manage', 'attendance', 'HIGH', 'Maintain Schedule Assignments binding Appointed Personnel to active Work Schedule and Work Arrangement versions')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.assignments.manage'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
