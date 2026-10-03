CREATE TABLE agency_seals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL UNIQUE REFERENCES agencies(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  width INTEGER NOT NULL CHECK (width >= 600),
  height INTEGER NOT NULL CHECK (height >= 600),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_name TEXT NOT NULL,
  changed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_by_membership_id UUID NOT NULL,
  FOREIGN KEY (agency_id, changed_by_membership_id) REFERENCES agency_memberships(agency_id, id) ON DELETE RESTRICT
);
ALTER TABLE agency_seals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_seals FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_seals_isolation ON agency_seals
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON agency_seals TO hris_app;
