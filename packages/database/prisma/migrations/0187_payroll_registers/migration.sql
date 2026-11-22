-- Phase 9 Payroll Register (#353), as payroll-schema.md §12 has it. A
-- Payroll Register is LingkodHR's own Printable System View of one FINALIZED
-- Payroll Period (#617): one PDF, stored through the shared document service,
-- listing every FINALIZED Payroll Employee Result and the totals. A period has
-- one register, so generating again returns it.
--
-- Its totals are those of the period's FINALIZED results at the finalized
-- calculation version, and those results' lines sum to them: the trigger
-- refuses a register whose totals differ from either. Like the Payment Export,
-- the register is immutable; a voided payroll's supersession arrives with the
-- void command (#643).

CREATE TABLE "payroll_registers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "document_id" UUID NOT NULL,
  "result_count" INTEGER NOT NULL,
  "gross_amount" DECIMAL(19, 4) NOT NULL,
  "total_deductions" DECIMAL(19, 4) NOT NULL,
  "net_amount" DECIMAL(19, 4) NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_registers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_registers_result_count_check" CHECK ("result_count" >= 0),
  CONSTRAINT "payroll_registers_net_check"
    CHECK ("net_amount" = "gross_amount" - "total_deductions"),
  CONSTRAINT "payroll_registers_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_registers_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_registers_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_registers_generated_by_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One register per period: generating again finds it.
  CONSTRAINT "payroll_registers_period_key" UNIQUE ("payroll_period_id"),
  CONSTRAINT "payroll_registers_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A register is written only for a FINALIZED period at its finalized version,
-- with the totals of that version's FINALIZED results and of their lines, and
-- is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_payroll_register_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payroll Registers are immutable and retained'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."status" = 'FINALIZED'
      AND p."calculation_version" = NEW."calculation_version"
  ) THEN
    RAISE EXCEPTION 'A Payroll Register is generated only from a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT count(*) AS "result_count",
             COALESCE(sum(r."gross_amount"), 0) AS "gross_amount",
             COALESCE(sum(r."total_deductions"), 0) AS "total_deductions",
             COALESCE(sum(r."net_amount"), 0) AS "net_amount"
      FROM "payroll_employees" r
      WHERE r."agency_id" = NEW."agency_id"
        AND r."payroll_period_id" = NEW."payroll_period_id"
        AND r."calculation_version" = NEW."calculation_version"
        AND r."status" = 'FINALIZED'
    ) results
    CROSS JOIN (
      SELECT COALESCE(sum(l."amount") FILTER (WHERE l."line_type" = 'EARNING'), 0) AS "earnings",
             COALESCE(sum(l."amount") FILTER (WHERE l."line_type" = 'DEDUCTION'), 0) AS "deductions"
      FROM "payroll_lines" l
      JOIN "payroll_employees" r
        ON r."agency_id" = l."agency_id" AND r."id" = l."payroll_employee_id"
      WHERE r."agency_id" = NEW."agency_id"
        AND r."payroll_period_id" = NEW."payroll_period_id"
        AND r."calculation_version" = NEW."calculation_version"
        AND r."status" = 'FINALIZED'
    ) lines
    WHERE results."result_count" = NEW."result_count"
      AND results."gross_amount" = NEW."gross_amount"
      AND results."total_deductions" = NEW."total_deductions"
      AND results."net_amount" = NEW."net_amount"
      AND lines."earnings" = NEW."gross_amount"
      AND lines."deductions" = NEW."total_deductions"
  ) THEN
    RAISE EXCEPTION 'A Payroll Register''s totals equal its finalized results and their lines'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_registers_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_registers"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_register_mutation();

REVOKE ALL ON TABLE "payroll_registers" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_registers" TO hris_app;

ALTER TABLE "payroll_registers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_registers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payroll_registers_select" ON "payroll_registers"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_registers_insert" ON "payroll_registers"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.registers.generate', 'payroll', 'HIGH',
  'Generate the Payroll Register of a FINALIZED Payroll Period'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks `payroll.registers.generate` A for the Payroll
-- Preparer, the HR Certifier, the Budget Officer, the Accounting Reviewer, the
-- Payroll Approver, and the Cashier. The HR Administrator's C is
-- agency-configurable and the Auditor's R has no read-only form of this
-- permission yet, so neither is seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.registers.generate'
WHERE r."code" IN (
    'payroll_preparer', 'hr_certifier', 'budget_officer',
    'accounting_reviewer', 'payroll_approver', 'cashier'
  )
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" IN (
        'payroll_preparer', 'hr_certifier', 'budget_officer',
        'accounting_reviewer', 'payroll_approver', 'cashier'
      )
      AND p."code" = 'payroll.registers.generate'
  ) <> 6 THEN
    RAISE EXCEPTION 'Payroll Register permission grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'payroll_registers' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Payroll Register forced RLS verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_registers_mutation_trigger') THEN
    RAISE EXCEPTION 'Payroll Register mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; Payroll
-- Registers are retained payroll history.
-- Verification: pnpm db:policies payroll_registers
