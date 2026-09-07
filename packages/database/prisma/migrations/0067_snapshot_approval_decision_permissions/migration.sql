ALTER TABLE "approval_steps"
  ADD COLUMN "approve_permission" CITEXT,
  ADD COLUMN "return_permission" CITEXT,
  ADD COLUMN "reject_permission" CITEXT;

UPDATE "approval_steps"
SET
  "approve_permission" = "required_permission",
  "return_permission" = "required_permission",
  "reject_permission" = "required_permission";

ALTER TABLE "approval_steps"
  ALTER COLUMN "approve_permission" SET NOT NULL,
  ALTER COLUMN "return_permission" SET NOT NULL,
  ALTER COLUMN "reject_permission" SET NOT NULL,
  ADD CONSTRAINT "approval_steps_approve_permission_fkey"
    FOREIGN KEY ("approve_permission") REFERENCES "permissions"("code") ON DELETE RESTRICT,
  ADD CONSTRAINT "approval_steps_return_permission_fkey"
    FOREIGN KEY ("return_permission") REFERENCES "permissions"("code") ON DELETE RESTRICT,
  ADD CONSTRAINT "approval_steps_reject_permission_fkey"
    FOREIGN KEY ("reject_permission") REFERENCES "permissions"("code") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION guard_approval_step_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approval Steps are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.approval_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Approval Step changes require the application service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."approval_request_id" IS DISTINCT FROM NEW."approval_request_id"
    OR OLD."step_no" IS DISTINCT FROM NEW."step_no"
    OR OLD."step_mode" IS DISTINCT FROM NEW."step_mode"
    OR OLD."required_permission" IS DISTINCT FROM NEW."required_permission"
    OR OLD."approve_permission" IS DISTINCT FROM NEW."approve_permission"
    OR OLD."return_permission" IS DISTINCT FROM NEW."return_permission"
    OR OLD."reject_permission" IS DISTINCT FROM NEW."reject_permission"
    OR OLD."assigned_membership_id" IS DISTINCT FROM NEW."assigned_membership_id"
    OR OLD."assigned_role_code" IS DISTINCT FROM NEW."assigned_role_code"
    OR OLD."requires_separate_review" IS DISTINCT FROM NEW."requires_separate_review" THEN
    RAISE EXCEPTION 'Approval Step snapshot facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('APPROVED', 'REJECTED', 'SKIPPED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Completed Approval Steps are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'PENDING' AND NEW."status" NOT IN ('ACTIVE', 'SKIPPED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Pending Approval Step has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Active Approval Step has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'RETURNED' AND NEW."status" NOT IN ('ACTIVE', 'SKIPPED') THEN
    RAISE EXCEPTION 'Returned Approval Step must be resumed, cancelled, or remain returned' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
