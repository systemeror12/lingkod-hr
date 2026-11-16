-- Phase 9 leave monetization in calculation (#626), as payroll-schema.md §2
-- and §8 have it.

-- A Native Payroll Component: unconditional, since the Monetization Earning
-- Input carries its own approval and authority and needs no Agency Payroll
-- Applicability; not revalidated against each year's GAA, since its factor
-- comes from CSC MC No. 2, s. 2016 and DBM BC No. 2016-2; and taking no
-- Authorized Payroll Component Input, since only Leave posts it.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('LEAVE_MONETIZATION', 'Leave monetization', 'EARNING', false, false, false)
ON CONFLICT ("code") DO NOTHING;

-- Rollback/correction: only through a reviewed forward migration; monetization
-- lines are retained payroll history.
-- Verification: SELECT * FROM pay_components WHERE code = 'LEAVE_MONETIZATION';
