-- Phase 9 period read of Payslips (#641). `GET .../payroll-periods/:periodId/payslips`
-- needs `payroll.payslips.read` held Agency-wide, so the payroll officers see
-- each Payslip of a period in its status. Migration 0191 seeded only the
-- Employee's OWN grant, because no Agency-wide read existed yet.
--
-- hris-controls.md §6.10 marks `payroll.payslips.read` A for the Payroll
-- Preparer and the Payroll Approver, and R (read-only) for the Accounting
-- Reviewer, the Cashier, and the Auditor (`internal_auditor`), as 0152 and
-- 0167 read R for a read permission. The HR Certifier and the HR Admin are C
-- (conditional or agency-configurable), so they are not seeded; the Budget
-- Officer is not included. The permission row exists since 0191.

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.payslips.read'
WHERE r."code" IN (
    'payroll_preparer', 'accounting_reviewer', 'payroll_approver', 'cashier', 'internal_auditor'
  )
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" IN (
        'payroll_preparer', 'accounting_reviewer', 'payroll_approver', 'cashier', 'internal_auditor'
      )
      AND p."code" = 'payroll.payslips.read'
      AND rp."scope_policy" = 'AGENCY'
  ) <> 5 THEN
    RAISE EXCEPTION 'Payslip period read grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- Rollback/correction: only through a reviewed forward migration.
-- Verification: pnpm db:policies role_permissions
