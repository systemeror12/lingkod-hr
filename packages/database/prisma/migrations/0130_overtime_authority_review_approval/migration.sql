-- Phase 8 Overtime Authority review, approval, rejection, and cancellation
-- before service (#532). hris-controls §6.9 baseline grants, all AGENCY:
--
-- - `overtime.authorities.review`: HR Admin `A` and Budget Officer `A`.
-- - `overtime.authorities.approve` and `.reject`: Approving Official `A`.
-- - `overtime.authorities.cancel`: Approving Official `A`, held back in 0129
--   until an APPROVED authority could be cancelled.
--
-- `C` (agency-configurable) cells and the Auditor's `R` on `.review` are not
-- baseline grants. Reviewers already hold the Approvals operational grants the
-- review needs to open the Approval Request.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.authorities.review', 'overtime', 'MEDIUM', 'Review a submitted Overtime Authority and attest eligibility'),
  ('overtime.authorities.approve', 'overtime', 'HIGH', 'Approve an Overtime Authority and fix its compensation method'),
  ('overtime.authorities.reject', 'overtime', 'HIGH', 'Reject a reviewed Overtime Authority')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.authorities.review'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'budget_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'overtime.authorities.approve',
  'overtime.authorities.reject',
  'overtime.authorities.cancel'
)
WHERE r."code" = 'appointing_authority'
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
      AND rp."scope_policy" = 'AGENCY'
      AND (
        (p."code" = 'overtime.authorities.review'
          AND r."code" IN ('agency_administrator', 'hrmo_administrator', 'budget_officer'))
        OR (p."code" IN (
              'overtime.authorities.approve',
              'overtime.authorities.reject',
              'overtime.authorities.cancel'
            )
          AND r."code" = 'appointing_authority')
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'Overtime Authority review and approval grant verification failed';
  END IF;
END;
$$;
