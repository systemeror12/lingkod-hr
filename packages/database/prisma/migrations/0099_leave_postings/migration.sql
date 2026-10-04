CREATE TABLE leave_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  leave_approval_allocation_id uuid NOT NULL,
  idempotency_key citext NOT NULL
    CHECK (btrim(idempotency_key::text) <> ''),
  posted_by_membership_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  FOREIGN KEY (agency_id, leave_approval_allocation_id)
    REFERENCES leave_approval_allocations (agency_id, id),
  FOREIGN KEY (agency_id, posted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (leave_application_version_id),
  UNIQUE (agency_id, leave_application_version_id),
  UNIQUE (agency_id, idempotency_key),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_posting_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_posting_id uuid NOT NULL,
  effect_kind text NOT NULL
    CHECK (effect_kind IN (
      'LEDGER_ENTRY','ATTENDANCE_INPUT','PAYROLL_INPUT'
    )),
  effect_key citext NOT NULL CHECK (btrim(effect_key::text) <> ''),
  owner_record_id uuid NOT NULL,
  FOREIGN KEY (agency_id, leave_posting_id)
    REFERENCES leave_postings (agency_id, id),
  UNIQUE (leave_posting_id, effect_key),
  UNIQUE (agency_id, effect_kind, owner_record_id),
  UNIQUE (agency_id, id)
);


CREATE FUNCTION guard_leave_posting_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave postings and effects are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave postings and effects are retained' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'leave_postings' AND NOT EXISTS (
    SELECT 1 FROM leave_approval_allocations a
    WHERE a.agency_id = NEW.agency_id AND a.id = NEW.leave_approval_allocation_id
      AND a.leave_application_version_id = NEW.leave_application_version_id
  ) THEN
    RAISE EXCEPTION 'Leave Posting must bind the approved allocation of its exact version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leave_postings_mutation_trigger BEFORE INSERT OR UPDATE OR DELETE ON leave_postings
FOR EACH ROW EXECUTE FUNCTION guard_leave_posting_mutation();
CREATE TRIGGER leave_posting_effects_mutation_trigger BEFORE UPDATE OR DELETE ON leave_posting_effects
FOR EACH ROW EXECUTE FUNCTION guard_leave_posting_mutation();
GRANT SELECT, INSERT ON leave_postings, leave_posting_effects TO hris_app;
ALTER TABLE leave_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_postings FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_posting_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_posting_effects FORCE ROW LEVEL SECURITY;
CREATE POLICY leave_postings_select ON leave_postings FOR SELECT USING (agency_id = app_agency_id());
CREATE POLICY leave_postings_insert ON leave_postings FOR INSERT WITH CHECK (agency_id = app_agency_id());
CREATE POLICY leave_posting_effects_select ON leave_posting_effects FOR SELECT USING (agency_id = app_agency_id());
CREATE POLICY leave_posting_effects_insert ON leave_posting_effects FOR INSERT WITH CHECK (agency_id = app_agency_id());

ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO permissions (code, domain, risk_level, description)
VALUES ('leave.applications.post', 'leave', 'CRITICAL', 'Post approved leave atomically to Leave and Attendance')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id, scope_policy)
SELECT r.id, p.id, 'AGENCY' FROM roles r JOIN permissions p ON p.code = 'leave.applications.post'
WHERE r.agency_id IS NULL AND r.code IN ('agency_administrator', 'hrmo_administrator', 'personnel_records_officer')
ON CONFLICT DO NOTHING;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
