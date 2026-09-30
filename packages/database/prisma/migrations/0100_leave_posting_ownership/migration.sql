CREATE OR REPLACE FUNCTION guard_outbox_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.personnel_baseline_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.attendance_transition', true) IS DISTINCT FROM 'on'
    AND current_setting('app.leave_posting_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Outbox Events require an owning application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_leave_posting_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.leave_posting_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Leave Posting requires the owning application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leave_postings_owner_trigger BEFORE INSERT ON leave_postings
FOR EACH ROW EXECUTE FUNCTION guard_leave_posting_insert();
CREATE TRIGGER leave_posting_effects_owner_trigger BEFORE INSERT ON leave_posting_effects
FOR EACH ROW EXECUTE FUNCTION guard_leave_posting_insert();
