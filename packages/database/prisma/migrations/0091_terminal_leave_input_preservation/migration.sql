-- Phase 7 Terminal Leave Input Preservation. Leave owns the immutable Terminal
-- Leave Input Assessment and the consumable Terminal Leave Input Snapshot that
-- Separation later consumes. The snapshot binds exact Separation, service,
-- account, cutoff, policy/authority, clearance evidence, and owning-module
-- salary-source references at the effective separation date, with a separate
-- ledger-knowledge cutoff. Assessment, snapshot, line, and handoff outcome
-- records are append-only and immutable; they cannot close an account, post to
-- the ledger, calculate or authorize a benefit, create a Payroll Input, or
-- record payment.

CREATE TABLE "terminal_leave_input_assessments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "separation_source_type" CITEXT NOT NULL,
  "separation_source_id" UUID NOT NULL,
  "separation_source_version_key" CITEXT NOT NULL,
  "separation_classification" CITEXT NOT NULL,
  "separation_effective_date" DATE NOT NULL,
  "ledger_cutoff" TIMESTAMPTZ(6) NOT NULL,
  "result" TEXT NOT NULL,
  "input_facts" JSONB NOT NULL,
  "missing_or_conflicting_facts" JSONB NOT NULL,
  "assessed_by_membership_id" UUID NOT NULL,
  "assessed_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "terminal_leave_input_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terminal_leave_input_assessments_source_type_check"
    CHECK (length(btrim("separation_source_type"::text)) > 0),
  CONSTRAINT "terminal_leave_input_assessments_version_key_check"
    CHECK (length(btrim("separation_source_version_key"::text)) > 0),
  CONSTRAINT "terminal_leave_input_assessments_classification_check"
    CHECK (length(btrim("separation_classification"::text)) > 0),
  CONSTRAINT "terminal_leave_input_assessments_result_check"
    CHECK ("result" IN ('READY', 'INDETERMINATE')),
  CONSTRAINT "terminal_leave_input_assessments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_assessments_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_assessments_assessor_fkey"
    FOREIGN KEY ("agency_id", "assessed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_assessments_source_key"
    UNIQUE (
      "agency_id", "separation_source_type", "separation_source_id",
      "separation_source_version_key", "ledger_cutoff"
    ),
  CONSTRAINT "terminal_leave_input_assessments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "terminal_leave_input_assessments_employee_idx"
  ON "terminal_leave_input_assessments" ("agency_id", "employee_id", "assessed_at" DESC);

CREATE TABLE "terminal_leave_input_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "terminal_leave_input_assessment_id" UUID NOT NULL,
  "supersedes_snapshot_id" UUID,
  "snapshot_key" CITEXT NOT NULL,
  "service_source_snapshot" JSONB NOT NULL,
  "authority_snapshot" JSONB NOT NULL,
  "clearance_document_snapshot" JSONB NOT NULL,
  "salary_source_reference" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "terminal_leave_input_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terminal_leave_input_snapshots_snapshot_key_check"
    CHECK (length(btrim("snapshot_key"::text)) > 0),
  CONSTRAINT "terminal_leave_input_snapshots_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_snapshots_assessment_fkey"
    FOREIGN KEY ("agency_id", "terminal_leave_input_assessment_id")
    REFERENCES "terminal_leave_input_assessments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_snapshots_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_snapshot_id")
    REFERENCES "terminal_leave_input_snapshots"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_snapshots_assessment_key"
    UNIQUE ("terminal_leave_input_assessment_id"),
  CONSTRAINT "terminal_leave_input_snapshots_agency_assessment_key"
    UNIQUE ("agency_id", "terminal_leave_input_assessment_id"),
  CONSTRAINT "terminal_leave_input_snapshots_key"
    UNIQUE ("agency_id", "snapshot_key"),
  CONSTRAINT "terminal_leave_input_snapshots_supersedes_key"
    UNIQUE ("agency_id", "supersedes_snapshot_id"),
  CONSTRAINT "terminal_leave_input_snapshots_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "terminal_leave_input_snapshot_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "terminal_leave_input_snapshot_id" UUID NOT NULL,
  "leave_account_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "balance_effective_date" DATE NOT NULL,
  "ledger_cutoff" TIMESTAMPTZ(6) NOT NULL,
  "posted_balance" NUMERIC(12,4) NOT NULL,
  CONSTRAINT "terminal_leave_input_snapshot_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terminal_leave_input_snapshot_lines_balance_check"
    CHECK ("posted_balance" >= 0),
  CONSTRAINT "terminal_leave_input_snapshot_lines_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_snapshot_lines_snapshot_fkey"
    FOREIGN KEY ("agency_id", "terminal_leave_input_snapshot_id")
    REFERENCES "terminal_leave_input_snapshots"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_snapshot_lines_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_snapshot_lines_policy_version_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_snapshot_lines_account_key"
    UNIQUE ("terminal_leave_input_snapshot_id", "leave_account_id"),
  CONSTRAINT "terminal_leave_input_snapshot_lines_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "terminal_leave_input_handoff_outcomes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "terminal_leave_input_snapshot_id" UUID NOT NULL,
  "attempt_key" CITEXT NOT NULL,
  "result" TEXT NOT NULL,
  "separation_reference" JSONB,
  "reason" JSONB,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "terminal_leave_input_handoff_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terminal_leave_input_handoff_outcomes_attempt_key_check"
    CHECK (length(btrim("attempt_key"::text)) > 0),
  CONSTRAINT "terminal_leave_input_handoff_outcomes_result_check"
    CHECK ("result" IN ('ACCEPTED', 'ALREADY_ACCEPTED', 'REJECTED', 'RETRYABLE_FAILURE')),
  CONSTRAINT "terminal_leave_input_handoff_outcomes_reference_check"
    CHECK (
      ("result" IN ('ACCEPTED', 'ALREADY_ACCEPTED') AND "separation_reference" IS NOT NULL)
      OR ("result" IN ('REJECTED', 'RETRYABLE_FAILURE') AND "reason" IS NOT NULL)
    ),
  CONSTRAINT "terminal_leave_input_handoff_outcomes_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_handoff_outcomes_snapshot_fkey"
    FOREIGN KEY ("agency_id", "terminal_leave_input_snapshot_id")
    REFERENCES "terminal_leave_input_snapshots"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "terminal_leave_input_handoff_outcomes_attempt"
    UNIQUE ("terminal_leave_input_snapshot_id", "attempt_key"),
  CONSTRAINT "terminal_leave_input_handoff_outcomes_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE OR REPLACE FUNCTION guard_terminal_leave_input_mutation()
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

CREATE TRIGGER "terminal_leave_input_assessments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "terminal_leave_input_assessments"
  FOR EACH ROW EXECUTE FUNCTION guard_terminal_leave_input_mutation();
CREATE TRIGGER "terminal_leave_input_snapshots_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "terminal_leave_input_snapshots"
  FOR EACH ROW EXECUTE FUNCTION guard_terminal_leave_input_mutation();
CREATE TRIGGER "terminal_leave_input_snapshot_lines_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "terminal_leave_input_snapshot_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_terminal_leave_input_mutation();
CREATE TRIGGER "terminal_leave_input_handoff_outcomes_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "terminal_leave_input_handoff_outcomes"
  FOR EACH ROW EXECUTE FUNCTION guard_terminal_leave_input_mutation();

GRANT SELECT, INSERT ON TABLE "terminal_leave_input_assessments" TO hris_app;
GRANT SELECT, INSERT ON TABLE "terminal_leave_input_snapshots" TO hris_app;
GRANT SELECT, INSERT ON TABLE "terminal_leave_input_snapshot_lines" TO hris_app;
GRANT SELECT, INSERT ON TABLE "terminal_leave_input_handoff_outcomes" TO hris_app;

ALTER TABLE "terminal_leave_input_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terminal_leave_input_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "terminal_leave_input_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terminal_leave_input_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "terminal_leave_input_snapshot_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terminal_leave_input_snapshot_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "terminal_leave_input_handoff_outcomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terminal_leave_input_handoff_outcomes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "terminal_leave_input_assessments_select" ON "terminal_leave_input_assessments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "terminal_leave_input_assessments_insert" ON "terminal_leave_input_assessments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "terminal_leave_input_snapshots_select" ON "terminal_leave_input_snapshots"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "terminal_leave_input_snapshots_insert" ON "terminal_leave_input_snapshots"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "terminal_leave_input_snapshot_lines_select" ON "terminal_leave_input_snapshot_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "terminal_leave_input_snapshot_lines_insert" ON "terminal_leave_input_snapshot_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "terminal_leave_input_handoff_outcomes_select"
  ON "terminal_leave_input_handoff_outcomes"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "terminal_leave_input_handoff_outcomes_insert"
  ON "terminal_leave_input_handoff_outcomes"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- `leave.terminal_inputs.preserve` covers the preserve command (Leave Admin A,
-- HR Admin C, HR Certifier A, Approving Official C). `leave.terminal_inputs.read`
-- encodes the Auditor R row and mirrors the Leave Account read/write split.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.terminal_inputs.read', 'leave', 'MEDIUM', 'Read Terminal Leave Input Assessments and Snapshots'),
  ('leave.terminal_inputs.preserve', 'leave', 'HIGH', 'Preserve and Reassess Terminal Leave Inputs')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.terminal_inputs.preserve'
WHERE r."code" IN (
  'agency_administrator',
  'hrmo_administrator',
  'personnel_records_officer',
  'appointing_authority'
)
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.terminal_inputs.read'
WHERE r."code" IN (
  'agency_administrator',
  'hrmo_administrator',
  'personnel_records_officer',
  'appointing_authority',
  'internal_auditor'
)
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'terminal_leave_input_assessments_source_key'
  ) THEN
    RAISE EXCEPTION 'Terminal Leave Input Assessment source verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'terminal_leave_input_snapshots_key'
  ) THEN
    RAISE EXCEPTION 'Terminal Leave Input Snapshot key verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'terminal_leave_input_handoff_outcomes_attempt'
  ) THEN
    RAISE EXCEPTION 'Terminal Leave Input handoff attempt verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'terminal_leave_input_snapshots_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Terminal Leave Input immutability verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.terminal_inputs.read') THEN
    RAISE EXCEPTION 'Terminal Leave Input read permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'leave.terminal_inputs.preserve'
  ) THEN
    RAISE EXCEPTION 'Terminal Leave Input preserve permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'internal_auditor' AND p."code" = 'leave.terminal_inputs.read'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Auditor Terminal Leave Input read grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator' AND p."code" = 'leave.terminal_inputs.preserve'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Terminal Leave Input preserve grant verification failed';
  END IF;
END;
$$;
