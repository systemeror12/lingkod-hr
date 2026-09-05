ALTER TABLE "personnel_actions"
  DROP CONSTRAINT "personnel_actions_status_check",
  ADD CONSTRAINT "personnel_actions_status_check" CHECK ("status" IN (
    'DRAFT', 'FOR_REVIEW', 'FOR_APPROVAL', 'APPROVED', 'EFFECTIVE',
    'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'
  )),
  ADD COLUMN "effectuated_by_membership_id" UUID,
  ADD COLUMN "effectuated_at" TIMESTAMPTZ(6),
  ADD COLUMN "effectuation_key" TEXT,
  ADD CONSTRAINT "personnel_actions_effectuation_check" CHECK (
    ("effectuated_by_membership_id" IS NULL AND "effectuated_at" IS NULL AND "effectuation_key" IS NULL)
    OR ("status" = 'EFFECTIVE' AND "effectuated_by_membership_id" IS NOT NULL
      AND "effectuated_at" IS NOT NULL AND btrim("effectuation_key") <> '')
  ),
  ADD CONSTRAINT "personnel_actions_effectuator_fkey"
    FOREIGN KEY ("agency_id", "effectuated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "service_segments_personnel_action_key"
  ON "service_segments" ("agency_id", "personnel_action_id")
  WHERE "personnel_action_id" IS NOT NULL;

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
    AND current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Employee service projections require the Personnel application service'
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
    IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
      AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Service Segments require the Personnel application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Service Segments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'Voided Service Segments are immutable' USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'Service Segment facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Service Segment changes require the Personnel application service'
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
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Outbox Events require the Personnel application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_personnel_action_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Personnel Actions are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Personnel Action changes require the application service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."action_type" IS DISTINCT FROM NEW."action_type"
    OR OLD."prepared_by_membership_id" IS DISTINCT FROM NEW."prepared_by_membership_id"
    OR OLD."supersedes_action_id" IS DISTINCT FROM NEW."supersedes_action_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'Personnel Action identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('CANCELLED', 'SUPERSEDED', 'EFFECTIVE') THEN
    RAISE EXCEPTION 'Final Personnel Actions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'APPROVED'
    AND NEW."status" NOT IN ('APPROVED', 'CANCELLED', 'SUPERSEDED', 'EFFECTIVE') THEN
    RAISE EXCEPTION 'Approved Personnel Actions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'APPROVED' AND (
    OLD."effectuated_by_membership_id" IS DISTINCT FROM NEW."effectuated_by_membership_id"
    OR OLD."effectuated_at" IS DISTINCT FROM NEW."effectuated_at"
    OR OLD."effectuation_key" IS DISTINCT FROM NEW."effectuation_key"
  ) THEN
    RAISE EXCEPTION 'Personnel Action effectuation requires approval' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
