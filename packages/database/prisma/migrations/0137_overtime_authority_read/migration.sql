-- Phase 8 Overtime Authority read (#533). hris-controls §6.9 baseline grants:
--
-- - HR Admin `A`, Budget Officer `A`, Approving Official `A`, and Auditor `R`:
--   AGENCY.
-- - Supervisor `S`: DIRECT_REPORTS, so a Supervisor reads only authorities
--   whose every covered Employee is a direct report (ADR 0007).
--
-- Employee, Payroll Preparer, and Leave Administrator hold no grant.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.authorities.read', 'overtime', 'MEDIUM', 'Read Overtime Authorities and their review and decision')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.authorities.read'
WHERE r."code" IN (
    'agency_administrator',
    'hrmo_administrator',
    'budget_officer',
    'appointing_authority',
    'internal_auditor'
  )
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.authorities.read'
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
    WHERE r."agency_id" IS NULL
      AND p."code" = 'overtime.authorities.read'
      AND (
        (r."code" IN (
            'agency_administrator',
            'hrmo_administrator',
            'budget_officer',
            'appointing_authority',
            'internal_auditor'
          ) AND rp."scope_policy" = 'AGENCY')
        OR (r."code" = 'supervisor' AND rp."scope_policy" = 'DIRECT_REPORTS')
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'Overtime Authority read grant verification failed';
  END IF;
END;
$$;
