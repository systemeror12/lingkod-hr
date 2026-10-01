-- Applying a Leave Cancellation over posted leave hands Attendance a successor
-- posted-leave input. A whole-line cancellation retains nothing, so its
-- successor carries zero quantity: it withdraws the predecessor's coverage
-- without editing it. Only a successor may be zero.
ALTER TABLE "attendance_posted_leave_inputs"
  DROP CONSTRAINT "attendance_posted_leave_inputs_quantity_check",
  ADD CONSTRAINT "attendance_posted_leave_inputs_quantity_check"
    CHECK ("quantity" > 0 OR ("quantity" = 0 AND "predecessor_input_id" IS NOT NULL));

-- Every cancellation effect keeps the identifier issued by its owner and
-- cannot point at another Agency's, cancellation's, or source's record.
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
  RETURN NEW;
END;
$$;
