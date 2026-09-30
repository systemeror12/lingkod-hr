-- Applying an approved cancellation is separate from its immutable decision.
CREATE TABLE leave_cancellation_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_cancellation_id uuid NOT NULL,
  effect_kind text NOT NULL CHECK (effect_kind IN (
    'COMMITMENT_RELEASE', 'LEDGER_REVERSAL', 'LEDGER_REPLACEMENT',
    'ATTENDANCE_CORRECTION', 'PAYROLL_CORRECTION'
  )),
  effect_key citext NOT NULL CHECK (btrim(effect_key::text) <> ''),
  owner_record_id uuid NOT NULL,
  owner_status citext NOT NULL CHECK (btrim(owner_status::text) <> ''),
  FOREIGN KEY (agency_id, leave_cancellation_id)
    REFERENCES leave_cancellations (agency_id, id),
  UNIQUE (leave_cancellation_id, effect_key),
  UNIQUE (agency_id, effect_kind, owner_record_id),
  UNIQUE (agency_id, id)
);

CREATE FUNCTION guard_leave_cancellation_effect_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Leave Cancellation effects are immutable and retained'
    USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER leave_cancellation_effects_mutation_trigger
  BEFORE UPDATE OR DELETE ON leave_cancellation_effects
  FOR EACH ROW EXECUTE FUNCTION guard_leave_cancellation_effect_mutation();

GRANT SELECT, INSERT ON leave_cancellation_effects TO hris_app;
ALTER TABLE leave_cancellation_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_cancellation_effects FORCE ROW LEVEL SECURITY;
CREATE POLICY leave_cancellation_effects_select ON leave_cancellation_effects
  FOR SELECT USING (agency_id = app_agency_id());
CREATE POLICY leave_cancellation_effects_insert ON leave_cancellation_effects
  FOR INSERT WITH CHECK (agency_id = app_agency_id());

ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO permissions (code, domain, risk_level, description)
VALUES ('leave.applications.apply_cancellation', 'leave', 'CRITICAL',
  'Apply the effects of an approved Leave Cancellation')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id, scope_policy)
SELECT r.id, p.id, 'AGENCY'
FROM roles r JOIN permissions p ON p.code = 'leave.applications.apply_cancellation'
WHERE r.code IN ('agency_administrator', 'hrmo_administrator') AND r.agency_id IS NULL
ON CONFLICT DO NOTHING;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
