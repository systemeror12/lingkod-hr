-- Phase 9 PhilHealth and Pag-IBIG contributions (#632), as payroll-schema.md
-- §1 and §9 have them. The calculation job writes one Contribution Line of
-- each type per Employee, and the shares as Payroll Lines, from the
-- PHILHEALTH_CONTRIBUTION and PAGIBIG_CONTRIBUTION National Payroll Rule
-- Versions in the period's rule snapshot. Neither kind is required to freeze
-- a snapshot: a period with no version in effect calculates, and each
-- Employee gets a blocking exception.
--
-- The list keeps every kind the earlier migrations add, including 0170's
-- 'OVERTIME_PAY' (#628) and 0171's 'CLOTHING_ALLOWANCE' (#631), so this check
-- leaves them all in place.
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION',
      'YEAR_END_BONUS_AND_CASH_GIFT', 'PERA', 'COMMUTABLE_RATA', 'OVERTIME_PAY', 'CLOTHING_ALLOWANCE',
      'PHILHEALTH_CONTRIBUTION', 'PAGIBIG_CONTRIBUTION'
    ));

ALTER TABLE "contribution_lines"
  DROP CONSTRAINT "contribution_lines_type_check";
ALTER TABLE "contribution_lines"
  ADD CONSTRAINT "contribution_lines_type_check"
    CHECK ("contribution_type" IN ('GSIS', 'EMPLOYEES_COMPENSATION', 'PHILHEALTH', 'PAGIBIG'));

-- The shares as Native Payroll Components (BRD PAY-004). They are
-- unconditional, so they need no Agency Payroll Applicability and take no
-- Authorized Payroll Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES
  ('PHILHEALTH_EMPLOYEE_SHARE', 'PhilHealth employee share', 'DEDUCTION', false, false, false),
  ('PHILHEALTH_EMPLOYER_SHARE', 'PhilHealth employer share', 'EMPLOYER_SHARE', false, false, false),
  ('PAGIBIG_EMPLOYEE_SHARE', 'Pag-IBIG employee share', 'DEDUCTION', false, false, false),
  ('PAGIBIG_EMPLOYER_SHARE', 'Pag-IBIG employer share', 'EMPLOYER_SHARE', false, false, false)
ON CONFLICT ("code") DO NOTHING;

-- Rollback/correction: only through a reviewed forward migration; catalogue
-- rows and contribution lines are retained payroll history.
-- Verification: SELECT "code", "category" FROM "pay_components"
--   WHERE "code" LIKE 'PHILHEALTH_%' OR "code" LIKE 'PAGIBIG_%';
