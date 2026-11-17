-- Phase 9 authorized deductions by priority and the net-pay floor (#634), as
-- payroll-schema.md §9 has them. The calculation job applies an Employee's
-- Deduction Obligations to a regular period's pay after every tax and
-- contribution, in the order and down to the monthly net take-home floor the
-- AUTHORIZED_DEDUCTIONS National Payroll Rule Version states (FY 2026 GAA
-- sec. 62). Each obligation gets one Loan Deduction Line in the result: what
-- was due, what was deducted, and what the floor stopped. A deducted amount
-- is also a LOAN_DEDUCTION Payroll Line, so the result's totals include it.
--
-- The rule version's parameters gain `priorityPayeeCategories` and
-- `monthlyNetTakeHomeFloor`; the load validates them in code, so no column
-- changes.
CREATE TABLE "loan_deduction_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_employee_id" UUID NOT NULL,
  "deduction_obligation_id" UUID NOT NULL,
  "priority" INTEGER NOT NULL,
  "amount_due" NUMERIC(19,4) NOT NULL,
  "deducted_amount" NUMERIC(19,4) NOT NULL,
  "not_deducted_amount" NUMERIC(19,4) NOT NULL,
  "rule_version_id" UUID NOT NULL,
  CONSTRAINT "loan_deduction_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loan_deduction_lines_priority_check" CHECK ("priority" > 0),
  CONSTRAINT "loan_deduction_lines_amounts_check"
    CHECK (
      "amount_due" > 0
      AND "deducted_amount" >= 0
      AND "not_deducted_amount" >= 0
      AND "deducted_amount" + "not_deducted_amount" = "amount_due"
    ),
  CONSTRAINT "loan_deduction_lines_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "loan_deduction_lines_payroll_employee_fkey"
    FOREIGN KEY ("agency_id", "payroll_employee_id")
    REFERENCES "payroll_employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "loan_deduction_lines_deduction_obligation_fkey"
    FOREIGN KEY ("agency_id", "deduction_obligation_id")
    REFERENCES "deduction_obligations"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "loan_deduction_lines_rule_version_fkey"
    FOREIGN KEY ("rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT,
  -- One line per obligation in a result, and one obligation per place in its order.
  CONSTRAINT "loan_deduction_lines_obligation_key"
    UNIQUE ("agency_id", "payroll_employee_id", "deduction_obligation_id"),
  CONSTRAINT "loan_deduction_lines_priority_key"
    UNIQUE ("agency_id", "payroll_employee_id", "priority")
);

-- A Loan Deduction Line joins its result only in the transaction that writes
-- the result, for an obligation of the result's Employee, and is never
-- changed or deleted, like a Contribution Line (§9).
CREATE OR REPLACE FUNCTION guard_loan_deduction_line_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_employees" e
    JOIN "deduction_obligations" o
      ON o."agency_id" = e."agency_id" AND o."employee_id" = e."employee_id"
    WHERE e."agency_id" = NEW."agency_id"
      AND e."id" = NEW."payroll_employee_id"
      AND e."xmin" = pg_current_xact_id()::xid
      AND o."id" = NEW."deduction_obligation_id"
  ) THEN
    RAISE EXCEPTION 'A Loan Deduction Line joins its result only in the transaction that writes it, for an obligation of its Employee'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "loan_deduction_lines_insert_trigger"
  BEFORE INSERT ON "loan_deduction_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_loan_deduction_line_insert();

CREATE TRIGGER "loan_deduction_lines_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "loan_deduction_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- REVOKE first: the migrator's default privileges would give `hris_app` UPDATE.
REVOKE ALL ON TABLE "loan_deduction_lines" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "loan_deduction_lines" TO hris_app;

ALTER TABLE "loan_deduction_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loan_deduction_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY "loan_deduction_lines_select" ON "loan_deduction_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "loan_deduction_lines_insert" ON "loan_deduction_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- The deducted amount as a Native Payroll Component (BRD PAY-004). It applies
-- recorded Deduction Obligations, so it needs no Agency Payroll Applicability
-- and takes no Authorized Payroll Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('LOAN_DEDUCTION', 'Loan or authorized deduction', 'DEDUCTION', false, true, false)
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'loan_deduction_lines') THEN
    RAISE EXCEPTION 'Loan deduction line forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('loan_deduction_lines_insert_trigger', 'loan_deduction_lines_immutable_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Loan deduction line guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; loan
-- deduction lines are retained payroll history.
-- Verification: pnpm db:policies loan_deduction_lines
