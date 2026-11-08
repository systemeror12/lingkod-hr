-- Tighten the 0129 Overtime Authority guards (#532 review). An APPROVED
-- authority's status may only stay APPROVED or move to CANCELLED, so it can
-- never return to an editable status. The write-once eligibility snapshot is
-- filled only while the authority is FOR_REVIEW, which is when approval writes
-- it, before the authority moves to APPROVED in the same transaction.
CREATE OR REPLACE FUNCTION guard_overtime_authority_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'overtime_authorities records cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % Overtime Authority is final', OLD."status"
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."requesting_unit_id" IS DISTINCT FROM OLD."requesting_unit_id"
    OR NEW."authority_no" IS DISTINCT FROM OLD."authority_no"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."work_date_from" IS DISTINCT FROM OLD."work_date_from"
    OR NEW."work_date_to" IS DISTINCT FROM OLD."work_date_to"
    OR NEW."funding_reference" IS DISTINCT FROM OLD."funding_reference"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Only a DRAFT Overtime Authority can be edited'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'APPROVED' AND (
    NEW."compensation_method" IS DISTINCT FROM OLD."compensation_method"
    OR NEW."approved_by_membership_id" IS DISTINCT FROM OLD."approved_by_membership_id"
    OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
  ) THEN
    RAISE EXCEPTION 'An APPROVED Overtime Authority is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'An APPROVED Overtime Authority can only be cancelled'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_overtime_authority_employee_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  authority_status TEXT;
BEGIN
  SELECT "status" INTO authority_status
  FROM "overtime_authorities"
  WHERE "id" = CASE WHEN TG_OP = 'INSERT' THEN NEW."overtime_authority_id"
                    ELSE OLD."overtime_authority_id" END;

  IF TG_OP = 'UPDATE'
    AND authority_status = 'FOR_REVIEW'
    AND OLD."eligibility_snapshot" IS NULL
    AND NEW."eligibility_snapshot" IS NOT NULL
    AND NEW."agency_id" = OLD."agency_id"
    AND NEW."overtime_authority_id" = OLD."overtime_authority_id"
    AND NEW."employee_id" = OLD."employee_id"
    AND NEW."authorized_hours" = OLD."authorized_hours"
    AND NEW."task_description" IS NOT DISTINCT FROM OLD."task_description"
  THEN
    RETURN NEW;
  END IF;

  IF authority_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Covered Employees change only while the Overtime Authority is a DRAFT'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."overtime_authority_id" IS DISTINCT FROM OLD."overtime_authority_id"
    OR NEW."eligibility_snapshot" IS DISTINCT FROM OLD."eligibility_snapshot"
  ) THEN
    RAISE EXCEPTION 'A covered Employee cannot move authority or rewrite its snapshot'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
