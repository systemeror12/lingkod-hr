-- Phase 9 commutable RATA (#343), as payroll-schema.md §1 and §2 have it.

-- One fiscal year's commutable RATA rule (FY 2026 GAA sec. 71; DBM NBC No.
-- 593) is a National Payroll Rule Version whose parameters hold each rank's
-- monthly representation and transportation allowance with its eligible
-- position titles, and NBC 593's actual-work schedule.
-- The list keeps 'PERA', which migration 0168 adds (#342), so whichever of the
-- two runs last leaves both kinds in place.
ALTER TABLE "national_payroll_rule_versions"
  DROP CONSTRAINT "national_payroll_rule_versions_rule_kind_check";
ALTER TABLE "national_payroll_rule_versions"
  ADD CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN (
      'SALARY_SCHEDULE', 'AUTHORIZED_DEDUCTIONS', 'GSIS_CONTRIBUTION', 'EMPLOYEES_COMPENSATION',
      'YEAR_END_BONUS_AND_CASH_GIFT', 'PERA', 'COMMUTABLE_RATA'
    ));

-- The representation and the transportation allowance are separate Native
-- Payroll Components: unconditional, revalidated against each year's GAA, and
-- taking no Authorized Payroll Component Input.
--
-- An official-vehicle assignment is recorded as an Agency Payroll Applicability
-- of OFFICIAL_VEHICLE_ASSIGNMENT for one named Employee, with the assignment's
-- authority Document Version (#618). It is conditional so that it takes a
-- record, informational so that it writes no Payroll Line, and not
-- GAA-revalidated, since an assignment does not end with the fiscal year.
-- While one covers the month, RATA writes no transportation allowance (NBC 593).
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES
  ('REPRESENTATION_ALLOWANCE', 'Representation allowance', 'EARNING', false, true, false),
  ('TRANSPORTATION_ALLOWANCE', 'Transportation allowance', 'EARNING', false, true, false),
  ('OFFICIAL_VEHICLE_ASSIGNMENT', 'Official vehicle assignment', 'INFORMATIONAL', true, false, false)
ON CONFLICT ("code") DO NOTHING;

-- Rollback/correction: only through a reviewed forward migration; catalogue
-- rows are referenced by retained payroll history.
-- Verification: SELECT "code", "category", "is_conditional" FROM "pay_components"
--   WHERE "code" IN ('REPRESENTATION_ALLOWANCE', 'TRANSPORTATION_ALLOWANCE',
--   'OFFICIAL_VEHICLE_ASSIGNMENT');
