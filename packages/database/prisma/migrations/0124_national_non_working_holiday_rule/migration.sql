-- One fixed national Non-Working Holiday rule decides expected duty on Holiday
-- Calendar dates (ADR 0006, #487). Work Schedule Versions no longer carry
-- holiday effects, and a Holiday Calendar Version holds one classification per
-- date. Stored Attendance Day snapshots are history and are not rewritten.

-- An existing duplicate is resolved through a successor calendar version, not
-- deduplicated here. FORCE ROW LEVEL SECURITY binds the owner too, so lift it
-- for the read; the check and the new key run in this migration's transaction.
ALTER TABLE "holiday_calendar_entries" NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  duplicates TEXT;
BEGIN
  SELECT string_agg(
      format('version %s on %s', "holiday_calendar_version_id", "holiday_date"),
      '; ' ORDER BY "holiday_calendar_version_id", "holiday_date"
    )
  INTO duplicates
  FROM (
    SELECT "holiday_calendar_version_id", "holiday_date"
    FROM "holiday_calendar_entries"
    GROUP BY "holiday_calendar_version_id", "holiday_date"
    HAVING count(*) > 1
  ) repeated;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Holiday Calendar Versions hold more than one classification on a date: %. Record a successor calendar version with one classification per date, then rerun the migration.',
      duplicates
      USING ERRCODE = '23505';
  END IF;
END;
$$;

ALTER TABLE "holiday_calendar_entries" FORCE ROW LEVEL SECURITY;

ALTER TABLE "holiday_calendar_entries"
  DROP CONSTRAINT "holiday_calendar_entries_date_type_key",
  ADD CONSTRAINT "holiday_calendar_entries_version_date_key" UNIQUE (
    "holiday_calendar_version_id", "holiday_date"
  );

-- The version guard compared the dropped column; redefine it without it.
CREATE OR REPLACE FUNCTION guard_work_schedule_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      AND current_setting('app.work_schedule_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Work Schedule version transitions require the application service'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Work Schedule versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Work Schedule versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_schedule_id" IS DISTINCT FROM OLD."work_schedule_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Draft Work Schedule version identity is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('app.work_schedule_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Work Schedule version transitions require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ACTIVE' THEN
    IF NEW."authority_document_version_id" IS NULL
      OR NEW."approving_authority" IS NULL
      OR NEW."activated_by_membership_id" IS NULL
      OR NEW."activated_at" IS NULL
      OR NEW."effective_to" IS NOT NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_schedule_id" IS DISTINCT FROM OLD."work_schedule_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."schedule_type" IS DISTINCT FROM OLD."schedule_type"
      OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Work Schedule activation must preserve the draft definition and carry authority evidence'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF NEW."effective_to" IS NULL
      OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."work_schedule_id" IS DISTINCT FROM OLD."work_schedule_id"
      OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
      OR NEW."schedule_type" IS DISTINCT FROM OLD."schedule_type"
      OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
      OR NEW."authority_document_version_id" IS DISTINCT FROM OLD."authority_document_version_id"
      OR NEW."approving_authority" IS DISTINCT FROM OLD."approving_authority"
      OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
      OR NEW."activated_by_membership_id" IS DISTINCT FROM OLD."activated_by_membership_id"
      OR NEW."activated_at" IS DISTINCT FROM OLD."activated_at"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Work Schedule supersession may only close the effective period'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported Work Schedule version transition'
    USING ERRCODE = '55000';
END;
$$;

ALTER TABLE "work_schedule_versions"
  DROP CONSTRAINT "work_schedule_versions_holiday_effect_rules_check",
  DROP COLUMN "holiday_effect_rules";
