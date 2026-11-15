-- Phase 9 basic salary calculation (#621), as payroll-schema.md §5, §7, §8,
-- and §10 have it. Starting a calculation moves a DRAFT period to
-- CALCULATING; the calculation job then writes one Payroll Employee Result per
-- Employee in scope, its Payroll Lines, and its Payroll Exceptions, and moves
-- the period to FOR_REVIEW, or back to DRAFT on a blocking exception or a
-- failure. Every row is written in the job's one transaction.
--
-- Columns a later calculator owns arrive with it: `payroll_lines.taxable_amount`
-- and `contribution_base` (#348, #350), `payroll_lines.payroll_adjustment_id`
-- (#330), `payroll_line_sources` (its first Payroll Input or Attendance Payroll
-- Fact source), and `payroll_holds`.

CREATE TABLE "payroll_employees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "employee_id" UUID NOT NULL,
  "compensation_basis_snapshot" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "gross_amount" NUMERIC(19,4) NOT NULL DEFAULT 0,
  "total_deductions" NUMERIC(19,4) NOT NULL DEFAULT 0,
  "net_amount" NUMERIC(19,4) NOT NULL DEFAULT 0,
  "calculation_hash" TEXT NOT NULL,
  CONSTRAINT "payroll_employees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_employees_calculation_version_check" CHECK ("calculation_version" > 0),
  CONSTRAINT "payroll_employees_status_check"
    CHECK ("status" IN ('PENDING', 'CALCULATED', 'EXCEPTION', 'REVIEWED', 'FINALIZED', 'VOIDED')),
  CONSTRAINT "payroll_employees_net_check"
    CHECK ("net_amount" = "gross_amount" - "total_deductions"),
  CONSTRAINT "payroll_employees_hash_check" CHECK ("calculation_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payroll_employees_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_employees_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_employees_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_employees_period_version_employee_key"
    UNIQUE ("payroll_period_id", "calculation_version", "employee_id"),
  CONSTRAINT "payroll_employees_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "payroll_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_employee_id" UUID NOT NULL,
  "pay_component_id" UUID NOT NULL,
  "rule_version_id" UUID,
  "line_type" TEXT NOT NULL,
  "quantity" NUMERIC(12,4),
  "rate" NUMERIC(19,8),
  "amount" NUMERIC(19,4) NOT NULL,
  "source_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_lines_line_type_check"
    CHECK ("line_type" IN ('EARNING', 'DEDUCTION', 'EMPLOYER_SHARE', 'INFORMATIONAL')),
  CONSTRAINT "payroll_lines_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_lines_payroll_employee_fkey"
    FOREIGN KEY ("agency_id", "payroll_employee_id")
    REFERENCES "payroll_employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_lines_pay_component_fkey"
    FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_lines_rule_version_fkey"
    FOREIGN KEY ("rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_lines_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "payroll_lines_payroll_employee_idx" ON "payroll_lines" ("agency_id", "payroll_employee_id");

CREATE TABLE "payroll_exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "employee_id" UUID,
  "exception_type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "reason" TEXT,
  "resolved_by_membership_id" UUID,
  CONSTRAINT "payroll_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_exceptions_calculation_version_check" CHECK ("calculation_version" > 0),
  CONSTRAINT "payroll_exceptions_type_check" CHECK (btrim("exception_type") <> ''),
  CONSTRAINT "payroll_exceptions_severity_check" CHECK ("severity" IN ('WARNING', 'BLOCKING')),
  CONSTRAINT "payroll_exceptions_status_check"
    CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  CONSTRAINT "payroll_exceptions_acknowledged_check"
    CHECK ("status" <> 'ACKNOWLEDGED' OR ("severity" = 'WARNING' AND btrim("reason") <> '')),
  CONSTRAINT "payroll_exceptions_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_exceptions_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_exceptions_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_exceptions_resolved_by_fkey"
    FOREIGN KEY ("agency_id", "resolved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_exceptions_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "payroll_exceptions_period_version_idx"
  ON "payroll_exceptions" ("agency_id", "payroll_period_id", "calculation_version");

-- A result and an exception are written only by the calculation of the
-- period's current version while it is CALCULATING, so a stale or repeated
-- job cannot add to a finished one. The UNIQUE key refuses a second result
-- for an Employee in one version.
CREATE OR REPLACE FUNCTION guard_payroll_calculation_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_periods" p
    WHERE p."agency_id" = NEW."agency_id"
      AND p."id" = NEW."payroll_period_id"
      AND p."status" = 'CALCULATING'
      AND p."calculation_version" = NEW."calculation_version"
  ) THEN
    RAISE EXCEPTION '% rows are written only by the running calculation of their version', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_employees_insert_trigger"
  BEFORE INSERT ON "payroll_employees"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_calculation_insert();

CREATE TRIGGER "payroll_exceptions_insert_trigger"
  BEFORE INSERT ON "payroll_exceptions"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_calculation_insert();

-- Results are append-only: once written, only `status` changes (§7).
CREATE OR REPLACE FUNCTION guard_payroll_employee_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Employee Results are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Only the status of a Payroll Employee Result changes'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_employees_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_employees"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_employee_mutation();

-- A line joins its result only in the transaction that writes the result, and
-- is never changed or deleted (§8).
CREATE OR REPLACE FUNCTION guard_payroll_line_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_employees" e
    WHERE e."agency_id" = NEW."agency_id"
      AND e."id" = NEW."payroll_employee_id"
      AND e."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Payroll Line joins its result only in the transaction that writes it'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_lines_insert_trigger"
  BEFORE INSERT ON "payroll_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_line_insert();

CREATE TRIGGER "payroll_lines_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- An exception is retained. Acknowledging or resolving one arrives with its
-- command, which grants UPDATE.
CREATE OR REPLACE FUNCTION reject_payroll_exception_delete()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION 'Payroll Exceptions are retained and cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "payroll_exceptions_delete_trigger"
  BEFORE DELETE ON "payroll_exceptions"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_exception_delete();

-- REVOKE first: the migrator's default privileges would give `hris_app` UPDATE.
REVOKE ALL ON TABLE "payroll_employees", "payroll_lines", "payroll_exceptions" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_employees", "payroll_lines", "payroll_exceptions" TO hris_app;

ALTER TABLE "payroll_employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_employees" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_exceptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payroll_employees_select" ON "payroll_employees"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_employees_insert" ON "payroll_employees"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_lines_select" ON "payroll_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_lines_insert" ON "payroll_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_exceptions_select" ON "payroll_exceptions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_exceptions_insert" ON "payroll_exceptions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- The calculation job runs with no Agency Context, so payroll_calculations_due
-- returns every CALCULATING period across Agencies, a deliberate exception to
-- Agency isolation like attendance_deficit_charge_agencies. It is SECURITY
-- DEFINER, reading through the owner's policy below, returns only identifiers
-- and the version, takes no HTTP input, and each calculation then runs under
-- its own Agency's context.
CREATE POLICY "payroll_periods_calculations_due_select" ON "payroll_periods"
  FOR SELECT TO CURRENT_USER
  USING ("status" = 'CALCULATING');

CREATE OR REPLACE FUNCTION payroll_calculations_due()
RETURNS TABLE ("agency_id" UUID, "payroll_period_id" UUID, "calculation_version" INTEGER)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p."agency_id", p."id", p."calculation_version"
  FROM "payroll_periods" p
  WHERE p."status" = 'CALCULATING'
  ORDER BY p."agency_id", p."id"
$$;

REVOKE ALL ON FUNCTION payroll_calculations_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payroll_calculations_due() TO hris_app;

-- The basic salary Native Payroll Component (BRD PAY-003). Its rates are the
-- SALARY_SCHEDULE rule kind; it needs no Agency Payroll Applicability and
-- takes no Authorized Payroll Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('BASIC_SALARY', 'Basic salary', 'EARNING', false, false, false)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.periods.calculate', 'payroll', 'HIGH',
  'Start the calculation of a DRAFT Payroll Period'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.periods.calculate` to the Payroll Preparer only.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.periods.calculate'
WHERE r."code" = 'payroll_preparer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_class
    WHERE relname IN ('payroll_employees', 'payroll_lines', 'payroll_exceptions')
      AND relforcerowsecurity
  ) <> 3 THEN
    RAISE EXCEPTION 'Payroll calculation forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_employees_insert_trigger', 'payroll_employees_mutation_trigger',
                     'payroll_lines_insert_trigger', 'payroll_lines_immutable_trigger',
                     'payroll_exceptions_insert_trigger', 'payroll_exceptions_delete_trigger')
  ) <> 6 THEN
    RAISE EXCEPTION 'Payroll calculation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; results,
-- lines, and exceptions are retained payroll history.
-- Verification: pnpm db:policies payroll_employees
