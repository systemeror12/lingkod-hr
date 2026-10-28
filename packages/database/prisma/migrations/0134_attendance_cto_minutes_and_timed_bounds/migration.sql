-- A TIMED CTO input must carry both bounds: `ends_at > starts_at` alone is
-- NULL, so the CHECK passed a row with a missing bound.
ALTER TABLE "attendance_cto_inputs"
  DROP CONSTRAINT "attendance_cto_inputs_coverage_check",
  ADD CONSTRAINT "attendance_cto_inputs_coverage_check" CHECK (
    ("coverage_mode" = 'WHOLE_WORK_DATE' AND "starts_at" IS NULL AND "ends_at" IS NULL)
    OR ("coverage_mode" = 'TIMED' AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL
        AND "ends_at" > "starts_at")
    OR ("coverage_mode" = 'NONE' AND "predecessor_input_id" IS NOT NULL
        AND "starts_at" IS NULL AND "ends_at" IS NULL)
  );

-- CTO minutes are stored on the Attendance Day like posted leave, so period
-- lock reconciliation can compare published CTO facts with the Day total.
ALTER TABLE "attendance_days"
  ADD COLUMN "cto_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "attendance_days_cto_minutes_check" CHECK ("cto_minutes" >= 0);
