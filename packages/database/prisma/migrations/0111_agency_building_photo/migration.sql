CREATE TABLE agency_building_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL UNIQUE REFERENCES agencies(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  width INTEGER NOT NULL CHECK (width >= 1200),
  height INTEGER NOT NULL CHECK (height > 0),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  shown BOOLEAN NOT NULL DEFAULT true,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_name TEXT NOT NULL,
  changed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_by_membership_id UUID NOT NULL,
  FOREIGN KEY (agency_id, changed_by_membership_id) REFERENCES agency_memberships(agency_id, id) ON DELETE RESTRICT
);
ALTER TABLE agency_building_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_building_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_building_photos_isolation ON agency_building_photos
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON agency_building_photos TO hris_app;
