-- ADR 0005: a Supervisor's direct reports are the Employees serving in the
-- Organization Units they head and the heads of those units' immediate child
-- units. The Supervisor role starts with only the `leave.mandatory_assessments.read`
-- grant from hris-controls §6.8 (`S`). Other `S` grants follow as their
-- modules resolve DIRECT_REPORTS; granting them earlier would widen access
-- wherever a service checks the permission code without its scope.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('supervisor', 'Supervisor', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.mandatory_assessments.read'
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
      AND p."code" = 'leave.mandatory_assessments.read'
      AND rp."scope_policy" = 'DIRECT_REPORTS'
  ) THEN
    RAISE EXCEPTION 'Supervisor Mandatory Leave Assessment read grant verification failed';
  END IF;
END;
$$;
