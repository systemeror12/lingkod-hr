-- hris-controls §6.8 gives the Supervisor `S` on `leave.accounts.read`.
-- LeaveAccountsService now resolves DIRECT_REPORTS (ADR 0007), so the
-- Supervisor role can read the Leave Accounts of their direct reports.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.accounts.read'
WHERE r."code" = 'supervisor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'supervisor' AND r."agency_id" IS NULL
      AND p."code" = 'leave.accounts.read'
      AND rp."scope_policy" = 'DIRECT_REPORTS'
  ) THEN
    RAISE EXCEPTION 'Supervisor Leave Account read grant verification failed';
  END IF;
END;
$$;
