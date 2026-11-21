-- Phase 9 Payslips (#336), as payroll-schema.md §12 and hris-controls.md §5.21
-- have them. After a Payroll Period is finalized, the system generates one
-- Payslip per FINALIZED Payroll Employee Result: the row is inserted
-- GENERATING, its PDF is stored through the shared document service, and it
-- becomes READY naming that Document. A Payslip states one finalized result,
-- is not proof of payment, and is never reissued, so there is no version.
--
-- Release, withholding, and the Employee's read arrive with #640, and
-- supersession with the void command. Their columns are here as §12 defines
-- them, but nothing may write them yet: hris_app may UPDATE only `status` and
-- `document_id`, and the guard admits only GENERATING → READY.

CREATE TABLE "payslips" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_employee_id" UUID NOT NULL,
  "document_id" UUID,
  "status" TEXT NOT NULL,
  "released_at" TIMESTAMPTZ(6),
  "released_by_membership_id" UUID,
  "withheld_at" TIMESTAMPTZ(6),
  "withheld_by_membership_id" UUID,
  "withhold_reason" TEXT,
  CONSTRAINT "payslips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payslips_status_check"
    CHECK ("status" IN ('GENERATING', 'READY', 'RELEASED', 'WITHHELD', 'SUPERSEDED')),
  CONSTRAINT "payslips_released_check"
    CHECK (("released_at" IS NULL) = ("released_by_membership_id" IS NULL)),
  CONSTRAINT "payslips_withheld_check"
    CHECK (("withheld_at" IS NULL) = ("withheld_by_membership_id" IS NULL)),
  CONSTRAINT "payslips_withhold_reason_check"
    CHECK ("withheld_at" IS NULL OR btrim("withhold_reason") <> ''),
  CONSTRAINT "payslips_released_status_check"
    CHECK ("status" <> 'RELEASED' OR "released_at" IS NOT NULL),
  CONSTRAINT "payslips_withheld_status_check"
    CHECK ("status" <> 'WITHHELD' OR "withheld_at" IS NOT NULL),
  -- Only a Payslip still generating, or one superseded before its file was
  -- stored, has no Document.
  CONSTRAINT "payslips_document_check"
    CHECK ("status" IN ('GENERATING', 'SUPERSEDED') OR "document_id" IS NOT NULL),
  CONSTRAINT "payslips_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payslips_payroll_employee_fkey"
    FOREIGN KEY ("agency_id", "payroll_employee_id")
    REFERENCES "payroll_employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payslips_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payslips_released_by_fkey"
    FOREIGN KEY ("agency_id", "released_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payslips_withheld_by_fkey"
    FOREIGN KEY ("agency_id", "withheld_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One Payslip per finalized result: generating again finds it.
  CONSTRAINT "payslips_payroll_employee_id_key" UNIQUE ("payroll_employee_id")
);

-- A Payslip is generated only for a FINALIZED result, and starts GENERATING
-- with nothing released or withheld. It is never deleted. The one change
-- admitted is GENERATING → READY, naming its Document once; #640 and the void
-- command replace this guard as they add release, withholding, and
-- supersession.
CREATE OR REPLACE FUNCTION guard_payslip_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payslips are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'GENERATING'
       OR NEW."document_id" IS NOT NULL
       OR NEW."released_at" IS NOT NULL
       OR NEW."withheld_at" IS NOT NULL
       OR NEW."withhold_reason" IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM "payroll_employees" r
         WHERE r."agency_id" = NEW."agency_id"
           AND r."id" = NEW."payroll_employee_id"
           AND r."status" = 'FINALIZED'
       ) THEN
      RAISE EXCEPTION 'A Payslip is generated, GENERATING, only for a FINALIZED Payroll Employee Result'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'document_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'document_id')
     OR OLD."status" <> 'GENERATING'
     OR NEW."status" <> 'READY'
     OR OLD."document_id" IS NOT NULL
     OR NEW."document_id" IS NULL THEN
    RAISE EXCEPTION 'A Payslip changes only from GENERATING to READY, naming its Document once'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payslips_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payslips"
  FOR EACH ROW EXECUTE FUNCTION guard_payslip_mutation();

REVOKE ALL ON TABLE "payslips" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payslips" TO hris_app;
GRANT UPDATE ("status", "document_id") ON TABLE "payslips" TO hris_app;

ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payslips" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payslips_select" ON "payslips"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payslips_insert" ON "payslips"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payslips_update" ON "payslips"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

-- The generation job runs with no Agency Context, so payslips_due returns
-- each finalized period, from its PAYROLL_PERIOD_FINALIZED Outbox Event, that
-- has a FINALIZED result with no Payslip past GENERATING: a deliberate
-- exception to Agency isolation like payroll_calculations_due. It is SECURITY
-- DEFINER, reading through the owner's policies below, returns only
-- identifiers, takes no HTTP input, and each period's generation then runs
-- under its own Agency's context.
CREATE POLICY "outbox_events_payslips_due_select" ON "outbox_events"
  FOR SELECT TO CURRENT_USER
  USING ("event_type" = 'PAYROLL_PERIOD_FINALIZED');
CREATE POLICY "payroll_employees_payslips_due_select" ON "payroll_employees"
  FOR SELECT TO CURRENT_USER
  USING ("status" = 'FINALIZED');
CREATE POLICY "payslips_due_select" ON "payslips"
  FOR SELECT TO CURRENT_USER
  USING ("status" <> 'GENERATING');

CREATE OR REPLACE FUNCTION payslips_due()
RETURNS TABLE ("agency_id" UUID, "payroll_period_id" UUID)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o."agency_id", o."aggregate_id"
  FROM "outbox_events" o
  WHERE o."event_type" = 'PAYROLL_PERIOD_FINALIZED'
    AND EXISTS (
      SELECT 1
      FROM "payroll_employees" r
      WHERE r."agency_id" = o."agency_id"
        AND r."payroll_period_id" = o."aggregate_id"
        AND r."status" = 'FINALIZED'
        AND NOT EXISTS (
          SELECT 1
          FROM "payslips" s
          WHERE s."payroll_employee_id" = r."id" AND s."status" <> 'GENERATING'
        )
    )
  ORDER BY o."agency_id", o."aggregate_id"
$$;

REVOKE ALL ON FUNCTION payslips_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payslips_due() TO hris_app;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'payslips' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Payslip forced RLS verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payslips_mutation_trigger') THEN
    RAISE EXCEPTION 'Payslip mutation guard verification failed';
  END IF;
END;
$$;
