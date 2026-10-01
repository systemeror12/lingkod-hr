-- Posting and Cancellation are both Leave-owned outbox writers.
CREATE OR REPLACE FUNCTION guard_outbox_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.leave_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.leave_posting_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Outbox Events require an owning application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
