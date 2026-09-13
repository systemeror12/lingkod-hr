-- Phase 6 Employee activation and recruitment closure. The assumed Appointment
-- is the only source that activates service: Personnel owns the Employee, the
-- initial Service Segment, and the Employee service projection; Plantilla owns
-- the reserved-item occupancy and the Position Incumbency; Recruitment closes
-- the selected Application, its Vacancy Publication, and the Request to Fill
-- only after both owning effects succeed. One Appointment can activate service
-- at most once, and retries preserve the original outcome links.

CREATE UNIQUE INDEX IF NOT EXISTS "service_segments_appointment_key"
  ON "service_segments" ("agency_id", "appointment_id")
  WHERE "appointment_id" IS NOT NULL;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.employees.activate', 'personnel', 'CRITICAL', 'Activate an Employee from the assumed Appointment and create the initial Service Segment')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'personnel.employees.activate'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'personnel_records_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'service_segments_appointment_key'
  ) THEN
    RAISE EXCEPTION 'Service activation migration verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'personnel.employees.activate') THEN
    RAISE EXCEPTION 'Service activation permission verification failed';
  END IF;
END;
$$;
