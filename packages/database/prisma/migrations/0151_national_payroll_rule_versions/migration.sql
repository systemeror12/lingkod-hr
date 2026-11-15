-- Phase 9 National Payroll Rule Versions, Salary Grade rates, and the pay
-- component catalogue (#331), as payroll-schema.md §1 and §2 and ADR 0013
-- leave them. The tables are platform-wide: no `agency_id` and no Agency
-- policy. `hris_app` reads them; the `hris_operator` load command is the only
-- writer, and a loaded version is never edited or deleted.

CREATE TABLE "national_payroll_rule_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_kind" TEXT NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issuing_authority" TEXT NOT NULL,
  "issuance_reference" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "verified_on" DATE NOT NULL,
  "verified_by" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "supersedes_rule_version_id" UUID,
  "parameters" JSONB NOT NULL DEFAULT '{}',
  "loaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "national_payroll_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "national_payroll_rule_versions_rule_kind_check"
    CHECK ("rule_kind" IN ('SALARY_SCHEDULE')),
  CONSTRAINT "national_payroll_rule_versions_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "national_payroll_rule_versions_code_key" UNIQUE ("code"),
  CONSTRAINT "national_payroll_rule_versions_supersedes_key"
    UNIQUE ("supersedes_rule_version_id"),
  CONSTRAINT "national_payroll_rule_versions_supersedes_fkey"
    FOREIGN KEY ("supersedes_rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT
);

CREATE INDEX "national_payroll_rule_versions_kind_effective_idx"
  ON "national_payroll_rule_versions" ("rule_kind", "effective_from");

CREATE TABLE "salary_grade_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_version_id" UUID NOT NULL,
  "salary_grade" INTEGER NOT NULL,
  "salary_step" INTEGER NOT NULL,
  "monthly_rate" NUMERIC(19,4) NOT NULL,
  CONSTRAINT "salary_grade_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salary_grade_rates_salary_grade_check" CHECK ("salary_grade" > 0),
  CONSTRAINT "salary_grade_rates_salary_step_check" CHECK ("salary_step" > 0),
  CONSTRAINT "salary_grade_rates_monthly_rate_check" CHECK ("monthly_rate" > 0),
  CONSTRAINT "salary_grade_rates_rule_version_fkey"
    FOREIGN KEY ("rule_version_id")
    REFERENCES "national_payroll_rule_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "salary_grade_rates_version_grade_step_key"
    UNIQUE ("rule_version_id", "salary_grade", "salary_step")
);

CREATE TABLE "pay_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "is_conditional" BOOLEAN NOT NULL,
  "is_gaa_revalidated" BOOLEAN NOT NULL,
  "accepts_authorized_input" BOOLEAN NOT NULL,
  "reporting_category" TEXT,
  CONSTRAINT "pay_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pay_components_category_check"
    CHECK ("category" IN ('EARNING', 'DEDUCTION', 'EMPLOYER_SHARE', 'INFORMATIONAL')),
  CONSTRAINT "pay_components_code_key" UNIQUE ("code")
);

-- A version is immutable from load. A correction or a new issuance is a
-- successor row that names the version it supersedes.
CREATE OR REPLACE FUNCTION reject_national_payroll_rule_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable from load; load a successor version instead', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "national_payroll_rule_versions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "national_payroll_rule_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_national_payroll_rule_mutation();

CREATE TRIGGER "salary_grade_rates_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "salary_grade_rates"
  FOR EACH ROW EXECUTE FUNCTION reject_national_payroll_rule_mutation();

-- A rate belongs to a salary schedule and joins it only in the transaction
-- that loads the version, so a loaded schedule cannot gain rates later.
CREATE OR REPLACE FUNCTION guard_salary_grade_rate_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "national_payroll_rule_versions" v
    WHERE v."id" = NEW."rule_version_id"
      AND v."rule_kind" = 'SALARY_SCHEDULE'
      AND v."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Salary Grade rate joins a salary schedule only in the load that inserts the version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "salary_grade_rates_insert_trigger"
  BEFORE INSERT ON "salary_grade_rates"
  FOR EACH ROW EXECUTE FUNCTION guard_salary_grade_rate_insert();

-- The grant is the protection (ADR 0013). REVOKE first: the migrator's
-- default privileges would otherwise give `hris_app` INSERT and UPDATE.
REVOKE ALL ON TABLE "national_payroll_rule_versions", "salary_grade_rates", "pay_components"
  FROM hris_app;
GRANT SELECT ON TABLE "national_payroll_rule_versions", "salary_grade_rates", "pay_components"
  TO hris_app;
GRANT SELECT, INSERT ON TABLE "national_payroll_rule_versions", "salary_grade_rates", "pay_components"
  TO hris_operator;

-- Rollback/correction: only through a reviewed forward migration; payroll
-- snapshots reference these rows.
-- Verification: pnpm db:policies national_payroll_rule_versions
