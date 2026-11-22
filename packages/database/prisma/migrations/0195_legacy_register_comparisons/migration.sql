-- Phase 9 Legacy Register Comparison (#359), as payroll-schema.md §12 has it.
-- A Payroll Preparer imports a legacy payroll register for one FINALIZED
-- Payroll Period, one amount per Employee and pay component, and LingkodHR
-- records where it differs from the finalized Payroll Lines. The comparison
-- only reports: it decides neither value is right, and it writes only these
-- two tables and its Audit Event, never a payroll table.
--
-- A difference stores both values. A value is NULL where its side has no
-- amount for that Employee and component. Matching amounts are not stored.

CREATE TABLE "legacy_register_comparisons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "content_hash" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL,
  "compared_by_membership_id" UUID NOT NULL,
  "compared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "legacy_register_comparisons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legacy_register_comparisons_content_hash_check"
    CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "legacy_register_comparisons_row_count_check" CHECK ("row_count" > 0),
  CONSTRAINT "legacy_register_comparisons_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "legacy_register_comparisons_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "legacy_register_comparisons_compared_by_fkey"
    FOREIGN KEY ("agency_id", "compared_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- The same file compared with the same finalized payroll gives the same
  -- differences, so importing it again returns the stored comparison.
  CONSTRAINT "legacy_register_comparisons_period_content_key"
    UNIQUE ("payroll_period_id", "content_hash"),
  CONSTRAINT "legacy_register_comparisons_agency_id_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "legacy_register_differences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "legacy_register_comparison_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "pay_component_id" UUID NOT NULL,
  "legacy_amount" DECIMAL(19, 4),
  "payroll_amount" DECIMAL(19, 4),
  CONSTRAINT "legacy_register_differences_pkey" PRIMARY KEY ("id"),
  -- A difference: the two values differ, and at least one side has one.
  CONSTRAINT "legacy_register_differences_differs_check"
    CHECK ("legacy_amount" IS DISTINCT FROM "payroll_amount"),
  CONSTRAINT "legacy_register_differences_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "legacy_register_differences_comparison_fkey"
    FOREIGN KEY ("agency_id", "legacy_register_comparison_id")
    REFERENCES "legacy_register_comparisons"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "legacy_register_differences_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "legacy_register_differences_pay_component_fkey"
    FOREIGN KEY ("pay_component_id") REFERENCES "pay_components"("id") ON DELETE RESTRICT,
  CONSTRAINT "legacy_register_differences_comparison_employee_component_key"
    UNIQUE ("legacy_register_comparison_id", "employee_id", "pay_component_id"),
  CONSTRAINT "legacy_register_differences_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A comparison is written only for a FINALIZED period at its finalized
-- version, and is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_legacy_register_comparison_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Legacy Register Comparisons are immutable and retained'
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
    RAISE EXCEPTION 'A Legacy Register Comparison is made only against a FINALIZED payroll at its finalized version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "legacy_register_comparisons_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "legacy_register_comparisons"
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_register_comparison_mutation();

-- A difference is written only in the transaction that writes its
-- comparison, and is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_legacy_register_difference_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Legacy Register Differences are immutable and retained'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "legacy_register_comparisons" c
    WHERE c."agency_id" = NEW."agency_id"
      AND c."id" = NEW."legacy_register_comparison_id"
      AND c."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'A Legacy Register Difference is written only with its new comparison'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "legacy_register_differences_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "legacy_register_differences"
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_register_difference_mutation();

REVOKE ALL ON TABLE "legacy_register_comparisons" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "legacy_register_comparisons" TO hris_app;
REVOKE ALL ON TABLE "legacy_register_differences" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "legacy_register_differences" TO hris_app;

ALTER TABLE "legacy_register_comparisons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_register_comparisons" FORCE ROW LEVEL SECURITY;
CREATE POLICY "legacy_register_comparisons_select" ON "legacy_register_comparisons"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "legacy_register_comparisons_insert" ON "legacy_register_comparisons"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "legacy_register_differences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_register_differences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "legacy_register_differences_select" ON "legacy_register_differences"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "legacy_register_differences_insert" ON "legacy_register_differences"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.legacy_registers.compare', 'payroll', 'HIGH',
  'Compare a FINALIZED Payroll Period against a legacy payroll register, and read its comparisons'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks `payroll.legacy_registers.compare` A for the
-- Payroll Preparer only, from #12's story 12.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.legacy_registers.compare'
WHERE r."code" = 'payroll_preparer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'payroll_preparer'
      AND p."code" = 'payroll.legacy_registers.compare'
  ) <> 1 THEN
    RAISE EXCEPTION 'Legacy Register Comparison permission grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_class
    WHERE relname IN ('legacy_register_comparisons', 'legacy_register_differences')
      AND relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Legacy Register Comparison forced RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('legacy_register_comparisons_mutation_trigger',
                     'legacy_register_differences_mutation_trigger')
  ) <> 2 THEN
    RAISE EXCEPTION 'Legacy Register Comparison mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; comparisons
-- are retained payroll review history.
-- Verification: pnpm db:policies legacy_register_comparisons
-- Verification: pnpm db:policies legacy_register_differences
