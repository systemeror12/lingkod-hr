-- Phase 9 cash uniform/clothing allowance (#631), as payroll-schema.md §1 and
-- §2 have it.

-- One fiscal year's cash uniform/clothing allowance rule (FY 2026 GAA sec. 64;
-- DBM BC No. 2024-1) is a National Payroll Rule Version whose parameters hold
-- the annual amount for full-time service and the days of service in the
-- fiscal year the grant needs. The list keeps every kind earlier migrations
-- add, through 'COMMUTABLE_RATA' (0169), and 0172's 'OVERTIME_PAY' (#628).
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION',
      'YEAR_END_BONUS_AND_CASH_GIFT', 'PERA', 'COMMUTABLE_RATA', 'OVERTIME_PAY',
      'CLOTHING_ALLOWANCE'
    ));

-- The cash grant is a Native Payroll Component: conditional, since BC No.
-- 2024-1 item 12.1 leaves the form of the grant and its payment schedule to the
-- Agency, which records a cash grant as an Agency Payroll Applicability;
-- revalidated against each year's GAA; and taking no Authorized Payroll
-- Component Input. A procured uniform is not a payroll earning and has no
-- component.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('CLOTHING_ALLOWANCE', 'Uniform/clothing allowance (cash)', 'EARNING', true, true, false)
ON CONFLICT ("code") DO NOTHING;

-- Rollback/correction: only through a reviewed forward migration; catalogue
-- rows are referenced by retained payroll history.
-- Verification: SELECT "code", "category", "is_conditional", "is_gaa_revalidated"
--   FROM "pay_components" WHERE "code" = 'CLOTHING_ALLOWANCE';
