-- Phase 7 Mandatory Leave Assessment. Leave owns an explainable, as-of
-- evaluation of one Employee's mandatory leave obligation for one calendar
-- year under the governing MANDATORY_LEAVE Leave Policy Version. A successor is
-- appended only when the material fingerprint changes, and the
-- previous_assessment_id chain admits exactly one successor per assessment and
-- one head per Employee and year, so concurrent evaluations cannot both append.
-- Assessments are immutable; they never post to the ledger or forfeit credits.

CREATE TABLE "mandatory_leave_assessments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "assessment_year" INTEGER NOT NULL,
  "policy_version_id" UUID,
  "leave_account_id" UUID,
  "previous_assessment_id" UUID,
  "assessment_date" DATE NOT NULL,
  "result" TEXT NOT NULL,
  "required_quantity" NUMERIC(12,4),
  "fulfilled_quantity" NUMERIC(12,4),
  "material_fingerprint" TEXT NOT NULL,
  "input_facts" JSONB NOT NULL,
  "rule_results" JSONB NOT NULL,
  "assessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "mandatory_leave_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mandatory_leave_assessments_year_check"
    CHECK ("assessment_year" BETWEEN 1900 AND 9999),
  CONSTRAINT "mandatory_leave_assessments_result_check"
    CHECK ("result" IN ('SUBJECT', 'NOT_SUBJECT', 'INDETERMINATE')),
  CONSTRAINT "mandatory_leave_assessments_required_check"
    CHECK ("required_quantity" > 0),
  CONSTRAINT "mandatory_leave_assessments_fulfilled_check"
    CHECK ("fulfilled_quantity" >= 0),
  CONSTRAINT "mandatory_leave_assessments_fingerprint_check"
    CHECK (btrim("material_fingerprint") <> ''),
  CONSTRAINT "mandatory_leave_assessments_date_year_check"
    CHECK (extract(year FROM "assessment_date") = "assessment_year"),
  CONSTRAINT "mandatory_leave_assessments_determinate_check"
    CHECK (
      "result" = 'INDETERMINATE'
      OR (
        "policy_version_id" IS NOT NULL
        AND "leave_account_id" IS NOT NULL
        AND "fulfilled_quantity" IS NOT NULL
      )
    ),
  CONSTRAINT "mandatory_leave_assessments_subject_required_check"
    CHECK (("result" = 'SUBJECT') = ("required_quantity" IS NOT NULL)),
  CONSTRAINT "mandatory_leave_assessments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "mandatory_leave_assessments_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "mandatory_leave_assessments_policy_version_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "mandatory_leave_assessments_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "mandatory_leave_assessments_previous_fkey"
    FOREIGN KEY ("agency_id", "previous_assessment_id")
    REFERENCES "mandatory_leave_assessments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "mandatory_leave_assessments_previous_key" UNIQUE ("previous_assessment_id"),
  CONSTRAINT "mandatory_leave_assessments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "mandatory_leave_assessments_first_per_year"
  ON "mandatory_leave_assessments" ("agency_id", "employee_id", "assessment_year")
  WHERE "previous_assessment_id" IS NULL;

CREATE INDEX "mandatory_leave_assessments_employee_year_idx"
  ON "mandatory_leave_assessments" ("agency_id", "employee_id", "assessment_year", "assessed_at" DESC);

CREATE OR REPLACE FUNCTION guard_mandatory_leave_assessment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% records are immutable and cannot be %', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "mandatory_leave_assessments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "mandatory_leave_assessments"
  FOR EACH ROW EXECUTE FUNCTION guard_mandatory_leave_assessment_mutation();

GRANT SELECT, INSERT ON TABLE "mandatory_leave_assessments" TO hris_app;

ALTER TABLE "mandatory_leave_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandatory_leave_assessments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "mandatory_leave_assessments_select" ON "mandatory_leave_assessments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "mandatory_leave_assessments_insert" ON "mandatory_leave_assessments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- `leave.mandatory_assessments.evaluate` covers the Agency and year command
-- (Leave Admin A, HR Admin C). `leave.mandatory_assessments.read` encodes
-- Leave Admin A, HR Admin A, Employee O, and Auditor R. No Supervisor role
-- exists yet, so the Supervisor S column has no grant.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.mandatory_assessments.read', 'leave', 'MEDIUM', 'Read Mandatory Leave Assessments'),
  ('leave.mandatory_assessments.evaluate', 'leave', 'MEDIUM', 'Evaluate Mandatory Leave Assessments for an Agency and year')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.mandatory_assessments.evaluate'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.mandatory_assessments.read'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.mandatory_assessments.read'
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'mandatory_leave_assessments_first_per_year'
  ) THEN
    RAISE EXCEPTION 'Mandatory Leave Assessment chain head verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'mandatory_leave_assessments_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Mandatory Leave Assessment immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee' AND p."code" = 'leave.mandatory_assessments.read'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'Employee Mandatory Leave Assessment read grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'internal_auditor' AND p."code" = 'leave.mandatory_assessments.read'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Auditor Mandatory Leave Assessment read grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator' AND p."code" = 'leave.mandatory_assessments.evaluate'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Mandatory Leave Assessment evaluate grant verification failed';
  END IF;
END;
$$;
