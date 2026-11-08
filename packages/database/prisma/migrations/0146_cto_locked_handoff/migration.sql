-- Cancelling CTO on a locked Work Date hands Attendance a CTO_INPUT correction,
-- with the same rules as POSTED_LEAVE_INPUT (0117). The approved CTO
-- cancellation is its factual basis, so it enters FOR_AUTHORIZATION and waits
-- for a different HR Administrator to authorize the Locked Attendance
-- Adjustment or record why it is blocked.
ALTER TABLE "attendance_corrections"
  DROP CONSTRAINT "attendance_corrections_target_type_check",
  ADD CONSTRAINT "attendance_corrections_target_type_check" CHECK (
    "target_type" IN ('ATTENDANCE_EVENT', 'ATTENDANCE_CONTEXT', 'POSTED_LEAVE_INPUT', 'CTO_INPUT')
  ),
  -- The stable key the COC module derives per cancelled Work Date, so a retry
  -- returns the same correction.
  ADD COLUMN "effect_key" TEXT,
  ADD CONSTRAINT "attendance_corrections_effect_key_key" UNIQUE ("agency_id", "effect_key"),
  DROP CONSTRAINT "attendance_corrections_blocking_check",
  ADD CONSTRAINT "attendance_corrections_blocking_check" CHECK (
    ("blocking_reason" IS NULL AND "blocked_by_membership_id" IS NULL AND "blocked_at" IS NULL)
    OR (
      "target_type" IN ('POSTED_LEAVE_INPUT', 'CTO_INPUT')
      AND btrim("blocking_reason") <> ''
      AND "blocked_by_membership_id" IS NOT NULL
      AND "blocked_at" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "attendance_corrections_cto_input_check" CHECK (
    ("target_type" = 'CTO_INPUT') = ("effect_key" IS NOT NULL)
    AND (
      "target_type" <> 'CTO_INPUT'
      OR (
        "requested_action" IN ('REPLACE', 'VOID')
        AND "decided_by_membership_id" IS NOT NULL
        AND btrim("effect_key") <> ''
      )
    )
  );

-- A CTO_INPUT correction can only stay pending or apply, and applying it
-- supersedes its target, so one CTO input is corrected at most once.
CREATE UNIQUE INDEX "attendance_corrections_cto_input_target_key"
  ON "attendance_corrections" ("agency_id", "target_id")
  WHERE "target_type" = 'CTO_INPUT';

ALTER TABLE "attendance_correction_effects"
  DROP CONSTRAINT "attendance_correction_effects_target_type_check",
  ADD CONSTRAINT "attendance_correction_effects_target_type_check" CHECK (
    "target_type" IN ('ATTENDANCE_EVENT', 'ATTENDANCE_CONTEXT', 'POSTED_LEAVE_INPUT', 'CTO_INPUT')
  );

-- Only a source module's handoff creates a POSTED_LEAVE_INPUT or CTO_INPUT
-- correction, and it starts at FOR_AUTHORIZATION against the Employee's own input.
CREATE OR REPLACE FUNCTION guard_attendance_correction_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NEW."target_type" = 'POSTED_LEAVE_INPUT' AND (
    NEW."status" <> 'FOR_AUTHORIZATION'
    OR NEW."blocking_reason" IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM "attendance_posted_leave_inputs" i
      WHERE i."agency_id" = NEW."agency_id" AND i."id" = NEW."target_id"
        AND i."employee_id" = NEW."employee_id"
    )
  ) THEN
    RAISE EXCEPTION 'A posted-leave Attendance Correction must start at FOR_AUTHORIZATION against the Employee''s posted-leave input'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."target_type" = 'CTO_INPUT' AND (
    NEW."status" <> 'FOR_AUTHORIZATION'
    OR NEW."blocking_reason" IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM "attendance_cto_inputs" i
      WHERE i."agency_id" = NEW."agency_id" AND i."id" = NEW."target_id"
        AND i."employee_id" = NEW."employee_id"
    )
  ) THEN
    RAISE EXCEPTION 'A CTO Attendance Correction must start at FOR_AUTHORIZATION against the Employee''s CTO input'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_attendance_correction_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance Corrections are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" <> OLD."agency_id"
     OR NEW."employee_id" <> OLD."employee_id"
     OR NEW."initiated_by_membership_id" <> OLD."initiated_by_membership_id"
     OR NEW."recorded_by_membership_id" <> OLD."recorded_by_membership_id"
     OR NEW."target_type" <> OLD."target_type"
     OR NEW."requested_action" <> OLD."requested_action"
     OR NEW."target_id" IS DISTINCT FROM OLD."target_id"
     OR NEW."reason" <> OLD."reason"
     OR NEW."excluded_decider_membership_ids" <> OLD."excluded_decider_membership_ids"
     OR NEW."effect_key" IS DISTINCT FROM OLD."effect_key"
     OR NEW."created_at" <> OLD."created_at"
  THEN
    RAISE EXCEPTION 'Attendance Correction facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."requested_record" IS DISTINCT FROM OLD."requested_record"
     AND OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
  THEN
    RAISE EXCEPTION 'The requested Attendance Correction fact is bound once submitted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."approval_route_version_id" IS DISTINCT FROM OLD."approval_route_version_id"
     AND OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
  THEN
    RAISE EXCEPTION 'The Attendance Correction Approval Route Version is bound once submitted'
      USING ERRCODE = '55000';
  END IF;

  -- A handed-off correction records the preview it was authorized against,
  -- since earlier authorizations may have moved its locked versions forward.
  IF NEW."impact_preview" IS DISTINCT FROM OLD."impact_preview"
     AND OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
     AND NOT (
       NEW."target_type" IN ('POSTED_LEAVE_INPUT', 'CTO_INPUT')
       AND OLD."status" = 'FOR_AUTHORIZATION'
       AND NEW."status" = 'APPLIED'
     )
  THEN
    RAISE EXCEPTION 'The Attendance Correction Impact Preview is bound once submitted'
      USING ERRCODE = '55000';
  END IF;

  -- A blocking reason is recorded only while authorization is pending, and it
  -- stays with the correction once authorized.
  IF (NEW."blocking_reason" IS DISTINCT FROM OLD."blocking_reason"
      OR NEW."blocked_by_membership_id" IS DISTINCT FROM OLD."blocked_by_membership_id"
      OR NEW."blocked_at" IS DISTINCT FROM OLD."blocked_at")
     AND NOT (OLD."status" = 'FOR_AUTHORIZATION' AND NEW."status" = 'FOR_AUTHORIZATION')
  THEN
    RAISE EXCEPTION 'An Attendance Correction blocking reason is recorded only while authorization is pending'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED', 'CANCELLED'))
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN (
      'NEEDS_INFORMATION', 'APPLIED', 'FOR_AUTHORIZATION', 'REJECTED', 'CANCELLED'
    ))
    OR (OLD."status" = 'NEEDS_INFORMATION' AND NEW."status" IN ('SUBMITTED', 'CANCELLED'))
    OR (OLD."status" = 'FOR_AUTHORIZATION' AND NEW."status" = 'APPLIED')
  ) THEN
    RAISE EXCEPTION 'Invalid Attendance Correction state transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_corrections_cto_input_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'attendance_corrections_cto_input_target_key'
  ) THEN
    RAISE EXCEPTION 'CTO Attendance handoff migration verification failed';
  END IF;
END;
$$;
