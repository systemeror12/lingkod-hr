-- Phase 8 COC balance read (#576). hris-controls §6.9 baseline grants:
--
-- - HR Admin `A`, Approving Official `R`, Payroll Preparer `R`, and Auditor `R`:
--   AGENCY.
-- - Leave Admin `A` goes to both administrator roles, as Leave's own grants do,
--   because no Leave Administrator role is seeded.
-- - Supervisor `S`: DIRECT_REPORTS (ADR 0007).
-- - Employee `O`: OWN.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.coc.read', 'overtime', 'MEDIUM', 'Read an Employee''s COC balance')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.coc.read'
WHERE r."code" IN (
    'agency_administrator',
    'hrmo_administrator',
    'appointing_authority',
    'payroll_preparer',
    'internal_auditor'
  )
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.coc.read'
WHERE r."code" = 'supervisor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.coc.read'
WHERE r."code" = 'employee'
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
      AND p."code" = 'overtime.coc.read'
      AND (
        (r."code" IN (
            'agency_administrator',
            'hrmo_administrator',
            'appointing_authority',
            'payroll_preparer',
            'internal_auditor'
          ) AND rp."scope_policy" = 'AGENCY')
        OR (r."code" = 'supervisor' AND rp."scope_policy" = 'DIRECT_REPORTS')
        OR (r."code" = 'employee' AND rp."scope_policy" = 'OWN')
      )
  ) <> 7 THEN
    RAISE EXCEPTION 'COC balance read grant verification failed';
  END IF;
END;
$$;
