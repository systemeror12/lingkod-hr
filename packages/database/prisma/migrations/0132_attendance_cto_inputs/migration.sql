-- Phase 8 Attendance-owned CTO input (ADR 0009). CTO Request approval hands
-- Attendance one immutable input per Work Date: the whole Work Date's expected
-- duty or a timed interval. Attendance Day calculation places current inputs
-- as CTO coverage, which is paid time with no deficit and publishes as its own
-- Attendance Payroll Fact classification. A successor input supersedes its
-- predecessor without editing it; a NONE successor withdraws coverage, and
-- only an input with no successor is current.

CREATE TABLE "attendance_cto_inputs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "source_key" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "coverage_mode" TEXT NOT NULL,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "predecessor_input_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_cto_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_cto_inputs_source_key_check"
    CHECK (length(btrim("source_key")) > 0),
  CONSTRAINT "attendance_cto_inputs_source_type_check"
    CHECK (length(btrim("source_type")) > 0),
  CONSTRAINT "attendance_cto_inputs_coverage_mode_check"
    CHECK ("coverage_mode" IN ('WHOLE_WORK_DATE', 'TIMED', 'NONE')),
  CONSTRAINT "attendance_cto_inputs_coverage_check" CHECK (
    ("coverage_mode" = 'WHOLE_WORK_DATE' AND "starts_at" IS NULL AND "ends_at" IS NULL)
    OR ("coverage_mode" = 'TIMED' AND "ends_at" > "starts_at")
    OR ("coverage_mode" = 'NONE' AND "predecessor_input_id" IS NOT NULL
        AND "starts_at" IS NULL AND "ends_at" IS NULL)
  ),
  CONSTRAINT "attendance_cto_inputs_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_cto_inputs_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_cto_inputs_predecessor_fkey"
    FOREIGN KEY ("agency_id", "employee_id", "predecessor_input_id")
    REFERENCES "attendance_cto_inputs"("agency_id", "employee_id", "id")
    ON DELETE RESTRICT,
  CONSTRAINT "attendance_cto_inputs_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "attendance_cto_inputs_employee_id_key"
    UNIQUE ("agency_id", "employee_id", "id"),
  CONSTRAINT "attendance_cto_inputs_source_key_key"
    UNIQUE ("agency_id", "source_key"),
  CONSTRAINT "attendance_cto_inputs_predecessor_key"
    UNIQUE ("agency_id", "predecessor_input_id")
);

CREATE INDEX "attendance_cto_inputs_employee_work_date_idx"
  ON "attendance_cto_inputs" ("agency_id", "employee_id", "work_date");

CREATE OR REPLACE FUNCTION guard_attendance_cto_input_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Attendance CTO inputs are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance CTO inputs are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_cto_inputs_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_cto_inputs"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_cto_input_mutation();

GRANT SELECT, INSERT ON TABLE "attendance_cto_inputs" TO hris_app;

ALTER TABLE "attendance_cto_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_cto_inputs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attendance_cto_inputs_select" ON "attendance_cto_inputs"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_cto_inputs_insert" ON "attendance_cto_inputs"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- CTO coverage is its own segment and Attendance Payroll Fact classification.
ALTER TABLE "attendance_day_segments"
  DROP CONSTRAINT "attendance_day_segments_coverage_type_check",
  ADD CONSTRAINT "attendance_day_segments_coverage_type_check" CHECK (
    "coverage_type" IN (
      'WORKED', 'OFFICIAL_BUSINESS', 'OFFICIAL_TRAVEL', 'TRAINING',
      'APPROVED_ABSENCE', 'POSTED_LEAVE', 'CTO', 'UNCOVERED'
    )
  );

ALTER TABLE "attendance_payroll_facts"
  DROP CONSTRAINT "attendance_payroll_facts_type_check",
  ADD CONSTRAINT "attendance_payroll_facts_type_check" CHECK (
    "fact_type" IN (
      'EXPECTED','WORKED','OFFICIAL_BUSINESS','OFFICIAL_TRAVEL','TRAINING',
      'APPROVED_ABSENCE','POSTED_LEAVE','CTO','TARDINESS','UNDERTIME','ABSENCE'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_cto_inputs_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance CTO input immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'attendance_cto_inputs' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Attendance CTO input forced RLS verification failed';
  END IF;
END;
$$;
