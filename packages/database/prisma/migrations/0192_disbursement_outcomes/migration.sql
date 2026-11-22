-- Phase 9 Disbursement Outcomes (#642), as payroll-schema.md §12 has it. A
-- Disbursement Outcome is external evidence of one Payment Instruction's
-- progress or result after handoff (#28): SUBMITTED, ACCEPTED, REJECTED,
-- SETTLED, or RETURNED, with an optional external reference and evidence
-- Document Version, and a reason for REJECTED and RETURNED.
--
-- Outcomes are append-only. An instruction's outcomes are numbered 1, 2, ...
-- in the order recorded, and its latest outcome is the one with the highest
-- `sequence`; recording an outcome changes no export, instruction, or payroll
-- row. ACCEPTED does not imply SETTLED, and one export's instructions may hold
-- mixed outcomes. Recording claims the DISBURSEMENT payroll function on the
-- instruction's Payroll Period (#330), which the service enforces through
-- `payroll_period_actors`.

CREATE TABLE "disbursement_outcomes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "payment_instruction_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "external_reference" TEXT,
  "evidence_document_version_id" UUID,
  "reason" TEXT,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "disbursement_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "disbursement_outcomes_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "disbursement_outcomes_outcome_check"
    CHECK ("outcome" IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'SETTLED', 'RETURNED')),
  CONSTRAINT "disbursement_outcomes_external_reference_check"
    CHECK ("external_reference" IS NULL OR btrim("external_reference") <> ''),
  -- REJECTED and RETURNED give their reason; the other outcomes have none.
  CONSTRAINT "disbursement_outcomes_reason_check" CHECK (
    ("outcome" IN ('REJECTED', 'RETURNED')) = ("reason" IS NOT NULL)
    AND ("reason" IS NULL OR btrim("reason") <> '')
  ),
  CONSTRAINT "disbursement_outcomes_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "disbursement_outcomes_instruction_fkey"
    FOREIGN KEY ("agency_id", "payment_instruction_id")
    REFERENCES "payment_instructions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "disbursement_outcomes_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "disbursement_outcomes_recorded_by_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  -- The order of an instruction's outcomes; it also serves the latest-outcome read.
  CONSTRAINT "disbursement_outcomes_instruction_sequence_key"
    UNIQUE ("payment_instruction_id", "sequence"),
  CONSTRAINT "disbursement_outcomes_agency_id_id_key" UNIQUE ("agency_id", "id")
);

-- An outcome is written only on an instruction of a FINALIZED payroll, as the
-- next in its instruction's order, and is never changed or deleted.
CREATE OR REPLACE FUNCTION guard_disbursement_outcome_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Disbursement Outcomes are append-only; record a later outcome instead'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "payment_instructions" i
    JOIN "payment_exports" x
      ON x."agency_id" = i."agency_id" AND x."id" = i."payment_export_id"
    JOIN "payroll_periods" p
      ON p."agency_id" = x."agency_id" AND p."id" = x."payroll_period_id"
    WHERE i."agency_id" = NEW."agency_id"
      AND i."id" = NEW."payment_instruction_id"
      AND p."status" = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'A Disbursement Outcome is recorded only on a Payment Instruction of a FINALIZED payroll'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."sequence" <> (
    SELECT COALESCE(max(o."sequence"), 0) + 1
    FROM "disbursement_outcomes" o
    WHERE o."agency_id" = NEW."agency_id"
      AND o."payment_instruction_id" = NEW."payment_instruction_id"
  ) THEN
    RAISE EXCEPTION 'A Disbursement Outcome follows its instruction''s latest outcome'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "disbursement_outcomes_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "disbursement_outcomes"
  FOR EACH ROW EXECUTE FUNCTION guard_disbursement_outcome_mutation();

REVOKE ALL ON TABLE "disbursement_outcomes" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "disbursement_outcomes" TO hris_app;

ALTER TABLE "disbursement_outcomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disbursement_outcomes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "disbursement_outcomes_select" ON "disbursement_outcomes"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "disbursement_outcomes_insert" ON "disbursement_outcomes"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES (
  'payroll.disbursement.update', 'payroll', 'HIGH',
  'Record a Disbursement Outcome on a Payment Instruction of a FINALIZED Payroll Period'
)
ON CONFLICT ("code") DO NOTHING;

-- hris-controls.md §6.10 marks `payroll.disbursement.update` A for the
-- Cashier only. The Accounting Reviewer's and the Payroll Approver's C are
-- agency-configurable and the Auditor's R has no read-only form of this
-- permission yet, so none of them is seeded.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.disbursement.update'
WHERE r."code" = 'cashier' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Verified while the role tables are still readable without an Agency context.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'cashier' AND p."code" = 'payroll.disbursement.update'
  ) THEN
    RAISE EXCEPTION 'Disbursement Outcome permission grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'disbursement_outcomes' AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Disbursement Outcome forced RLS verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'disbursement_outcomes_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Disbursement Outcome mutation guard verification failed';
  END IF;
END;
$$;

-- Rollback/correction: only through a reviewed forward migration; Disbursement
-- Outcomes are retained payroll history, and a wrong outcome is answered by a
-- later one.
-- Verification: pnpm db:policies disbursement_outcomes
