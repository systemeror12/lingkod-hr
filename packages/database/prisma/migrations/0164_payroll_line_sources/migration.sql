-- Phase 9 salary for days without pay (#341), as payroll-schema.md §8 has it.
-- The first Payroll Lines that rest on Payroll Inputs and Attendance Payroll
-- Facts: leave without pay and whole-day absence, valued at the monthly salary
-- in effect on their Work Dates ÷ 22 (CSC MC No. 8, s. 2014; ADR 0014).
--
-- `payroll_line_sources` links a line to the sources behind it; a line can
-- rest on several sources, and one source on several lines.
-- `payroll_consumed_attendance_facts` is Payroll's record that a finalized
-- payroll consumed a fact. The calculation reads it to skip consumed facts;
-- finalization, its only writer, grants itself INSERT and UPDATE when it
-- arrives.

CREATE TABLE "payroll_line_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_line_id" UUID NOT NULL,
  "payroll_input_id" UUID,
  "attendance_payroll_fact_id" UUID,
  "authorized_payroll_component_input_id" UUID,
  CONSTRAINT "payroll_line_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_line_sources_one_source_check"
    CHECK (num_nonnulls("payroll_input_id", "attendance_payroll_fact_id",
                        "authorized_payroll_component_input_id") = 1),
  CONSTRAINT "payroll_line_sources_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_line_sources_line_fkey"
    FOREIGN KEY ("agency_id", "payroll_line_id")
    REFERENCES "payroll_lines"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_line_sources_input_fkey"
    FOREIGN KEY ("agency_id", "payroll_input_id")
    REFERENCES "payroll_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_line_sources_fact_fkey"
    FOREIGN KEY ("agency_id", "attendance_payroll_fact_id")
    REFERENCES "attendance_payroll_facts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_line_sources_authorized_input_fkey"
    FOREIGN KEY ("agency_id", "authorized_payroll_component_input_id")
    REFERENCES "authorized_payroll_component_inputs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_line_sources_line_input_key" UNIQUE ("payroll_line_id", "payroll_input_id"),
  CONSTRAINT "payroll_line_sources_line_fact_key"
    UNIQUE ("payroll_line_id", "attendance_payroll_fact_id"),
  CONSTRAINT "payroll_line_sources_line_authorized_input_key"
    UNIQUE ("payroll_line_id", "authorized_payroll_component_input_id")
);

CREATE INDEX "payroll_line_sources_input_idx"
  ON "payroll_line_sources" ("agency_id", "payroll_input_id");
CREATE INDEX "payroll_line_sources_fact_idx"
  ON "payroll_line_sources" ("agency_id", "attendance_payroll_fact_id");

CREATE TABLE "payroll_consumed_attendance_facts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_payroll_fact_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "released_at" TIMESTAMPTZ(6),
  CONSTRAINT "payroll_consumed_attendance_facts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_consumed_attendance_facts_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_consumed_attendance_facts_fact_fkey"
    FOREIGN KEY ("agency_id", "attendance_payroll_fact_id")
    REFERENCES "attendance_payroll_facts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_consumed_attendance_facts_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT
);

-- A second finalization of the same fact fails here (ADR 0014).
CREATE UNIQUE INDEX "payroll_consumed_attendance_facts_one_live_key"
  ON "payroll_consumed_attendance_facts" ("agency_id", "attendance_payroll_fact_id")
  WHERE "released_at" IS NULL;

-- A source joins its line only in the transaction that writes the line, and is
-- never changed or deleted (§8).
CREATE OR REPLACE FUNCTION guard_payroll_line_source_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_lines" l
    WHERE l."agency_id" = NEW."agency_id"
      AND l."id" = NEW."payroll_line_id"
      AND l."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Payroll Line Source joins its line only in the transaction that writes it'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_line_sources_insert_trigger"
  BEFORE INSERT ON "payroll_line_sources"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_line_source_insert();

CREATE TRIGGER "payroll_line_sources_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "payroll_line_sources"
  FOR EACH ROW EXECUTE FUNCTION reject_payroll_record_mutation();

-- REVOKE first: the migrator's default privileges would give `hris_app` UPDATE.
REVOKE ALL ON TABLE "payroll_line_sources", "payroll_consumed_attendance_facts" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_line_sources" TO hris_app;
GRANT SELECT ON TABLE "payroll_consumed_attendance_facts" TO hris_app;

ALTER TABLE "payroll_line_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_line_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_consumed_attendance_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_consumed_attendance_facts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payroll_line_sources_select" ON "payroll_line_sources"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_line_sources_insert" ON "payroll_line_sources"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_consumed_attendance_facts_select" ON "payroll_consumed_attendance_facts"
  FOR SELECT USING ("agency_id" = app_agency_id());

-- The days-without-pay Native Payroll Component (#341). Its rate is the
-- SALARY_SCHEDULE rule kind of each Work Date; it needs no Agency Payroll
-- Applicability and takes no Authorized Payroll Component Input.
INSERT INTO "pay_components" (
  "code", "name", "category", "is_conditional", "is_gaa_revalidated", "accepts_authorized_input"
)
VALUES ('DAYS_WITHOUT_PAY', 'Salary for days without pay', 'DEDUCTION', false, false, false)
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_class
    WHERE relname IN ('payroll_line_sources', 'payroll_consumed_attendance_facts')
      AND relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Payroll line source forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_line_sources_insert_trigger', 'payroll_line_sources_immutable_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Payroll line source guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; line sources
-- are retained payroll history.
-- Verification: pnpm db:policies payroll_line_sources
