-- Phase 7 Attendance Period lock and Attendance Payroll Publications.
--
-- An Attendance Period Lock creates exactly one immutable Attendance Payroll
-- Publication per locked Attendance Period Version. An original publication
-- carries every exact nonnegative minute fact of the locked version; an
-- adjustment publication identifies its predecessor and carries only changed
-- facts with prior, corrected, and nonnegative directional difference values.
-- Neither table stores a rate, money, deduction decision, or target payroll
-- period, and both are append-only.

CREATE TABLE "attendance_payroll_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_period_version_id" UUID NOT NULL,
  "predecessor_publication_id" UUID,
  "publication_type" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "published_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "attendance_payroll_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_payroll_publications_type_check" CHECK (
    "publication_type" IN ('ORIGINAL', 'ADJUSTMENT')
  ),
  CONSTRAINT "attendance_payroll_publications_predecessor_check" CHECK (
    ("publication_type" = 'ORIGINAL' AND "predecessor_publication_id" IS NULL)
    OR ("publication_type" = 'ADJUSTMENT' AND "predecessor_publication_id" IS NOT NULL)
  ),
  CONSTRAINT "attendance_payroll_publications_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_payroll_publications_version_fkey" FOREIGN KEY ("agency_id", "attendance_period_version_id")
    REFERENCES "attendance_period_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_payroll_publications_predecessor_fkey" FOREIGN KEY ("agency_id", "predecessor_publication_id")
    REFERENCES "attendance_payroll_publications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_payroll_publications_version_key" UNIQUE ("attendance_period_version_id"),
  CONSTRAINT "attendance_payroll_publications_idempotency_key" UNIQUE ("agency_id", "idempotency_key"),
  CONSTRAINT "attendance_payroll_publications_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "attendance_payroll_facts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_payroll_publication_id" UUID NOT NULL,
  "attendance_day_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "fact_type" TEXT NOT NULL,
  "holiday_classification" TEXT,
  "stable_source_key" TEXT NOT NULL,
  "corrected_minutes" INTEGER NOT NULL,
  "prior_minutes" INTEGER,
  "difference_direction" TEXT,
  "difference_minutes" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_payroll_facts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_payroll_facts_type_check" CHECK (
    "fact_type" IN (
      'EXPECTED','WORKED','OFFICIAL_BUSINESS','OFFICIAL_TRAVEL','TRAINING',
      'APPROVED_ABSENCE','POSTED_LEAVE','TARDINESS','UNDERTIME','ABSENCE'
    )
  ),
  CONSTRAINT "attendance_payroll_facts_difference_check" CHECK (
    "difference_direction" IS NULL
    OR "difference_direction" IN ('INCREASE', 'DECREASE')
  ),
  CONSTRAINT "attendance_payroll_facts_corrected_check" CHECK ("corrected_minutes" >= 0),
  CONSTRAINT "attendance_payroll_facts_prior_check" CHECK (
    "prior_minutes" IS NULL OR "prior_minutes" >= 0
  ),
  CONSTRAINT "attendance_payroll_facts_difference_minutes_check" CHECK (
    "difference_minutes" IS NULL OR "difference_minutes" >= 0
  ),
  CONSTRAINT "attendance_payroll_facts_delta_check" CHECK (
    ("prior_minutes" IS NULL AND "difference_direction" IS NULL AND "difference_minutes" IS NULL)
    OR (
      "prior_minutes" IS NOT NULL
      AND "difference_direction" IS NOT NULL
      AND "difference_minutes" IS NOT NULL
    )
  ),
  CONSTRAINT "attendance_payroll_facts_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_payroll_facts_publication_fkey" FOREIGN KEY ("agency_id", "attendance_payroll_publication_id")
    REFERENCES "attendance_payroll_publications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_payroll_facts_day_fkey" FOREIGN KEY ("agency_id", "attendance_day_id")
    REFERENCES "attendance_days"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_payroll_facts_employee_fkey" FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_payroll_facts_line_key" UNIQUE ("attendance_payroll_publication_id", "stable_source_key"),
  CONSTRAINT "attendance_payroll_facts_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_payroll_facts_employee_idx"
  ON "attendance_payroll_facts" ("agency_id", "employee_id", "work_date");
CREATE INDEX "attendance_payroll_facts_day_idx"
  ON "attendance_payroll_facts" ("agency_id", "attendance_day_id");

-- Attendance Period Lock appends Outbox Events through the Attendance
-- application service capability, exactly like Personnel owns its own events.
CREATE OR REPLACE FUNCTION guard_outbox_event_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Outbox Events require an owning application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_attendance_payroll_publication_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Attendance Payroll Publications are retained and immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_payroll_publications_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_payroll_publications"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_payroll_publication_mutation();

CREATE OR REPLACE FUNCTION guard_attendance_payroll_fact_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Attendance Payroll Facts are retained and immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_payroll_facts_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_payroll_facts"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_payroll_fact_mutation();

GRANT SELECT, INSERT ON TABLE "attendance_payroll_publications" TO hris_app;
GRANT SELECT, INSERT ON TABLE "attendance_payroll_facts" TO hris_app;

ALTER TABLE "attendance_payroll_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_payroll_publications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_payroll_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_payroll_facts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attendance_payroll_publications_select" ON "attendance_payroll_publications"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_payroll_publications_insert" ON "attendance_payroll_publications"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_payroll_facts_select" ON "attendance_payroll_facts"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_payroll_facts_insert" ON "attendance_payroll_facts"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  (
    'attendance.periods.submit',
    'attendance',
    'HIGH',
    'Create an immutable Attendance Period Version from the complete applicable population and its approved Employee Attendance Submissions'
  ),
  (
    'attendance.periods.return',
    'attendance',
    'HIGH',
    'Return an Attendance Period Version under review with a reason'
  ),
  (
    'attendance.periods.approve',
    'attendance',
    'CRITICAL',
    'Approve an Attendance Period Version whose snapshot and routed authority are unchanged'
  ),
  (
    'attendance.periods.lock',
    'attendance',
    'CRITICAL',
    'Lock an approved Attendance Period Version as a different HR Administrator and publish its payroll inputs'
  ),
  (
    'attendance.payroll_publications.read',
    'attendance',
    'MEDIUM',
    'Read the non-monetary Attendance Payroll Publication and its exact minute facts within scope'
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.periods.submit',
  'attendance.periods.return',
  'attendance.periods.approve',
  'attendance.periods.lock',
  'attendance.payroll_publications.read'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'ASSIGNED_OFFICE'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.periods.return',
  'attendance.periods.approve',
  'attendance.payroll_publications.read'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('attendance.payroll_publications.read')
WHERE r."code" IN ('payroll_preparer', 'internal_auditor') AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.periods.lock'
  ) OR NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.periods.submit'
  ) THEN
    RAISE EXCEPTION 'Attendance Period permissions were not seeded';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator'
      AND r."agency_id" IS NULL
      AND p."code" = 'attendance.periods.lock'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'The HR Administrator Attendance Period lock grant is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'personnel_records_officer'
      AND r."agency_id" IS NULL
      AND p."code" = 'attendance.periods.approve'
      AND rp."scope_policy" = 'ASSIGNED_OFFICE'
  ) THEN
    RAISE EXCEPTION 'The HR Officer Attendance Period review grant is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'payroll_preparer'
      AND r."agency_id" IS NULL
      AND p."code" = 'attendance.payroll_publications.read'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'The Payroll Preparer Attendance Payroll Publication grant is missing';
  END IF;
END;
$$;
