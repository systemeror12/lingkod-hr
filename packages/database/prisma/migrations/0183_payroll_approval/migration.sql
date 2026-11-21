-- Phase 9 payroll approval (#638), as payroll-schema.md §5 has it. The
-- Payroll Approver approves a CERTIFIED Payroll Period once both checkpoint
-- reviews of its current Certified Payroll Review Export are confirmed, and
-- may return an APPROVED period to FOR_REVIEW before finalization, which
-- revokes the certification, supersedes the export, and so revokes its
-- reviews. Approval writes no row of its own: the certification in force
-- binds the approved version and hash, and nothing can certify, review, or
-- recalculate an APPROVED period. The period status moves are already
-- allowed by migration 0153's guard, and migration 0181 refuses APPROVED
-- while the version has an open blocking exception. This migration only adds
-- the two permissions.

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('payroll.periods.approve', 'payroll', 'HIGH',
   'Approve a CERTIFIED Payroll Period whose checkpoint reviews are both confirmed'),
  ('payroll.periods.return_approved', 'payroll', 'HIGH',
   'Return an APPROVED Payroll Period to FOR_REVIEW before finalization, with a reason')
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks both A for the Payroll Approver. The C grant of
-- `payroll.periods.approve` to the Accounting Reviewer is agency-configurable
-- and is not seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM (VALUES
  ('payroll_approver', 'payroll.periods.approve'),
  ('payroll_approver', 'payroll.periods.return_approved')
) AS grants ("role_code", "permission_code")
JOIN "roles" r ON r."code" = grants."role_code" AND r."agency_id" IS NULL
JOIN "permissions" p ON p."code" = grants."permission_code"
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'payroll_approver'
      AND p."code" IN ('payroll.periods.approve', 'payroll.periods.return_approved')
  ) <> 2 THEN
    RAISE EXCEPTION 'Payroll approval permission grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- Rollback/correction: only through a reviewed forward migration.
-- Verification: SELECT the payroll_approver grants of payroll.periods.approve
-- and payroll.periods.return_approved.
