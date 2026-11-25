-- Phase 9 Leave cancellation through Payroll (#228). Applying a cancellation to
-- posted leave without pay asks Payroll to withdraw each Payroll Input the
-- posting produced, by a correction key equal to the effect key (#330 D11,
-- payroll-schema.md §4). Leave records Payroll's answer and never edits
-- payroll:
--
-- - `PAYROLL_CORRECTION` names the withdrawn input with owner status
--   `WITHDRAWN`, when Payroll cancelled it under the key, or `DEFERRED`, when a
--   finalized payroll consumed it and Payroll recorded the withdrawal in the
--   Payroll Adjustment that `payroll_adjustment_id` names (#650);
-- - `PAYROLL_REPLACEMENT` names the input Payroll accepted for a partial
--   cancellation's retained dates, which replaces the withdrawn one.
--
-- An adjustment can carry the corrections of several lines and cancellations
-- of one Employee, so it is a column, not an owner record.

ALTER TABLE leave_cancellation_effects ADD COLUMN payroll_adjustment_id uuid;

ALTER TABLE leave_cancellation_effects
  DROP CONSTRAINT leave_cancellation_effects_effect_kind_check,
  ADD CONSTRAINT leave_cancellation_effects_effect_kind_check CHECK (effect_kind IN (
    'COMMITMENT_RELEASE', 'LEDGER_REVERSAL', 'LEDGER_REPLACEMENT',
    'ATTENDANCE_CORRECTION', 'ATTENDANCE_LOCKED_CORRECTION',
    'PAYROLL_CORRECTION', 'PAYROLL_REPLACEMENT'
  )),
  ADD CONSTRAINT leave_cancellation_effects_payroll_adjustment_check CHECK (
    (payroll_adjustment_id IS NOT NULL)
      = (effect_kind = 'PAYROLL_CORRECTION' AND owner_status = 'DEFERRED')
  );

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
  -- Payroll's own record of the withdrawal carries the effect key.
  IF NEW.effect_kind = 'PAYROLL_CORRECTION' AND NOT EXISTS (
    SELECT 1 FROM payroll_inputs i
    WHERE i.agency_id = NEW.agency_id AND i.id = NEW.owner_record_id
      AND i.source_module = 'LEAVE'
      AND (
        (NEW.owner_status = 'WITHDRAWN' AND i.status = 'CANCELLED'
          AND i.source_correction_key = NEW.effect_key)
        OR (NEW.owner_status = 'DEFERRED' AND i.status = 'CONSUMED' AND EXISTS (
          SELECT 1 FROM payroll_adjustment_causes c
          WHERE c.agency_id = i.agency_id AND c.payroll_input_id = i.id
            AND c.payroll_adjustment_id = NEW.payroll_adjustment_id
            AND c.source_correction_key = NEW.effect_key
        ))
      )
  ) THEN
    RAISE EXCEPTION 'A Payroll effect must name the Payroll Input withdrawn under its key'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.effect_kind = 'PAYROLL_REPLACEMENT' AND NOT EXISTS (
    SELECT 1 FROM payroll_inputs i
    WHERE i.agency_id = NEW.agency_id AND i.id = NEW.owner_record_id
      AND i.source_module = 'LEAVE'
      AND i.source_type = 'LeaveCancellation' AND i.source_id = NEW.leave_cancellation_id
      AND i.replaces_payroll_input_id IS NOT NULL
      AND i.status = 'PENDING' AND NEW.owner_status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'A Payroll replacement effect must name the input accepted for its cancellation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
