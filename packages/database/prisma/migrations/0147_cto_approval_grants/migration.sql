-- hris-controls §6.9 baseline grants for deciding a CTO Request (#543): Approving
-- Official `A` on `.approve` and `.reject`. 0144 added their catalog rows, since the
-- route step names them. The HR Administrator's `C` cells are not baseline grants.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.cto.approve', 'overtime.cto.reject')
WHERE r."code" = 'appointing_authority'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."agency_id" IS NULL
      AND r."code" = 'appointing_authority'
      AND rp."scope_policy" = 'AGENCY'
      AND p."code" IN ('overtime.cto.approve', 'overtime.cto.reject')
  ) <> 2 THEN
    RAISE EXCEPTION 'CTO Request decision grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
