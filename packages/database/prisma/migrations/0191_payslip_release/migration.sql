-- Phase 9 Payslip release, withholding, and the Employee's read (#640), as
-- hris-controls.md §5.21 and payroll-schema.md §12 have them. The Payroll
-- Approver releases every READY Payslip of a FINALIZED period with one
-- command, withholds one READY Payslip with a reason, and releases a WITHHELD
-- one singly. Each claims the APPROVAL payroll function on the period (§5.20).
-- Supersession stays with the void command, so this guard does not admit it.

-- The guard of 0185, extended with exactly the transitions #640 adds. Each
-- change writes only its own columns, once, while the result's period is
-- FINALIZED, by a person who holds APPROVAL on that period: the command claims
-- the function earlier in the same transaction.
CREATE OR REPLACE FUNCTION guard_payslip_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  changed JSONB;
  actor UUID;
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

  -- The keys whose values the update changed.
  SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key COLLATE "C"), '[]'::jsonb)
  INTO changed
  FROM jsonb_each(to_jsonb(NEW)) n
  JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;

  IF OLD."status" = 'GENERATING' AND NEW."status" = 'READY' THEN
    IF changed <> '["document_id", "status"]'::jsonb OR NEW."document_id" IS NULL THEN
      RAISE EXCEPTION 'A Payslip becomes READY only by naming its Document once'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('READY', 'WITHHELD') AND NEW."status" = 'RELEASED' THEN
    IF changed <> '["released_at", "released_by_membership_id", "status"]'::jsonb THEN
      RAISE EXCEPTION 'Releasing a Payslip records only who released it and when'
        USING ERRCODE = '55000';
    END IF;
    actor := NEW."released_by_membership_id";
  ELSIF OLD."status" = 'READY' AND NEW."status" = 'WITHHELD' THEN
    IF changed <> '["status", "withheld_at", "withheld_by_membership_id", "withhold_reason"]'::jsonb THEN
      RAISE EXCEPTION 'Withholding a Payslip records only who withheld it, when, and why'
        USING ERRCODE = '55000';
    END IF;
    actor := NEW."withheld_by_membership_id";
  ELSE
    RAISE EXCEPTION 'A Payslip changes only GENERATING → READY, READY → RELEASED or WITHHELD, and WITHHELD → RELEASED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "payroll_employees" r
    JOIN "payroll_periods" p
      ON p."agency_id" = r."agency_id" AND p."id" = r."payroll_period_id"
    JOIN "payroll_period_actors" a
      ON a."payroll_period_id" = p."id"
     AND a."membership_id" = actor
     AND a."payroll_function" = 'APPROVAL'
    WHERE r."agency_id" = NEW."agency_id"
      AND r."id" = NEW."payroll_employee_id"
      AND p."status" = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'A Payslip is released or withheld only on a FINALIZED period, by a person acting in its APPROVAL function'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT UPDATE (
  "released_at",
  "released_by_membership_id",
  "withheld_at",
  "withheld_by_membership_id",
  "withhold_reason"
) ON TABLE "payslips" TO hris_app;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  (
    'payroll.payslips.release', 'payroll', 'HIGH',
    'Release every READY Payslip of a FINALIZED Payroll Period, or one WITHHELD Payslip, to its Employee'
  ),
  (
    'payroll.payslips.withhold', 'payroll', 'HIGH',
    'Withhold one READY Payslip from its Employee with a reason; payment is unaffected'
  ),
  (
    'payroll.payslips.read', 'payroll', 'MEDIUM',
    'Read Payslips; held OWN, an Employee reads only their own RELEASED Payslips'
  )
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks release and withhold A for the Payroll Approver
-- alone, and §3 and §8.1 give the Employee `payroll.payslips.read:own`. The
-- Agency-wide read the matrix gives the payroll officers has no read yet, so
-- it is not seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('payroll.payslips.release', 'payroll.payslips.withhold')
WHERE r."code" = 'payroll_approver'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.payslips.read'
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE (r."code" = 'payroll_approver' AND rp."scope_policy" = 'AGENCY'
           AND p."code" IN ('payroll.payslips.release', 'payroll.payslips.withhold'))
       OR (r."code" = 'employee' AND rp."scope_policy" = 'OWN'
           AND p."code" = 'payroll.payslips.read')
  ) <> 3 THEN
    RAISE EXCEPTION 'Payslip permission grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payslips_mutation_trigger') THEN
    RAISE EXCEPTION 'Payslip mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; released
-- and withheld Payslips are retained payroll history.
