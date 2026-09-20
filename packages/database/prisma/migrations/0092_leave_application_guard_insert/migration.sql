-- 0091 created retention guards for Leave Application Periods, Version
-- document links, Eligibility Assessments, and Calculation Segments. Those
-- functions raised on every operation because they never returned NEW for
-- INSERT, so the owning service could not record the immutable rows at all.
-- Recreate them to allow INSERT and keep the update/delete guarantees.

CREATE OR REPLACE FUNCTION guard_leave_application_period_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Application Periods are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Application Periods are retained and cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_application_version_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Application Version document links are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Application Version document links cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_eligibility_assessment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Eligibility Assessments are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Eligibility Assessments are retained and cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_calculation_segment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Calculation Segments are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Leave Calculation Segments are retained and cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;
