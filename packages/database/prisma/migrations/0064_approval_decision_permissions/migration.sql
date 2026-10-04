-- The seeded HRMO authority can be selected for the shared approval decision
-- permission. Domain-specific routes may still reference any existing Agency
-- permission, but the shared Phase 6 route has a usable baseline authority.

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'approvals.requests.approve',
  'approvals.requests.return',
  'approvals.requests.reject'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator'
      AND r."agency_id" IS NULL
      AND p."code" = 'approvals.requests.approve'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Approval decision permission verification failed';
  END IF;
END;
$$;
