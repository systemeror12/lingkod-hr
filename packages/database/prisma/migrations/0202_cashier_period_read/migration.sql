-- Phase 9 Cashier period read (#644). The Cashier generates the Payment Export
-- and records Disbursement Outcomes from the Payroll workspace, which lists
-- Payroll Periods with `payroll.periods.read` held Agency-wide. Migration 0167
-- seeded that read before the `cashier` role existed, and migration 0186, which
-- added the role, granted it only `payroll.payment_exports.generate`.
--
-- hris-controls.md §6.10 marks `payroll.periods.read` R (read-only) for the
-- Cashier, as 0197 read R for a read permission. Only the Cashier is seeded
-- here; the HR Admin's C stays agency-configurable. The permission row exists
-- since 0167.

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.periods.read'
WHERE r."code" = 'cashier'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'cashier'
      AND p."code" = 'payroll.periods.read'
      AND rp."scope_policy" = 'AGENCY'
  ) <> 1 THEN
    RAISE EXCEPTION 'Cashier period read grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- Rollback/correction: only through a reviewed forward migration.
-- Verification: pnpm db:policies role_permissions
