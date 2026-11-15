-- Phase 9 HR certification (#334), as payroll-schema.md §5 has it. A Payroll
-- Certification binds the one calculation version, and the hash of its
-- Payroll Employee Results, that the HR Certifier certified. It is written
-- once and kept. Revoking it records who revoked it, when, and why, and
-- nothing else changes. The period status moves are already allowed by
-- migration 0153's guard.

CREATE TABLE "payroll_certifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payroll_period_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "calculation_hash" TEXT NOT NULL,
  "certified_by_membership_id" UUID NOT NULL,
  "certified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "revoked_by_membership_id" UUID,
  "revoked_at" TIMESTAMPTZ(6),
  "revocation_reason" TEXT,
  CONSTRAINT "payroll_certifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_certifications_calculation_version_check"
    CHECK ("calculation_version" > 0),
  CONSTRAINT "payroll_certifications_hash_check"
    CHECK ("calculation_hash" ~ '^[0-9a-f]{64}$'),
  -- A revocation has its actor, time, and reason together, or none of them.
  CONSTRAINT "payroll_certifications_revocation_check"
    CHECK (
      ("revoked_at" IS NULL AND "revoked_by_membership_id" IS NULL
        AND "revocation_reason" IS NULL)
      OR ("revoked_at" IS NOT NULL AND "revoked_by_membership_id" IS NOT NULL
        AND "revocation_reason" IS NOT NULL AND btrim("revocation_reason") <> '')
    ),
  CONSTRAINT "payroll_certifications_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_certifications_period_fkey"
    FOREIGN KEY ("agency_id", "payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_certifications_certified_by_fkey"
    FOREIGN KEY ("agency_id", "certified_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_certifications_revoked_by_fkey"
    FOREIGN KEY ("agency_id", "revoked_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_certifications_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- A period has at most one certification in force.
CREATE UNIQUE INDEX "payroll_certifications_one_current_key"
  ON "payroll_certifications" ("payroll_period_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "payroll_certifications_period_idx"
  ON "payroll_certifications" ("agency_id", "payroll_period_id");

-- A certification is written while its period is FOR_REVIEW at the version it
-- names, and is never deleted. Afterwards only its revocation is recorded,
-- once.
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
    IF NEW."revoked_at" IS NOT NULL OR NOT EXISTS (
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

  IF (to_jsonb(NEW) - 'revoked_by_membership_id' - 'revoked_at' - 'revocation_reason')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'revoked_by_membership_id' - 'revoked_at' - 'revocation_reason')
     OR OLD."revoked_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A Payroll Certification changes only to record its revocation, once'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_certifications_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_certifications"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_certification_mutation();

REVOKE ALL ON TABLE "payroll_certifications" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "payroll_certifications" TO hris_app;
GRANT UPDATE ("revoked_by_membership_id", "revoked_at", "revocation_reason")
  ON TABLE "payroll_certifications" TO hris_app;

ALTER TABLE "payroll_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_certifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payroll_certifications_select" ON "payroll_certifications"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_certifications_insert" ON "payroll_certifications"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_certifications_update" ON "payroll_certifications"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('payroll.periods.certify', 'payroll', 'HIGH',
   'Certify the HR inputs of a FOR_REVIEW Payroll Period'),
  ('payroll.periods.revoke_certification', 'payroll', 'HIGH',
   'Revoke the certification of a CERTIFIED Payroll Period, with a reason'),
  ('payroll.periods.return', 'payroll', 'HIGH',
   'Return a FOR_REVIEW Payroll Period to DRAFT for correction, with a reason')
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 names the HR Certifier, Accounting Reviewer, and
-- Payroll Approver; their system role templates did not exist yet. Each gets
-- the payroll permissions §6.10 marks A that exist so far. The C grants of
-- `payroll.periods.return` to the Payroll Preparer and Budget Officer are
-- agency-configurable and are not seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES
  ('hr_certifier', 'HR Certifier', TRUE, 'ACTIVE'),
  ('accounting_reviewer', 'Accounting Reviewer', TRUE, 'ACTIVE'),
  ('payroll_approver', 'Payroll Approver', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM (VALUES
  ('hr_certifier', 'payroll.periods.read'),
  ('hr_certifier', 'payroll.periods.certify'),
  ('hr_certifier', 'payroll.periods.revoke_certification'),
  ('hr_certifier', 'payroll.periods.return'),
  ('accounting_reviewer', 'payroll.periods.read'),
  ('accounting_reviewer', 'payroll.periods.return'),
  ('payroll_approver', 'payroll.periods.read'),
  ('payroll_approver', 'payroll.periods.revoke_certification'),
  ('payroll_approver', 'payroll.periods.return')
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
    SELECT 1 FROM pg_class WHERE relname = 'payroll_certifications' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Payroll Certification forced RLS verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_certifications_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Payroll Certification mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration;
-- certifications and their revocations are retained payroll history.
-- Verification: pnpm db:policies payroll_certifications
