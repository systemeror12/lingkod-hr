-- hris-controls §6.8 gives the Supervisor `S` on
-- `leave.applications.create`, `leave.applications.submit`,
-- `leave.applications.request_cancel`, `leave.monetization.create` and
-- `leave.monetization.submit`: a Supervisor may file these on behalf of a
-- direct report (ADR 0007), who stays the subject. The Supervisor records the
-- Employee's signed form; only the Employee may attest by authenticated
-- submission.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p
  ON p."code" IN (
    'leave.applications.create',
    'leave.applications.submit',
    'leave.applications.request_cancel',
    'leave.monetization.create',
    'leave.monetization.submit'
  )
WHERE r."code" = 'supervisor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'supervisor' AND r."agency_id" IS NULL
      AND p."code" IN (
        'leave.applications.create',
        'leave.applications.submit',
        'leave.applications.request_cancel',
        'leave.monetization.create',
        'leave.monetization.submit'
      )
      AND rp."scope_policy" = 'DIRECT_REPORTS'
  ) <> 5 THEN
    RAISE EXCEPTION 'Supervisor Leave filing grant verification failed';
  END IF;
END;
$$;
