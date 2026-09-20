-- Align seeded attendance.events grants with the 6.7 matrix in docs/hris-controls.md.
-- The web clock is own-record only (O) and HR Officer reads are assigned-scope (S).
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

UPDATE "role_permissions"
SET "scope_policy" = 'OWN'
WHERE "permission_id" = (SELECT "id" FROM "permissions" WHERE "code" = 'attendance.events.clock')
  AND "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'hrmo_administrator' AND "agency_id" IS NULL);

UPDATE "role_permissions"
SET "scope_policy" = 'ASSIGNED_OFFICE'
WHERE "permission_id" = (SELECT "id" FROM "permissions" WHERE "code" = 'attendance.events.read')
  AND "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'personnel_records_officer' AND "agency_id" IS NULL);

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
