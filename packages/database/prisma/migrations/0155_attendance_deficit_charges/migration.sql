-- Phase 9 Attendance Deficit Charges (#340, ADR 0012), as
-- attendance-and-leave-schema.md §8 has them. Leave charges each TARDINESS or
-- UNDERTIME Attendance Payroll Fact once through CSC MC No. 41, s. 1998,
-- Table II, posts the covered part to the vacation Leave Account, and sends
-- the Unpaid Deficit Remainder to Payroll as one Payroll Input. A fact Leave
-- cannot convert has no row; Leave derives it, with its reason, on read.

CREATE TABLE "attendance_deficit_charges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "attendance_payroll_fact_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "deficit_type" TEXT NOT NULL,
  "deficit_minutes" INTEGER NOT NULL,
  "expected_minutes" INTEGER NOT NULL,
  "leave_account_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "converted_quantity" NUMERIC(12,4) NOT NULL,
  "charged_quantity" NUMERIC(12,4) NOT NULL,
  "unpaid_quantity" NUMERIC(12,4) NOT NULL,
  "leave_ledger_entry_id" UUID,
  "payroll_input_id" UUID,
  "supersedes_charge_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_deficit_charges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_deficit_charges_deficit_type_check"
    CHECK ("deficit_type" IN ('TARDINESS', 'UNDERTIME')),
  CONSTRAINT "attendance_deficit_charges_deficit_minutes_check"
    CHECK ("deficit_minutes" BETWEEN 0 AND 480),
  -- Table II covers only an eight-hour day (ADR 0012, #654).
  CONSTRAINT "attendance_deficit_charges_expected_minutes_check"
    CHECK ("expected_minutes" = 480),
  CONSTRAINT "attendance_deficit_charges_quantities_check"
    CHECK (
      "converted_quantity" >= 0 AND "charged_quantity" >= 0 AND "unpaid_quantity" >= 0
      AND "converted_quantity" = "charged_quantity" + "unpaid_quantity"
      AND "converted_quantity" = round("converted_quantity", 3)
      AND "charged_quantity" = round("charged_quantity", 3)
    ),
  CONSTRAINT "attendance_deficit_charges_ledger_entry_check"
    CHECK (("charged_quantity" > 0) = ("leave_ledger_entry_id" IS NOT NULL)),
  CONSTRAINT "attendance_deficit_charges_payroll_input_check"
    CHECK (("unpaid_quantity" > 0) = ("payroll_input_id" IS NOT NULL)),
  CONSTRAINT "attendance_deficit_charges_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_fact_fkey"
    FOREIGN KEY ("agency_id", "attendance_payroll_fact_id")
    REFERENCES "attendance_payroll_facts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_policy_version_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_ledger_entry_fkey"
    FOREIGN KEY ("agency_id", "leave_ledger_entry_id")
    REFERENCES "leave_ledger_entries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_payroll_input_fkey"
    FOREIGN KEY ("agency_id", "payroll_input_id")
    REFERENCES "payroll_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_charge_id")
    REFERENCES "attendance_deficit_charges"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_deficit_charges_fact_key"
    UNIQUE ("agency_id", "attendance_payroll_fact_id"),
  CONSTRAINT "attendance_deficit_charges_supersedes_key"
    UNIQUE ("agency_id", "supersedes_charge_id"),
  CONSTRAINT "attendance_deficit_charges_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_deficit_charges_employee_date_idx"
  ON "attendance_deficit_charges" ("agency_id", "employee_id", "work_date");

-- A successor names the charge it replaced for the same Employee, Work Date,
-- and deficit type. Rows are immutable once written.
CREATE OR REPLACE FUNCTION guard_attendance_deficit_charge_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  predecessor "attendance_deficit_charges"%ROWTYPE;
BEGIN
  IF NEW."supersedes_charge_id" IS NOT NULL THEN
    SELECT * INTO predecessor
    FROM "attendance_deficit_charges"
    WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."supersedes_charge_id";

    IF NOT FOUND
       OR predecessor."employee_id" <> NEW."employee_id"
       OR predecessor."work_date" <> NEW."work_date"
       OR predecessor."deficit_type" <> NEW."deficit_type" THEN
      RAISE EXCEPTION 'A successor Attendance Deficit Charge must replace a charge for the same Employee, Work Date, and deficit type'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_deficit_charges_insert_trigger"
  BEFORE INSERT ON "attendance_deficit_charges"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_deficit_charge_insert();

CREATE TRIGGER "attendance_deficit_charges_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_deficit_charges"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

GRANT SELECT, INSERT ON TABLE "attendance_deficit_charges" TO hris_app;

ALTER TABLE "attendance_deficit_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_deficit_charges" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attendance_deficit_charges_select" ON "attendance_deficit_charges"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_deficit_charges_insert" ON "attendance_deficit_charges"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- An adjustment publication withdraws the earlier charge's Payroll Input
-- (payroll-schema.md §4): a PENDING input becomes CANCELLED, which the
-- existing mutation guard already allows. Withdrawal of a consumed input is
-- Payroll's (#649) and is refused by the service.
GRANT UPDATE ON TABLE "payroll_inputs" TO hris_app;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'payroll_inputs' AND policyname = 'payroll_inputs_update'
  ) THEN
    CREATE POLICY "payroll_inputs_update" ON "payroll_inputs"
      FOR UPDATE USING ("agency_id" = app_agency_id())
      WITH CHECK ("agency_id" = app_agency_id());
  END IF;
END;
$$;

-- The charge consumes each Attendance Period Lock's outbox event. The
-- consumer runs with no Agency Context, so attendance_deficit_charge_agencies
-- returns the Agencies that have one, a deliberate exception to Agency
-- isolation like coc_expiries_due. It is SECURITY DEFINER, reading through the
-- owner's policy below, returns only Agency identifiers, takes no HTTP input,
-- and each charge then runs under its own Agency's context. A Locked
-- Attendance Adjustment publishes only in an Agency that already locked.
CREATE POLICY "outbox_events_deficit_charge_agencies_select" ON "outbox_events"
  FOR SELECT TO CURRENT_USER
  USING ("event_type" = 'ATTENDANCE_PERIOD_LOCKED');

CREATE OR REPLACE FUNCTION attendance_deficit_charge_agencies()
RETURNS TABLE ("agency_id" UUID)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT o."agency_id"
  FROM "outbox_events" o
  WHERE o."event_type" = 'ATTENDANCE_PERIOD_LOCKED'
$$;

REVOKE ALL ON FUNCTION attendance_deficit_charge_agencies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendance_deficit_charge_agencies() TO hris_app;

-- hris-controls.md §6.8: `leave.deficit_charges.read` is Leave Admin A, HR
-- Admin A, HR Certifier R, Approving Official R, Payroll Preparer R, and
-- Auditor R; `leave.deficit_charges.run` is Leave Admin A and HR Admin C. The
-- read is a per-publication Agency view, so the Supervisor S and Employee O
-- columns get no grant until an Employee-scoped view exists.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.deficit_charges.read', 'leave', 'MEDIUM', 'Read Attendance Deficit Charges and uncharged deficit facts'),
  ('leave.deficit_charges.run', 'leave', 'HIGH', 'Rerun the Attendance Deficit Charge of an Attendance Payroll Publication')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.deficit_charges.read'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'payroll_preparer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.deficit_charges.run'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_deficit_charges_append_only_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance Deficit Charge immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'attendance_deficit_charges' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Attendance Deficit Charge forced RLS verification failed';
  END IF;
END;
$$;

-- Rollback/correction: drop the table, both functions, the outbox policy, and
-- the payroll_inputs update policy and grant. Ledger entries and Payroll
-- Inputs the charges wrote stay.
