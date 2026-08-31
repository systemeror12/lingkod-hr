-- Keep Staffing Authority duties narrow: Plantilla prepares records and
-- evidence; HRMO and Budget hold transition authority.

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id"
  AND rp."permission_id" = p."id"
  AND r."agency_id" IS NULL
  AND r."code" = 'plantilla_officer'
  AND p."code" IN (
    'staffing.authorities.activate',
    'staffing.authorities.supersede',
    'staffing.authorities.revoke'
  );

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'documents.evidence.read'
WHERE r."code" IN ('plantilla_officer', 'budget_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
