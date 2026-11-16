-- Phase 9 overtime pay (#628), as payroll-schema.md §1 and §8 have it.

-- The Overtime Pay rule of CSC-DBM JC No. 2, s. 2015 is a National Payroll
-- Rule Version whose parameters hold the hourly rate's divisors (item 9.3),
-- the workday and non-workday premiums (item 9.4), the most hours a
-- non-workday pays (item 10.5), and the employee and agency annual caps as
-- shares (items 10.6 and 10.7).
-- The list keeps every kind migrations 0168 and 0169 add (#342, #343).
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION',
      'YEAR_END_BONUS_AND_CASH_GIFT', 'PERA', 'COMMUTABLE_RATA', 'OVERTIME_PAY'
    ));

-- A Native Payroll Component paid from Overtime's OVERTIME_HOURS Payroll
-- Inputs: unconditional, since the agency head chooses cash on each Overtime
-- Authority rather than through an Agency Payroll Applicability; not
-- revalidated against each year's GAA, since the joint circular is not a GAA
-- provision; and taking no Authorized Payroll Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('OVERTIME_PAY', 'Overtime pay', 'EARNING', false, false, false)
ON CONFLICT ("code") DO NOTHING;

-- Rollback/correction: only through a reviewed forward migration; overtime
-- pay lines are retained payroll history.
-- Verification: SELECT * FROM pay_components WHERE code = 'OVERTIME_PAY';
