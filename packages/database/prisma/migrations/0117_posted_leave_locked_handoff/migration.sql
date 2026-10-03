-- Cancelling posted leave over a locked Work Date hands Attendance a
-- POSTED_LEAVE_INPUT correction. The approved Leave Cancellation is its
-- factual basis, so it enters FOR_AUTHORIZATION and waits for a different HR
-- Administrator to authorize the Locked Attendance Adjustment or record why
-- it is blocked.
ALTER TABLE "attendance_corrections"
  DROP CONSTRAINT "attendance_corrections_target_type_check",
  ADD CONSTRAINT "attendance_corrections_target_type_check" CHECK (
    "target_type" IN ('ATTENDANCE_EVENT', 'ATTENDANCE_CONTEXT', 'POSTED_LEAVE_INPUT')
  ),
  -- The Leave Cancellation requester and approvers named by Leave. None may
  -- authorize the correction that carries their own decision.
  ADD COLUMN "excluded_decider_membership_ids" UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN "blocking_reason" TEXT,
  ADD COLUMN "blocked_by_membership_id" UUID,
  ADD COLUMN "blocked_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "attendance_corrections_blocker_fkey"
    FOREIGN KEY ("agency_id", "blocked_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_corrections_blocking_check" CHECK (
    ("blocking_reason" IS NULL AND "blocked_by_membership_id" IS NULL AND "blocked_at" IS NULL)
    OR (
      "target_type" = 'POSTED_LEAVE_INPUT'
      AND btrim("blocking_reason") <> ''
      AND "blocked_by_membership_id" IS NOT NULL
      AND "blocked_at" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "attendance_corrections_posted_leave_check" CHECK (
    "target_type" <> 'POSTED_LEAVE_INPUT'
    OR ("requested_action" IN ('REPLACE', 'VOID') AND "decided_by_membership_id" IS NOT NULL)
  );

ALTER TABLE "attendance_correction_effects"
  DROP CONSTRAINT "attendance_correction_effects_target_type_check",
  ADD CONSTRAINT "attendance_correction_effects_target_type_check" CHECK (
    "target_type" IN ('ATTENDANCE_EVENT', 'ATTENDANCE_CONTEXT', 'POSTED_LEAVE_INPUT')
  );

-- Only Leave's handoff creates a POSTED_LEAVE_INPUT correction, and it starts
-- at FOR_AUTHORIZATION against the Employee's own posted-leave input.
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_corrections_insert_trigger"
  BEFORE INSERT ON "attendance_corrections"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_correction_insert();

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

  -- A posted-leave correction records the preview it was authorized against,
  -- since earlier authorizations may have moved its locked versions forward.
  IF NEW."impact_preview" IS DISTINCT FROM OLD."impact_preview"
     AND OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
     AND NOT (
       NEW."target_type" = 'POSTED_LEAVE_INPUT'
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

-- A locked Attendance handoff is a Leave Cancellation effect that names the
-- accepted Attendance Correction while its authorization is still pending.
ALTER TABLE leave_cancellation_effects
  DROP CONSTRAINT leave_cancellation_effects_effect_kind_check,
  ADD CONSTRAINT leave_cancellation_effects_effect_kind_check CHECK (effect_kind IN (
    'COMMITMENT_RELEASE', 'LEDGER_REVERSAL', 'LEDGER_REPLACEMENT',
    'ATTENDANCE_CORRECTION', 'ATTENDANCE_LOCKED_CORRECTION', 'PAYROLL_CORRECTION'
  ));

CREATE OR REPLACE FUNCTION guard_leave_cancellation_effect_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.effect_kind = 'COMMITMENT_RELEASE' AND NOT EXISTS (
    SELECT 1 FROM leave_credit_commitments k
    JOIN leave_cancellations c ON c.agency_id = k.agency_id
      AND c.leave_application_version_id = k.source_id
    WHERE c.id = NEW.leave_cancellation_id AND c.agency_id = NEW.agency_id
      AND c.decision_status = 'APPROVED' AND c.effect_status IN ('PENDING', 'FAILED')
      AND k.id = NEW.owner_record_id AND k.source_type = 'LeaveApplicationVersion'
      AND k.status = 'RELEASED' AND NEW.owner_status = 'RELEASED'
  ) THEN
    RAISE EXCEPTION 'A commitment release effect must name the released commitment of its approved cancellation'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.effect_kind IN ('LEDGER_REVERSAL', 'LEDGER_REPLACEMENT') AND NOT EXISTS (
    SELECT 1 FROM leave_ledger_entries e
    WHERE e.agency_id = NEW.agency_id AND e.id = NEW.owner_record_id
      AND e.source_type = 'LeaveCancellation' AND e.source_id = NEW.leave_cancellation_id
      AND (e.reverses_entry_id IS NOT NULL) = (NEW.effect_kind = 'LEDGER_REVERSAL')
  ) THEN
    RAISE EXCEPTION 'A ledger effect must name a Leave Ledger Entry posted by its cancellation'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.effect_kind = 'ATTENDANCE_CORRECTION' AND NOT EXISTS (
    SELECT 1 FROM attendance_posted_leave_inputs i
    WHERE i.agency_id = NEW.agency_id AND i.id = NEW.owner_record_id
      AND i.source_type = 'LeaveCancellation' AND i.source_id = NEW.leave_cancellation_id
      AND i.predecessor_input_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'An Attendance effect must name the successor input created for its cancellation'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.effect_kind = 'ATTENDANCE_LOCKED_CORRECTION' AND NOT EXISTS (
    SELECT 1 FROM attendance_corrections ac
    JOIN attendance_correction_evidence ev ON ev.agency_id = ac.agency_id
      AND ev.attendance_correction_id = ac.id
    WHERE ac.agency_id = NEW.agency_id AND ac.id = NEW.owner_record_id
      AND ac.target_type = 'POSTED_LEAVE_INPUT' AND ac.status = 'FOR_AUTHORIZATION'
      AND ev.source_type = 'LeaveCancellation' AND ev.source_id = NEW.leave_cancellation_id
      AND NEW.owner_status = 'FOR_AUTHORIZATION'
  ) THEN
    RAISE EXCEPTION 'A locked Attendance effect must name the pending correction raised for its cancellation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_corrections_insert_trigger'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_corrections_blocking_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_corrections_posted_leave_check'
  ) THEN
    RAISE EXCEPTION 'Posted-leave Attendance handoff migration verification failed';
  END IF;
END;
$$;
