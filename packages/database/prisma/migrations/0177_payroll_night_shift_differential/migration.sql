-- Phase 9 night-shift differential (#627), as payroll-schema.md §1 to §3 have
-- it.

-- RA No. 11701, sec. 1 is a National Payroll Rule Version whose parameters
-- hold the rate ceiling (20% of the hourly basic rate) and the hourly basic
-- rate's divisors (the basic monthly rate ÷ 22 working days ÷ 8 hours). The
-- statute has no expiry; the annual GAA only funds it (research R12).
-- The list keeps every kind the earlier migrations add, through 0174's
-- 'PHILHEALTH_CONTRIBUTION' and 'PAGIBIG_CONTRIBUTION' (#632) and 0176's
-- 'COMPENSATION_WITHHOLDING_TAX' and 'DE_MINIMIS_BENEFITS' (#350).
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION',
      'YEAR_END_BONUS_AND_CASH_GIFT', 'PERA', 'COMMUTABLE_RATA', 'OVERTIME_PAY', 'CLOTHING_ALLOWANCE',
      'PHILHEALTH_CONTRIBUTION', 'PAGIBIG_CONTRIBUTION',
      'COMPENSATION_WITHHOLDING_TAX', 'DE_MINIMIS_BENEFITS', 'NIGHT_SHIFT_DIFFERENTIAL'
    ));

-- A Native Payroll Component paid from Attendance's NIGHT_DUTY facts at the
-- percentage the agency head sets (RA No. 11701, sec. 1), which is an
-- Authorized Payroll Component Input of value kind RATE. The input carries
-- its own authority, period, and population, so the component needs no
-- Agency Payroll Applicability and is not conditional (#328 decision 23). It
-- is not revalidated against each year's GAA, since the statute fixes the
-- entitlement and the GAA only its funding.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('NIGHT_SHIFT_DIFFERENTIAL', 'Night-shift differential', 'EARNING', false, false, true)
ON CONFLICT ("code") DO NOTHING;

-- Rollback/correction: only through a reviewed forward migration; catalogue
-- rows are referenced by authorized inputs and retained payroll history.
-- Verification: SELECT "code", "category", "accepts_authorized_input"
--   FROM "pay_components" WHERE "code" = 'NIGHT_SHIFT_DIFFERENTIAL';
