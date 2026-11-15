-- Phase 9 compensation basis read (#332). Payroll resolves an Employee's
-- compensation basis from Personnel's salary facts (#619) and the salary
-- schedule in effect (#331). The read endpoint needs `payroll.compensation.read`.
-- No table changes: the basis is computed on read, and a calculation freezes it
-- in `payroll_employees.compensation_basis_snapshot`.

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.compensation.read',
  'payroll',
  'MEDIUM',
  'Read an Employee''s compensation basis and the source of each value'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.compensation.read` to the Payroll
-- Preparer, HR Certifier, Accounting Reviewer, and Payroll Approver, and
-- read-only to the Cashier and Auditor. Only the roles below exist yet; the
-- Budget Officer and HR Admin grants are agency-configurable.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.compensation.read'
WHERE r."code" IN ('payroll_preparer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- Rollback/correction: only through a reviewed forward migration.
