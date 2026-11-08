-- Phase 8 locked CTO cancellation (#549), as hris-controls §5.19 and
-- overtime-coc-cto-schema.md §5 leave it. A cancelled Work Date in a locked
-- Attendance Period hands Attendance a CTO_INPUT correction (0146) instead of
-- superseding its input. The date names that correction, so the request reads
-- Attendance's own status for it. The name is set once, with the cancellation.

ALTER TABLE "cto_request_dates"
  ADD COLUMN "attendance_correction_id" UUID,
  ADD CONSTRAINT "cto_request_dates_attendance_correction_fkey"
    FOREIGN KEY ("agency_id", "attendance_correction_id")
    REFERENCES "attendance_corrections"("agency_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "cto_request_dates_attendance_correction_key"
  ON "cto_request_dates" ("agency_id", "attendance_correction_id")
  WHERE "attendance_correction_id" IS NOT NULL;

-- Beside 0149's guard: a date names its correction only as it is cancelled, the
-- correction targets the date's own CTO input, and the name never changes.
CREATE OR REPLACE FUNCTION guard_cto_request_date_correction()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."attendance_correction_id" IS NOT NULL THEN
      RAISE EXCEPTION 'A new CTO Request date names no Attendance Correction'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."attendance_correction_id" IS DISTINCT FROM OLD."attendance_correction_id"
    AND (
      OLD."attendance_correction_id" IS NOT NULL
      OR OLD."cancelled_by_cto_cancellation_id" IS NOT NULL
      OR NEW."cancelled_by_cto_cancellation_id" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "attendance_corrections" c
        WHERE c."agency_id" = NEW."agency_id"
          AND c."id" = NEW."attendance_correction_id"
          AND c."target_type" = 'CTO_INPUT'
          AND c."target_id" = NEW."attendance_cto_input_id"
      )
    )
  THEN
    RAISE EXCEPTION 'A CTO Request date names the Attendance Correction of its own CTO input once, as it is cancelled'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cto_request_dates_correction_trigger"
  BEFORE INSERT OR UPDATE ON "cto_request_dates"
  FOR EACH ROW EXECUTE FUNCTION guard_cto_request_date_correction();
