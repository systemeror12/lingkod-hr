-- Phase 9 PERA (#342), as payroll-schema.md §2 and §8 have it.

-- One fiscal year's PERA rule (FY 2026 GAA sec. 63; DBM BC No. 2009-3 as
-- amended by BC No. 2011-2) is a National Payroll Rule Version whose
-- parameters hold the monthly amount and the circular's daily amount.
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION',
      'YEAR_END_BONUS_AND_CASH_GIFT', 'PERA'
    ));

-- A Native Payroll Component: unconditional, since BC No. 2009-3 item 5.2
-- pays it to NGA personnel with no Agency decision; revalidated against each
-- year's GAA; and taking no Authorized Payroll Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('PERA', 'Personnel Economic Relief Allowance', 'EARNING', false, true, false)
ON CONFLICT ("code") DO NOTHING;

-- Rollback/correction: only through a reviewed forward migration; PERA lines
-- are retained payroll history.
-- Verification: SELECT * FROM pay_components WHERE code = 'PERA';
