-- Employee self-service receives only own-record Personnel Document access.

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('employee', 'Employee', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.documents.read',
  'personnel.documents.upload'
)
WHERE r."code" = 'employee' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
