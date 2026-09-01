-- Personnel Baselines adopt existing service facts. They never create an
-- Appointment, oath, assumption, or other appointment-issued record.

ALTER TABLE "employees"
  ADD COLUMN "first_government_service_date" DATE,
  ADD COLUMN "agency_service_start_date" DATE,
  ADD COLUMN "current_service_segment_id" UUID;

ALTER TABLE "employees"
  DROP CONSTRAINT "employees_service_status_check",
  ADD CONSTRAINT "employees_service_status_check"
    CHECK ("service_status" IN ('PREBOARDING', 'ACTIVE', 'ON_EXTENDED_LEAVE', 'SUSPENDED', 'SEPARATED', 'DECEASED')),
  ADD CONSTRAINT "employees_service_dates_check"
    CHECK (
      "first_government_service_date" IS NULL
      OR "agency_service_start_date" IS NULL
      OR "first_government_service_date" <= "agency_service_start_date"
    );

CREATE TABLE "service_segments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "appointment_id" UUID,
  "personnel_action_id" UUID,
  "position_id" UUID,
  "organization_unit_id" UUID NOT NULL,
  "segment_type" TEXT NOT NULL DEFAULT 'PRIMARY',
  "appointment_status" TEXT NOT NULL,
  "salary_grade" INTEGER,
  "salary_step" INTEGER,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_segments_status_check"
    CHECK ("status" IN ('ACTIVE', 'CLOSED', 'VOIDED')),
  CONSTRAINT "service_segments_type_check"
    CHECK ("segment_type" IN ('PRIMARY', 'SECONDARY')),
  CONSTRAINT "service_segments_appointment_status_check"
    CHECK (btrim("appointment_status") <> ''),
  CONSTRAINT "service_segments_salary_grade_check"
    CHECK ("salary_grade" IS NULL OR "salary_grade" BETWEEN 1 AND 33),
  CONSTRAINT "service_segments_salary_step_check"
    CHECK ("salary_step" IS NULL OR "salary_step" > 0),
  CONSTRAINT "service_segments_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "service_segments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "service_segments_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_segments_position_fkey"
    FOREIGN KEY ("agency_id", "position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_segments_organization_unit_fkey"
    FOREIGN KEY ("agency_id", "organization_unit_id")
    REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_segments_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_segments_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "service_segments"
  ADD CONSTRAINT "service_segments_primary_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "employee_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("segment_type" = 'PRIMARY' AND "status" <> 'VOIDED');

CREATE INDEX "service_segments_employee_effective_idx"
  ON "service_segments" ("agency_id", "employee_id", "effective_from");
CREATE INDEX "service_segments_position_effective_idx"
  ON "service_segments" ("agency_id", "position_id", "effective_from");

CREATE TABLE "position_incumbencies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "position_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "service_segment_id" UUID NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "status" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "position_incumbencies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "position_incumbencies_status_check"
    CHECK ("status" IN ('ACTIVE', 'ENDED', 'VOIDED')),
  CONSTRAINT "position_incumbencies_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "position_incumbencies_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "position_incumbencies_position_fkey"
    FOREIGN KEY ("agency_id", "position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "position_incumbencies_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "position_incumbencies_service_segment_fkey"
    FOREIGN KEY ("agency_id", "service_segment_id")
    REFERENCES "service_segments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "position_incumbencies_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "position_incumbencies_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "position_incumbencies_one_service_segment_key" UNIQUE ("agency_id", "service_segment_id")
);

ALTER TABLE "position_incumbencies"
  ADD CONSTRAINT "position_incumbencies_position_no_overlap"
  EXCLUDE USING GIST (
    "agency_id" WITH =,
    "position_id" WITH =,
    DATERANGE(
      "effective_from",
      COALESCE("effective_to" + 1, 'infinity'::DATE),
      '[)'
    ) WITH &&
  ) WHERE ("status" <> 'VOIDED');

CREATE INDEX "position_incumbencies_position_effective_idx"
  ON "position_incumbencies" ("agency_id", "position_id", "effective_from");

CREATE TABLE "personnel_baselines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "authority_document_id" UUID NOT NULL,
  "authority_evidence_version_id" UUID NOT NULL,
  "first_government_service_date" DATE NOT NULL,
  "agency_service_start_date" DATE NOT NULL,
  "organization_unit_id" UUID NOT NULL,
  "appointment_status" TEXT NOT NULL,
  "salary_grade" INTEGER,
  "salary_step" INTEGER,
  "position_id" UUID,
  "status" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewed_by_membership_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "effectuated_by_membership_id" UUID,
  "effectuated_at" TIMESTAMPTZ(6),
  "service_segment_id" UUID,
  "position_incumbency_id" UUID,
  "supersedes_baseline_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "personnel_baselines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personnel_baselines_status_check"
    CHECK ("status" IN ('DRAFT', 'FOR_REVIEW', 'APPROVED', 'RETURNED', 'REJECTED', 'EFFECTIVE', 'SUPERSEDED', 'VOIDED')),
  CONSTRAINT "personnel_baselines_dates_check"
    CHECK ("first_government_service_date" <= "agency_service_start_date"),
  CONSTRAINT "personnel_baselines_appointment_status_check"
    CHECK (btrim("appointment_status") <> ''),
  CONSTRAINT "personnel_baselines_reason_check"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "personnel_baselines_salary_grade_check"
    CHECK ("salary_grade" IS NULL OR "salary_grade" BETWEEN 1 AND 33),
  CONSTRAINT "personnel_baselines_salary_step_check"
    CHECK ("salary_step" IS NULL OR "salary_step" > 0),
  CONSTRAINT "personnel_baselines_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_authority_document_fkey"
    FOREIGN KEY ("agency_id", "authority_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_authority_evidence_version_fkey"
    FOREIGN KEY ("agency_id", "authority_document_id", "authority_evidence_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_organization_unit_fkey"
    FOREIGN KEY ("agency_id", "organization_unit_id")
    REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_position_fkey"
    FOREIGN KEY ("agency_id", "position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_reviewer_fkey"
    FOREIGN KEY ("agency_id", "reviewed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_effectuator_fkey"
    FOREIGN KEY ("agency_id", "effectuated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_baseline_id")
    REFERENCES "personnel_baselines"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_baselines_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "personnel_baselines_employee_date_key" UNIQUE ("agency_id", "employee_id", "agency_service_start_date", "status"),
  CONSTRAINT "personnel_baselines_service_segment_key" UNIQUE ("agency_id", "service_segment_id"),
  CONSTRAINT "personnel_baselines_position_incumbency_key" UNIQUE ("agency_id", "position_incumbency_id")
);

ALTER TABLE "personnel_baselines"
  ADD CONSTRAINT "personnel_baselines_service_segment_fkey"
  FOREIGN KEY ("agency_id", "service_segment_id")
  REFERENCES "service_segments"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "personnel_baselines_position_incumbency_fkey"
  FOREIGN KEY ("agency_id", "position_incumbency_id")
  REFERENCES "position_incumbencies"("agency_id", "id") ON DELETE RESTRICT;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_current_service_segment_fkey"
  FOREIGN KEY ("agency_id", "current_service_segment_id")
  REFERENCES "service_segments"("agency_id", "id") ON DELETE RESTRICT;

CREATE INDEX "personnel_baselines_status_created_idx"
  ON "personnel_baselines" ("agency_id", "status", "created_at" DESC);
CREATE INDEX "personnel_baselines_employee_date_idx"
  ON "personnel_baselines" ("agency_id", "employee_id", "agency_service_start_date");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT "outbox_events_event_type_check"
    CHECK (btrim("event_type") <> ''),
  CONSTRAINT "outbox_events_aggregate_type_check"
    CHECK (btrim("aggregate_type") <> ''),
  CONSTRAINT "outbox_events_idempotency_key_check"
    CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "outbox_events_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "outbox_events_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "outbox_events_idempotency_key"
    UNIQUE ("agency_id", "event_type", "aggregate_type", "aggregate_id", "idempotency_key")
);

CREATE INDEX "outbox_events_status_created_idx"
  ON "outbox_events" ("agency_id", "status", "created_at");

CREATE OR REPLACE FUNCTION set_personnel_baseline_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_employee_service_projection()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      OLD."service_status" IS DISTINCT FROM NEW."service_status"
      OR OLD."first_government_service_date" IS DISTINCT FROM NEW."first_government_service_date"
      OR OLD."agency_service_start_date" IS DISTINCT FROM NEW."agency_service_start_date"
      OR OLD."current_service_segment_id" IS DISTINCT FROM NEW."current_service_segment_id"
    )
    AND current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Employee service projections require the Personnel Baseline application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_personnel_baseline_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Personnel Baselines require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Personnel Baselines are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."authority_document_id" IS DISTINCT FROM NEW."authority_document_id"
    OR OLD."authority_evidence_version_id" IS DISTINCT FROM NEW."authority_evidence_version_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Personnel Baseline identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Personnel Baseline changes require the application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_service_segment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Service Segments require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Service Segments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'Voided Service Segments are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."appointment_id" IS DISTINCT FROM NEW."appointment_id"
    OR OLD."personnel_action_id" IS DISTINCT FROM NEW."personnel_action_id"
    OR OLD."position_id" IS DISTINCT FROM NEW."position_id"
    OR OLD."organization_unit_id" IS DISTINCT FROM NEW."organization_unit_id"
    OR OLD."segment_type" IS DISTINCT FROM NEW."segment_type"
    OR OLD."appointment_status" IS DISTINCT FROM NEW."appointment_status"
    OR OLD."salary_grade" IS DISTINCT FROM NEW."salary_grade"
    OR OLD."salary_step" IS DISTINCT FROM NEW."salary_step"
    OR OLD."effective_from" IS DISTINCT FROM NEW."effective_from"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
    OR NEW."status" NOT IN ('CLOSED', 'VOIDED') THEN
    RAISE EXCEPTION 'Service Segment facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Service Segment changes require the application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_position_incumbency_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Position Incumbencies require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Position Incumbencies are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'Voided Position Incumbencies are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."position_id" IS DISTINCT FROM NEW."position_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."service_segment_id" IS DISTINCT FROM NEW."service_segment_id"
    OR OLD."effective_from" IS DISTINCT FROM NEW."effective_from"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
    OR NEW."status" NOT IN ('ENDED', 'VOIDED') THEN
    RAISE EXCEPTION 'Position Incumbency facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Position Incumbency changes require the application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_outbox_event_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Outbox Events require the application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "employees_service_projection_trigger"
  BEFORE UPDATE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION guard_employee_service_projection();
CREATE TRIGGER "personnel_baselines_updated_at_trigger"
  BEFORE UPDATE ON "personnel_baselines"
  FOR EACH ROW EXECUTE FUNCTION set_personnel_baseline_updated_at();
CREATE TRIGGER "personnel_baselines_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "personnel_baselines"
  FOR EACH ROW EXECUTE FUNCTION guard_personnel_baseline_mutation();
CREATE TRIGGER "service_segments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "service_segments"
  FOR EACH ROW EXECUTE FUNCTION guard_service_segment_mutation();
CREATE TRIGGER "position_incumbencies_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "position_incumbencies"
  FOR EACH ROW EXECUTE FUNCTION guard_position_incumbency_mutation();
CREATE TRIGGER "outbox_events_insert_trigger"
  BEFORE INSERT ON "outbox_events"
  FOR EACH ROW EXECUTE FUNCTION guard_outbox_event_insert();
CREATE TRIGGER "outbox_events_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "outbox_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "employees" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "service_segments" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "position_incumbencies" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "personnel_baselines" TO hris_app;
GRANT SELECT, INSERT ON TABLE "outbox_events" TO hris_app;

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_segments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "position_incumbencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "position_incumbencies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "personnel_baselines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personnel_baselines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_segments_select" ON "service_segments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "service_segments_insert" ON "service_segments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "service_segments_update" ON "service_segments"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "position_incumbencies_select" ON "position_incumbencies"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "position_incumbencies_insert" ON "position_incumbencies"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "position_incumbencies_update" ON "position_incumbencies"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "personnel_baselines_select" ON "personnel_baselines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "personnel_baselines_insert" ON "personnel_baselines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "personnel_baselines_update" ON "personnel_baselines"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "outbox_events_select" ON "outbox_events"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "outbox_events_insert" ON "outbox_events"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.baselines.read', 'personnel', 'MEDIUM', 'Read Personnel Baselines'),
  ('personnel.baselines.prepare', 'personnel', 'HIGH', 'Prepare Personnel Baselines'),
  ('personnel.baselines.review', 'personnel', 'HIGH', 'Review Personnel Baselines'),
  ('personnel.baselines.effectuate', 'personnel', 'HIGH', 'Effectuate Personnel Baselines'),
  ('personnel.baselines.audit.read', 'personnel', 'MEDIUM', 'Read Personnel Baseline history'),
  ('personnel.baselines.correct', 'personnel', 'HIGH', 'Prepare Personnel Baseline corrections')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.baselines.read',
  'personnel.baselines.prepare',
  'personnel.baselines.effectuate',
  'personnel.baselines.audit.read',
  'personnel.baselines.correct'
)
WHERE r."code" IN ('personnel_records_officer', 'agency_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.baselines.read',
  'personnel.baselines.prepare',
  'personnel.baselines.review',
  'personnel.baselines.effectuate',
  'personnel.baselines.audit.read',
  'personnel.baselines.correct'
)
WHERE r."code" = 'hrmo_administrator'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('personnel.baselines.read', 'personnel.baselines.audit.read')
WHERE r."code" = 'internal_auditor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'documents.evidence.read'
WHERE r."code" = 'personnel_records_officer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
