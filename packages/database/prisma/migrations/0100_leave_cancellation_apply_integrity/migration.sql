ALTER TABLE leave_cancellations ADD COLUMN last_effect_failure_kind text
  CHECK (last_effect_failure_kind IN ('RETRYABLE', 'BLOCKING'));
ALTER TABLE leave_cancellations ADD CONSTRAINT leave_cancellations_failure_check CHECK (
  (effect_status = 'FAILED' AND last_effect_failure_kind IS NOT NULL AND last_effect_failure_code IS NOT NULL)
  OR (effect_status <> 'FAILED' AND last_effect_failure_kind IS NULL AND last_effect_failure_code IS NULL)
);

CREATE FUNCTION guard_applied_leave_cancellation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.effect_status = 'APPLIED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Applied Leave Cancellations are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leave_cancellations_applied_mutation_trigger
  BEFORE UPDATE ON leave_cancellations
  FOR EACH ROW EXECUTE FUNCTION guard_applied_leave_cancellation_mutation();

-- A release effect keeps the identifier issued by the commitment owner and
-- cannot point at another Agency, version, or an unreleased reservation.
CREATE FUNCTION guard_leave_cancellation_effect_insert()
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
  RETURN NEW;
END;
$$;
CREATE TRIGGER leave_cancellation_effects_insert_trigger
  BEFORE INSERT ON leave_cancellation_effects
  FOR EACH ROW EXECUTE FUNCTION guard_leave_cancellation_effect_insert();

CREATE OR REPLACE FUNCTION guard_outbox_event_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.leave_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Outbox Events require an owning application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
