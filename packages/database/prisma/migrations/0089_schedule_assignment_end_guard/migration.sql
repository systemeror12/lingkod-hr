-- Correct the Schedule Assignment end guard introduced in 0088.
--
-- The 0088 guard checked `NEW.effective_to IS NULL` before the identity-field
-- comparison, so an attempt to change any identity field on an *open*
-- assignment reported "An ended Schedule Assignment cannot be reopened" instead
-- of the accurate "may only set the effective end date". Reorder the checks so
-- the message matches the rejected mutation. Ended rows are already covered by
-- the immutability branch above, so no separate reopen branch is needed.

CREATE OR REPLACE FUNCTION guard_schedule_assignment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Schedule Assignments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF current_setting('app.schedule_assignment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Schedule Assignments require the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."effective_to" IS NOT NULL THEN
      RAISE EXCEPTION 'A new Schedule Assignment is open-ended until it is explicitly ended'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."effective_to" IS NOT NULL THEN
    RAISE EXCEPTION 'Ended Schedule Assignments are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."effective_to" IS NULL
    OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."work_schedule_version_id" IS DISTINCT FROM OLD."work_schedule_version_id"
    OR NEW."work_arrangement_version_id" IS DISTINCT FROM OLD."work_arrangement_version_id"
    OR NEW."authority_document_version_id" IS DISTINCT FROM OLD."authority_document_version_id"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."assigned_by_membership_id" IS DISTINCT FROM OLD."assigned_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Ending a Schedule Assignment may only set the effective end date'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
