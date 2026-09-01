-- Personnel Records Officers may choose from the shared finalized Document
-- catalog when attaching evidence. No separate Personnel storage is added.

ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'documents.evidence.read',
  'documents.evidence.read_sensitive'
)
WHERE r."code" = 'personnel_records_officer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
