-- Phase 9 year-end bonus and cash gift (#344), as payroll-schema.md §2 and §8
-- have them. Both are paid in a special Payroll Period that names them (ADR
-- 0015) and covers its rule version's service window, January 1 to October 31.

-- One fiscal year's year-end bonus and cash gift rule (FY 2026 GAA sec. 75;
-- RA No. 6686 as amended by RA No. 8441) is a National Payroll Rule Version
-- whose parameters hold its service window, four-month threshold, bonus months,
-- and cash gift amount.
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN ('SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'YEAR_END_BONUS_AND_CASH_GIFT'));

-- Native Payroll Components: unconditional, revalidated against each year's
-- GAA, and taking no Authorized Payroll Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES
  ('YEAR_END_BONUS', 'Year-end bonus', 'EARNING', false, true, false),
  ('CASH_GIFT', 'Cash gift', 'EARNING', false, true, false)
ON CONFLICT ("code") DO NOTHING;
