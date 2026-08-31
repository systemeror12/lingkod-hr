ALTER TABLE "qualification_standards"
  ALTER COLUMN "name" TYPE CITEXT USING "name"::CITEXT,
  ADD CONSTRAINT "qualification_standards_agency_name_key" UNIQUE ("agency_id", "name");

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('recruitment_officer', 'Recruitment Officer', TRUE, 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'qualification.standards.read',
  'qualification.standards.create',
  'qualification.standards.update',
  'qualification.standards.evidence.validate',
  'qualification.standards.activate',
  'documents.evidence.read'
)
WHERE r."code" = 'recruitment_officer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
