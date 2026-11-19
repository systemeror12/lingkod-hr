-- Phase 9 Payroll Export Checkpoint Reviews (#637), as payroll-schema.md §12
-- has it. A Budget Officer and an Accounting Reviewer each record one
-- immutable review against the current Certified Payroll Review Export while
-- its period is CERTIFIED: they confirm that exact snapshot, with the external
-- reference and evidence, or return it with a reason (#29, #330). A review is
-- in force while its export is current, so superseding the export revokes its
-- reviews and nothing on the review changes. The period status moves are
-- already allowed by migration 0153's guard.

CREATE TABLE "payroll_export_checkpoint_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "certified_payroll_review_export_id" UUID NOT NULL,
  "checkpoint" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "external_reference" TEXT,
  "evidence_document_version_id" UUID,
  "reason" TEXT,
  "reviewed_by_membership_id" UUID NOT NULL,
  "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_export_checkpoint_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_export_checkpoint_reviews_checkpoint_check"
    CHECK ("checkpoint" IN ('BUDGET', 'ACCOUNTING')),
  CONSTRAINT "payroll_export_checkpoint_reviews_outcome_check"
    CHECK ("outcome" IN ('CONFIRMED', 'RETURNED')),
  CONSTRAINT "payroll_export_checkpoint_reviews_external_reference_check"
    CHECK ("external_reference" IS NULL OR btrim("external_reference") <> ''),
  -- A confirmation names the external reference and its evidence; a return
  -- gives its reason, and only a return has one.
  CONSTRAINT "payroll_export_checkpoint_reviews_confirmed_check"
    CHECK ("outcome" <> 'CONFIRMED'
           OR ("external_reference" IS NOT NULL AND "evidence_document_version_id" IS NOT NULL)),
  CONSTRAINT "payroll_export_checkpoint_reviews_reason_check"
    CHECK (("outcome" = 'RETURNED') = ("reason" IS NOT NULL)
           AND ("reason" IS NULL OR btrim("reason") <> '')),
  CONSTRAINT "payroll_export_checkpoint_reviews_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_export_checkpoint_reviews_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_export_checkpoint_reviews_export_fkey"
    FOREIGN KEY ("agency_id", "certified_payroll_review_export_id")
    REFERENCES "certified_payroll_review_exports"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_export_checkpoint_reviews_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_export_checkpoint_reviews_reviewed_by_fkey"
    FOREIGN KEY ("agency_id", "reviewed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- One review of each checkpoint per export.
  CONSTRAINT "payroll_export_checkpoint_reviews_export_checkpoint_key"
    UNIQUE ("certified_payroll_review_export_id", "checkpoint")
);

CREATE INDEX "payroll_export_checkpoint_reviews_period_idx"
  ON "payroll_export_checkpoint_reviews" ("agency_id", "payroll_period_id");

-- A review is written only against the current export of its period, while
-- the period is CERTIFIED. It is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_payroll_export_checkpoint_review_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payroll Export Checkpoint Reviews are immutable and cannot be changed or deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "certified_payroll_review_exports" e
    JOIN "payroll_periods" p
      ON p."agency_id" = e."agency_id" AND p."id" = e."payroll_period_id"
    WHERE e."agency_id" = NEW."agency_id"
      AND e."id" = NEW."certified_payroll_review_export_id"
      AND e."payroll_period_id" = NEW."payroll_period_id"
      AND e."superseded_at" IS NULL
      AND p."status" = 'CERTIFIED'
  ) THEN
    RAISE EXCEPTION 'A Payroll Export Checkpoint Review is recorded only against the current export of a CERTIFIED Payroll Period'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_export_checkpoint_reviews_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_export_checkpoint_reviews"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_export_checkpoint_review_mutation();

REVOKE ALL ON TABLE "payroll_export_checkpoint_reviews" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_export_checkpoint_reviews" TO hris_app;

ALTER TABLE "payroll_export_checkpoint_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_export_checkpoint_reviews" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payroll_export_checkpoint_reviews_select" ON "payroll_export_checkpoint_reviews"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_export_checkpoint_reviews_insert" ON "payroll_export_checkpoint_reviews"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('payroll.periods.review_funding', 'payroll', 'HIGH',
   'Confirm or return the Budget checkpoint review of a CERTIFIED Payroll Period''s Certified Payroll Review Export'),
  ('payroll.periods.review_accounting', 'payroll', 'HIGH',
   'Confirm or return the Accounting checkpoint review of a CERTIFIED Payroll Period''s Certified Payroll Review Export')
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks each A for exactly one role.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM (VALUES
  ('budget_officer', 'payroll.periods.review_funding'),
  ('accounting_reviewer', 'payroll.periods.review_accounting')
) AS grants ("role_code", "permission_code")
JOIN "roles" r ON r."code" = grants."role_code" AND r."agency_id" IS NULL
JOIN "permissions" p ON p."code" = grants."permission_code"
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'payroll_export_checkpoint_reviews' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Payroll Export Checkpoint Review forced RLS verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_export_checkpoint_reviews_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Payroll Export Checkpoint Review mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; checkpoint
-- reviews are retained payroll history.
-- Verification: pnpm db:policies payroll_export_checkpoint_reviews
