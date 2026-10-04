-- Phase 7 Attendance-owned posted-leave input. Leave Posting hands Attendance
-- one immutable input per posted allocation line: the exact date range, unit,
-- approved quantity, allocation kind, and Leave source reference. Attendance Day
-- calculation reads these inputs instead of the Leave Ledger, so leave without
-- pay and non-credit leave, which never touch the ledger, still reach
-- Attendance. A successor input supersedes its predecessor without editing it;
-- only an input with no successor is current.

CREATE TABLE "attendance_posted_leave_inputs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "source_key" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "unit_code" TEXT NOT NULL,
  "quantity" NUMERIC(12,4) NOT NULL,
  "allocation_kind" TEXT NOT NULL,
  "predecessor_input_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_posted_leave_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_posted_leave_inputs_source_key_check"
    CHECK (length(btrim("source_key")) > 0),
  CONSTRAINT "attendance_posted_leave_inputs_source_type_check"
    CHECK (length(btrim("source_type")) > 0),
  CONSTRAINT "attendance_posted_leave_inputs_range_check"
    CHECK ("date_to" >= "date_from"),
  CONSTRAINT "attendance_posted_leave_inputs_unit_check"
    CHECK ("unit_code" IN (
      'WORKING_DAY', 'CALENDAR_DAY', 'SCHEDULED_MINUTE', 'SOURCE_DEFINED'
    )),
  CONSTRAINT "attendance_posted_leave_inputs_quantity_check"
    CHECK ("quantity" > 0),
  CONSTRAINT "attendance_posted_leave_inputs_allocation_kind_check"
    CHECK ("allocation_kind" IN (
      'LEAVE_ACCOUNT', 'LEAVE_WITHOUT_PAY', 'NON_CREDIT'
    )),
  CONSTRAINT "attendance_posted_leave_inputs_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_posted_leave_inputs_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_posted_leave_inputs_predecessor_fkey"
    FOREIGN KEY ("agency_id", "employee_id", "predecessor_input_id")
    REFERENCES "attendance_posted_leave_inputs"("agency_id", "employee_id", "id")
    ON DELETE RESTRICT,
  CONSTRAINT "attendance_posted_leave_inputs_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "attendance_posted_leave_inputs_employee_id_key"
    UNIQUE ("agency_id", "employee_id", "id"),
  CONSTRAINT "attendance_posted_leave_inputs_source_key_key"
    UNIQUE ("agency_id", "source_key"),
  CONSTRAINT "attendance_posted_leave_inputs_predecessor_key"
    UNIQUE ("agency_id", "predecessor_input_id")
);

CREATE INDEX "attendance_posted_leave_inputs_employee_range_idx"
  ON "attendance_posted_leave_inputs" ("agency_id", "employee_id", "date_from", "date_to");

CREATE OR REPLACE FUNCTION guard_attendance_posted_leave_input_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Attendance posted-leave inputs are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance posted-leave inputs are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_posted_leave_inputs_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_posted_leave_inputs"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_posted_leave_input_mutation();

GRANT SELECT, INSERT ON TABLE "attendance_posted_leave_inputs" TO hris_app;

ALTER TABLE "attendance_posted_leave_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_posted_leave_inputs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attendance_posted_leave_inputs_select" ON "attendance_posted_leave_inputs"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_posted_leave_inputs_insert" ON "attendance_posted_leave_inputs"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_posted_leave_inputs_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance posted-leave input immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'attendance_posted_leave_inputs' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Attendance posted-leave input forced RLS verification failed';
  END IF;
END;
$$;
