-- Extend the Leave Monetization status machines with the Approval RETURN
-- outcomes: a returned request version needs information, and a returned
-- adjustment returns to draft for rework.

CREATE OR REPLACE FUNCTION guard_leave_monetization_request_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Monetization Requests are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Leave Monetization Request identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IS DISTINCT FROM NEW."status" THEN
    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED','CANCELLED'))
      OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('CREDIT_CERTIFIED','NEEDS_INFORMATION','WITHDRAWN'))
      OR (OLD."status" = 'CREDIT_CERTIFIED' AND NEW."status" IN ('FOR_APPROVAL','NEEDS_INFORMATION','WITHDRAWN'))
      OR (OLD."status" = 'NEEDS_INFORMATION' AND NEW."status" IN ('SUBMITTED','WITHDRAWN'))
      OR (OLD."status" = 'FOR_APPROVAL' AND NEW."status" IN ('APPROVED','REJECTED','NEEDS_INFORMATION','WITHDRAWN'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('POSTED','CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'Invalid Leave Monetization Request transition from % to %',
        OLD."status", NEW."status"
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_monetization_adjustment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Monetization Adjustments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."monetization_posting_id" IS DISTINCT FROM NEW."monetization_posting_id"
    OR OLD."scope" IS DISTINCT FROM NEW."scope"
    OR OLD."reason" IS DISTINCT FROM NEW."reason"
    OR OLD."approval_route_version_id" IS DISTINCT FROM NEW."approval_route_version_id"
    OR OLD."approval_request_id" IS DISTINCT FROM NEW."approval_request_id" THEN
    RAISE EXCEPTION 'Monetization Adjustment identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IS DISTINCT FROM NEW."status" THEN
    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('FOR_APPROVAL','REJECTED'))
      OR (OLD."status" = 'FOR_APPROVAL' AND NEW."status" IN ('APPROVED','REJECTED','BLOCKED','RETRYABLE','DRAFT'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('APPLIED','BLOCKED','RETRYABLE'))
      OR (OLD."status" = 'RETRYABLE' AND NEW."status" IN ('APPLIED','BLOCKED'))
    ) THEN
      RAISE EXCEPTION 'Invalid Monetization Adjustment transition from % to %',
        OLD."status", NEW."status"
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
