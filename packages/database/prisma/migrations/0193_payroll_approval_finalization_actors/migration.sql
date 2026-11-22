-- Phase 9 payroll review actors (#639), as payroll-schema.md §5 and §11 have
-- them. Approval (#638) and finalization (#335) recorded their actor only in
-- their Audit Events, which payroll reviewers cannot read. This migration
-- gives each a column beside its time:
--
-- - `payroll_certifications.approved_by_membership_id` and `approved_at`: the
--   approval of the certification in force, set once while its period is
--   CERTIFIED. Return before finalization revokes that certification, so a
--   revoked row keeps its approval as history.
-- - `payroll_periods.finalized_by_membership_id`, beside `finalized_at`, as
--   `voided_by_membership_id` sits beside `voided_at`.
--
-- Existing rows are backfilled from their PAYROLL_PERIOD_APPROVED and
-- PAYROLL_PERIOD_FINALIZED Audit Events, so a developer database keeps who
-- approved and finalized. A finalized period without such an event (a test
-- fixture written with triggers suspended) keeps a null finalizer, so the
-- period CHECK only requires a time beside an actor, and the finalization
-- guard requires both on every APPROVED → FINALIZED move from here on.

ALTER TABLE "payroll_certifications"
  ADD COLUMN "approved_by_membership_id" UUID,
  ADD COLUMN "approved_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "payroll_certifications_approval_check"
    CHECK (("approved_at" IS NULL) = ("approved_by_membership_id" IS NULL)),
  ADD CONSTRAINT "payroll_certifications_approved_by_fkey"
    FOREIGN KEY ("agency_id", "approved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT;

ALTER TABLE "payroll_periods"
  ADD COLUMN "finalized_by_membership_id" UUID,
  ADD CONSTRAINT "payroll_periods_finalized_by_check"
    CHECK ("finalized_by_membership_id" IS NULL OR "finalized_at" IS NOT NULL),
  ADD CONSTRAINT "payroll_periods_finalized_by_fkey"
    FOREIGN KEY ("agency_id", "finalized_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT;

-- The backfill runs with the row guards and forced RLS suspended: the guards
-- refuse these columns outside their transitions, and RLS hides every row
-- outside a request context.
ALTER TABLE "payroll_certifications" DISABLE TRIGGER USER;
ALTER TABLE "payroll_periods" DISABLE TRIGGER USER;
ALTER TABLE "payroll_certifications" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_periods" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" DISABLE ROW LEVEL SECURITY;

UPDATE "payroll_certifications" c
SET "approved_by_membership_id" = e."actor_membership_id",
    "approved_at" = e."occurred_at"
FROM (
  SELECT DISTINCT ON ("agency_id", "metadata" ->> 'payrollCertificationId')
    "agency_id", ("metadata" ->> 'payrollCertificationId')::uuid AS "certification_id",
    "actor_membership_id", "occurred_at"
  FROM "audit_events"
  WHERE "action" = 'PAYROLL_PERIOD_APPROVED'
    AND "actor_membership_id" IS NOT NULL
    AND "metadata" ->> 'payrollCertificationId' IS NOT NULL
  ORDER BY "agency_id", "metadata" ->> 'payrollCertificationId', "occurred_at"
) e
WHERE c."agency_id" = e."agency_id" AND c."id" = e."certification_id";

UPDATE "payroll_periods" p
SET "finalized_by_membership_id" = e."actor_membership_id"
FROM "audit_events" e
WHERE e."agency_id" = p."agency_id"
  AND e."entity_id" = p."id"
  AND e."action" = 'PAYROLL_PERIOD_FINALIZED'
  AND e."actor_membership_id" IS NOT NULL
  AND p."finalized_at" IS NOT NULL;

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_periods" ENABLE TRIGGER USER;
ALTER TABLE "payroll_certifications" ENABLE TRIGGER USER;

-- A certification is written while its period is FOR_REVIEW at the version it
-- names, and is never deleted. Afterwards it records its approval once, while
-- in force and its period CERTIFIED at that version, and its revocation once.
-- A revoked certification never changes again.
CREATE OR REPLACE FUNCTION guard_payroll_certification_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Certifications are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."revoked_at" IS NOT NULL OR NEW."approved_at" IS NOT NULL OR NOT EXISTS (
      SELECT 1
      FROM "payroll_periods" p
      WHERE p."agency_id" = NEW."agency_id"
        AND p."id" = NEW."payroll_period_id"
        AND p."status" = 'FOR_REVIEW'
        AND p."calculation_version" = NEW."calculation_version"
    ) THEN
      RAISE EXCEPTION 'A Payroll Period is certified while FOR_REVIEW, at its current calculation version'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'revoked_by_membership_id' - 'revoked_at' - 'revocation_reason'
        - 'approved_by_membership_id' - 'approved_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'revoked_by_membership_id' - 'revoked_at' - 'revocation_reason'
        - 'approved_by_membership_id' - 'approved_at')
     OR OLD."revoked_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A Payroll Certification changes only to record its approval or its revocation, once'
      USING ERRCODE = '55000';
  END IF;

  IF (NEW."approved_by_membership_id", NEW."approved_at")
     IS DISTINCT FROM (OLD."approved_by_membership_id", OLD."approved_at") THEN
    IF OLD."approved_at" IS NOT NULL OR NEW."revoked_at" IS NOT NULL OR NOT EXISTS (
      SELECT 1
      FROM "payroll_periods" p
      WHERE p."agency_id" = NEW."agency_id"
        AND p."id" = NEW."payroll_period_id"
        AND p."status" = 'CERTIFIED'
        AND p."calculation_version" = NEW."calculation_version"
    ) THEN
      RAISE EXCEPTION 'A Payroll Certification records its approval once, while in force and its period CERTIFIED'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- A period's finalization time and finalizer are set together as it becomes
-- FINALIZED and never move.
CREATE OR REPLACE FUNCTION guard_payroll_period_finalized_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF OLD."status" = 'APPROVED' AND NEW."status" = 'FINALIZED' THEN
    IF NEW."finalized_at" IS NULL OR NEW."finalized_by_membership_id" IS NULL THEN
      RAISE EXCEPTION 'A Payroll Period records when it is finalized, and by whom'
        USING ERRCODE = '55000';
    END IF;
  ELSIF (NEW."finalized_at", NEW."finalized_by_membership_id")
        IS DISTINCT FROM (OLD."finalized_at", OLD."finalized_by_membership_id") THEN
    RAISE EXCEPTION 'A Payroll Period is given its finalization time and finalizer only as it is finalized'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- `payroll_periods` keeps its table-wide UPDATE grant (migration 0153), which
-- covers the new column; its guards above decide when it is written.
GRANT UPDATE ("approved_by_membership_id", "approved_at")
  ON TABLE "payroll_certifications" TO hris_app;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'payroll_certifications' AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'payroll_periods' AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'audit_events' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Payroll review actor RLS verification failed';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('payroll_certifications_mutation_trigger', 'payroll_periods_finalized_at_trigger')
      AND tgenabled = 'O'
  ) <> 2 THEN
    RAISE EXCEPTION 'Payroll review actor guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; approvals
-- and finalizations are retained payroll history.
-- Verification: pnpm db:policies payroll_certifications; pnpm db:policies
-- payroll_periods
