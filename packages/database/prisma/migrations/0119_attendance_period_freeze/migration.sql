-- Phase 7 stable Attendance Period freeze. The stable period's identity and
-- date bounds never change once created, so every Attendance Period Version,
-- Finalized Daily Time Record, and Attendance Payroll Publication keeps
-- referring to the interval it was built from. Status moves only from OPEN to
-- FINALIZED, and only through the Attendance application service's lock
-- transition. A finalized period never reopens.

CREATE OR REPLACE FUNCTION guard_attendance_period_update()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."date_from" IS DISTINCT FROM OLD."date_from"
    OR NEW."date_to" IS DISTINCT FROM OLD."date_to"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Attendance Period identity and date bounds are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'FINALIZED' THEN
      RAISE EXCEPTION 'A finalized Attendance Period never reopens'
        USING ERRCODE = '55000';
    END IF;
    IF current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Attendance Period finalization requires the owning application service'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_periods_update_trigger"
  BEFORE UPDATE ON "attendance_periods"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_period_update();
