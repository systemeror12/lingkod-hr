-- Phase 9 Payroll Input inbox (#338), as payroll-schema.md §4 has it. Leave
-- and Overtime post one idempotent input per source effect, inside their own
-- transaction, through the Payroll application service. The source names an
-- input kind and its own stable effect key, never a pay component or a rate.
-- An input belongs to no period when accepted; finalization later marks it
-- consumed (ADR 0014).
--
-- `consumed_by_payroll_period_id` keeps its column and its CHECK, but its
-- FOREIGN KEY to `payroll_periods (agency_id, id)` waits for the migration that
-- creates `payroll_periods` (§5). No input can be consumed before then.

CREATE TABLE "payroll_inputs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "source_module" TEXT NOT NULL,
  "input_kind" TEXT NOT NULL,
  "source_key" CITEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "effective_date" DATE NOT NULL,
  "quantity" NUMERIC(12,4),
  "amount" NUMERIC(19,4),
  "status" TEXT NOT NULL,
  "payload_snapshot" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "consumed_by_payroll_period_id" UUID,
  "replaces_payroll_input_id" UUID,
  CONSTRAINT "payroll_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_inputs_source_module_check"
    CHECK ("source_module" IN ('LEAVE', 'OVERTIME')),
  CONSTRAINT "payroll_inputs_input_kind_check"
    CHECK ("input_kind" IN (
      'LEAVE_WITHOUT_PAY', 'UNPAID_DEFICIT_REMAINDER', 'MONETIZATION_EARNING', 'OVERTIME_HOURS'
    )),
  CONSTRAINT "payroll_inputs_status_check"
    CHECK ("status" IN ('PENDING', 'CONSUMED', 'CANCELLED')),
  CONSTRAINT "payroll_inputs_amount_check"
    CHECK (("input_kind" = 'MONETIZATION_EARNING') = ("amount" IS NOT NULL)),
  CONSTRAINT "payroll_inputs_overtime_kind_check"
    CHECK (("input_kind" = 'OVERTIME_HOURS') = ("source_module" = 'OVERTIME')),
  CONSTRAINT "payroll_inputs_consumed_check"
    CHECK (("status" = 'CONSUMED') = ("consumed_by_payroll_period_id" IS NOT NULL)),
  CONSTRAINT "payroll_inputs_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_inputs_agency_id_employee_id_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_inputs_agency_id_replaces_payroll_input_id_fkey"
    FOREIGN KEY ("agency_id", "replaces_payroll_input_id")
    REFERENCES "payroll_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_inputs_agency_id_source_module_source_key_key"
    UNIQUE ("agency_id", "source_module", "source_key"),
  CONSTRAINT "payroll_inputs_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "payroll_inputs_source_status_idx"
  ON "payroll_inputs" ("agency_id", "source_module", "status", "accepted_at");

-- An input is accepted `PENDING`. After acceptance only `status` and
-- `consumed_by_payroll_period_id` change: finalization consumes a `PENDING`
-- input, a source withdrawal cancels one, and a voided payroll returns its
-- consumed inputs to `PENDING`. A cancelled input is final, and none is deleted.
CREATE OR REPLACE FUNCTION guard_payroll_input_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Inputs are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'A Payroll Input is accepted as PENDING'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'consumed_by_payroll_period_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'consumed_by_payroll_period_id') THEN
    RAISE EXCEPTION 'An accepted Payroll Input changes only its status and consuming period'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('CONSUMED', 'CANCELLED'))
    OR (OLD."status" = 'CONSUMED' AND NEW."status" = 'PENDING')
  ) THEN
    RAISE EXCEPTION 'A Payroll Input cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_inputs_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_inputs"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_input_mutation();

-- Acceptance only inserts. The consuming and withdrawing tickets (#626, #357)
-- grant UPDATE with its Agency policy.
GRANT SELECT, INSERT ON TABLE "payroll_inputs" TO hris_app;

ALTER TABLE "payroll_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_inputs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payroll_inputs_select" ON "payroll_inputs"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_inputs_insert" ON "payroll_inputs"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES ('payroll.inputs.read', 'payroll', 'MEDIUM', 'Read Payroll Inputs posted by source modules')
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 grants `payroll.inputs.read` to the Payroll Preparer,
-- HR Certifier, Budget Officer, Accounting Reviewer, Payroll Approver, and
-- Auditor. Only the roles below exist yet; HR Admin's grant is agency-configurable.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.inputs.read'
WHERE r."code" IN ('payroll_preparer', 'budget_officer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_inputs_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Payroll Input mutation guard verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'payroll_inputs' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Payroll Input forced RLS verification failed';
  END IF;
END;
$$;
