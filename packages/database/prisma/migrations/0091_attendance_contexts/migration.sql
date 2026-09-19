-- Phase 7 Attendance Context. An authorized HR Administrator records the
-- already-authorized official business, official travel, training, or approved
-- non-leave absence that covers a whole Work Date or an exact timed interval.
-- Attendance Context is an immutable factual input distinct from raw Attendance
-- Events, Work Arrangement, and Leave-owned posted coverage. It records the
-- recorder, reason, and prior-authorization evidence without adding a second
-- Attendance approval workflow. Attendance Correction is the only path that may
-- replace or void a context later.

CREATE TABLE "attendance_contexts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "context_type" TEXT NOT NULL,
  "coverage_mode" TEXT NOT NULL,
  "work_date" DATE,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "reason" TEXT NOT NULL,
  "source_type" TEXT,
  "source_id" UUID,
  "evidence_document_version_id" UUID,
  "entered_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_contexts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_contexts_context_type_check"
    CHECK ("context_type" IN (
      'OFFICIAL_BUSINESS', 'OFFICIAL_TRAVEL', 'TRAINING', 'APPROVED_ABSENCE'
    )),
  CONSTRAINT "attendance_contexts_coverage_mode_check"
    CHECK ("coverage_mode" IN ('WHOLE_WORK_DATE', 'TIMED')),
  CONSTRAINT "attendance_contexts_coverage_check"
    CHECK (
      (
        "coverage_mode" = 'WHOLE_WORK_DATE'
        AND "work_date" IS NOT NULL
        AND "starts_at" IS NULL
        AND "ends_at" IS NULL
      )
      OR (
        "coverage_mode" = 'TIMED'
        AND "work_date" IS NULL
        AND "starts_at" IS NOT NULL
        AND "ends_at" IS NOT NULL
        AND "ends_at" > "starts_at"
      )
    ),
  CONSTRAINT "attendance_contexts_reason_check"
    CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "attendance_contexts_source_check"
    CHECK (
      (
        "source_type" IS NOT NULL
        AND length(btrim("source_type")) > 0
        AND "source_id" IS NOT NULL
      )
      OR "evidence_document_version_id" IS NOT NULL
    ),
  CONSTRAINT "attendance_contexts_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_contexts_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_contexts_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_contexts_recorder_fkey"
    FOREIGN KEY ("agency_id", "entered_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_contexts_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_contexts_employee_work_date_idx"
  ON "attendance_contexts" ("agency_id", "employee_id", "work_date");
CREATE INDEX "attendance_contexts_employee_starts_idx"
  ON "attendance_contexts" ("agency_id", "employee_id", "starts_at");

CREATE OR REPLACE FUNCTION guard_attendance_context_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Attendance Contexts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance Contexts are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_contexts_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_contexts"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_context_mutation();

GRANT SELECT, INSERT ON TABLE "attendance_contexts" TO hris_app;

ALTER TABLE "attendance_contexts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_contexts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attendance_contexts_select" ON "attendance_contexts"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_contexts_insert" ON "attendance_contexts"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  (
    'attendance.contexts.create',
    'attendance',
    'HIGH',
    'Record official business, official travel, training, and approved non-leave absence Attendance Context'
  ),
  (
    'attendance.contexts.read',
    'attendance',
    'MEDIUM',
    'Read Attendance Context records'
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.contexts.create'
WHERE r."code" = 'hrmo_administrator'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.contexts.read'
WHERE r."code" IN (
  'hrmo_administrator',
  'personnel_records_officer',
  'payroll_preparer',
  'internal_auditor'
)
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'attendance.contexts.read'
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
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_contexts_coverage_check'
  ) THEN
    RAISE EXCEPTION 'Attendance Context coverage verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_contexts_source_check'
  ) THEN
    RAISE EXCEPTION 'Attendance Context prior-authorization verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_contexts_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance Context immutability verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'attendance.contexts.create') THEN
    RAISE EXCEPTION 'Attendance Context create permission verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'attendance.contexts.read') THEN
    RAISE EXCEPTION 'Attendance Context read permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator'
      AND p."code" = 'attendance.contexts.create'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'HR Administrator Attendance Context create grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee'
      AND p."code" = 'attendance.contexts.read'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'Employee Attendance Context read grant verification failed';
  END IF;
END;
$$;
