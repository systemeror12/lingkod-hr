-- A Security Administrator resets a User's TOTP factor after verifying their
-- identity (#370, #381). Only the Security Administrator holds the permission;
-- the Agency Administrator does not.

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'security.mfa.reset_factor',
  'security',
  'CRITICAL',
  'Reset a User''s TOTP factor and Recovery Codes'
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'security.mfa.reset_factor'
WHERE r."code" = 'security_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- The member list shows whether each User in the Agency has a factor. The
-- owner policy shows a User only their own, so the Agency Context may also
-- read the factors of its members. Writes stay with the owner policy: a reset
-- acts in the target User's context after the service authorizes it.
CREATE POLICY "user_totp_factors_agency_member_select" ON "user_totp_factors"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "agency_memberships" m
      WHERE m."user_id" = "user_totp_factors"."user_id"
        AND m."agency_id" = app_agency_id()
    )
  );

-- Rollback/correction: drop the policy, then delete the role_permissions row
-- and the permission once no Security Event or audit record depends on them.
