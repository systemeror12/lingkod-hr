-- Phase 7 Leave Accounts, Leave Credit Ledger, and Leave Credit Commitments.
-- One Leave Account covers one Employee, credit-bearing Leave Type, and
-- continuous agency-employment entitlement period. Posted balance is derived
-- only from immutable Leave Ledger Entries that cite their authoritative source
-- record and governing Leave Policy Version. Unposted claims live in Leave
-- Credit Commitments and reduce availability without changing the posted
-- balance. Opening and adjustment source records own their business meaning, so
-- the ledger carries no business-event enum. Reversals must use the same
-- account and exactly negate their original entry, and posted entries and
-- terminal commitment states are immutable.

CREATE TABLE "leave_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "leave_type_id" UUID NOT NULL,
  "unit_code" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "opened_at" DATE NOT NULL,
  "closed_at" DATE,
  CONSTRAINT "leave_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_accounts_unit_check"
    CHECK ("unit_code" IN ('CREDIT_DAY')),
  CONSTRAINT "leave_accounts_status_check"
    CHECK ("status" IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  CONSTRAINT "leave_accounts_close_period_check"
    CHECK ("closed_at" IS NULL OR "closed_at" >= "opened_at"),
  CONSTRAINT "leave_accounts_status_close_check"
    CHECK (
      ("status" IN ('ACTIVE', 'FROZEN') AND "closed_at" IS NULL)
      OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL)
    ),
  CONSTRAINT "leave_accounts_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_accounts_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_accounts_leave_type_fkey"
    FOREIGN KEY ("agency_id", "leave_type_id")
    REFERENCES "leave_types"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_accounts_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "leave_accounts_one_open_uq"
  ON "leave_accounts" ("agency_id", "employee_id", "leave_type_id")
  WHERE "status" IN ('ACTIVE', 'FROZEN');

CREATE INDEX "leave_accounts_agency_status_idx"
  ON "leave_accounts" ("agency_id", "status", "employee_id");

CREATE TABLE "leave_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_account_id" UUID NOT NULL,
  "quantity" NUMERIC(12,4) NOT NULL,
  "effective_date" DATE NOT NULL,
  "source_type" CITEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "source_posting_key" CITEXT NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "reverses_entry_id" UUID,
  "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_by_membership_id" UUID,
  CONSTRAINT "leave_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_ledger_entries_quantity_check"
    CHECK ("quantity" <> 0),
  CONSTRAINT "leave_ledger_entries_source_type_check"
    CHECK (length(btrim("source_type"::text)) > 0),
  CONSTRAINT "leave_ledger_entries_source_posting_key_check"
    CHECK (length(btrim("source_posting_key"::text)) > 0),
  CONSTRAINT "leave_ledger_entries_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_entries_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_entries_policy_version_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_entries_reversal_fkey"
    FOREIGN KEY ("agency_id", "reverses_entry_id")
    REFERENCES "leave_ledger_entries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_entries_poster_fkey"
    FOREIGN KEY ("agency_id", "posted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_entries_source_key"
    UNIQUE (
      "agency_id", "leave_account_id",
      "source_type", "source_id", "source_posting_key"
    ),
  CONSTRAINT "leave_ledger_entries_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "leave_ledger_entries_one_reversal_uq"
  ON "leave_ledger_entries" ("agency_id", "reverses_entry_id")
  WHERE "reverses_entry_id" IS NOT NULL;

CREATE INDEX "leave_ledger_entries_balance_idx"
  ON "leave_ledger_entries" ("agency_id", "leave_account_id", "effective_date", "posted_at");

CREATE TABLE "leave_credit_commitments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_account_id" UUID NOT NULL,
  "quantity" NUMERIC(12,4) NOT NULL,
  "source_type" CITEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "source_commitment_key" CITEXT NOT NULL,
  "succeeds_commitment_id" UUID,
  "status" TEXT NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "ended_at" TIMESTAMPTZ(6),
  CONSTRAINT "leave_credit_commitments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_credit_commitments_quantity_check"
    CHECK ("quantity" > 0),
  CONSTRAINT "leave_credit_commitments_source_type_check"
    CHECK (length(btrim("source_type"::text)) > 0),
  CONSTRAINT "leave_credit_commitments_source_key_check"
    CHECK (length(btrim("source_commitment_key"::text)) > 0),
  CONSTRAINT "leave_credit_commitments_status_check"
    CHECK ("status" IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
  CONSTRAINT "leave_credit_commitments_ended_check"
    CHECK (
      ("status" = 'ACTIVE' AND "ended_at" IS NULL)
      OR ("status" IN ('CONSUMED', 'RELEASED') AND "ended_at" IS NOT NULL)
    ),
  CONSTRAINT "leave_credit_commitments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_credit_commitments_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_credit_commitments_successor_fkey"
    FOREIGN KEY ("agency_id", "succeeds_commitment_id")
    REFERENCES "leave_credit_commitments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_credit_commitments_source_key"
    UNIQUE (
      "agency_id", "leave_account_id",
      "source_type", "source_id", "source_commitment_key"
    ),
  CONSTRAINT "leave_credit_commitments_successor_key"
    UNIQUE ("agency_id", "succeeds_commitment_id"),
  CONSTRAINT "leave_credit_commitments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "leave_credit_commitments_active_idx"
  ON "leave_credit_commitments" ("agency_id", "leave_account_id", "effective_from");

CREATE TABLE "leave_account_openings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_account_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "quantity" NUMERIC(12,4) NOT NULL,
  "effective_date" DATE NOT NULL,
  "evidence_document_id" UUID NOT NULL,
  "evidence_document_version_id" UUID NOT NULL,
  "reason" TEXT,
  "opened_by_membership_id" UUID NOT NULL,
  "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_account_openings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_account_openings_quantity_check"
    CHECK ("quantity" >= 0),
  CONSTRAINT "leave_account_openings_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_account_openings_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_account_openings_policy_version_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_account_openings_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_account_openings_evidence_version_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_account_openings_opener_fkey"
    FOREIGN KEY ("agency_id", "opened_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_account_openings_account_key"
    UNIQUE ("agency_id", "leave_account_id"),
  CONSTRAINT "leave_account_openings_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_ledger_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "leave_account_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "quantity" NUMERIC(12,4) NOT NULL,
  "effective_date" DATE NOT NULL,
  "authority_document_id" UUID NOT NULL,
  "authority_document_version_id" UUID NOT NULL,
  "evidence_document_id" UUID NOT NULL,
  "evidence_document_version_id" UUID NOT NULL,
  "reverses_entry_id" UUID,
  "reason" TEXT NOT NULL,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_ledger_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_ledger_adjustments_quantity_check"
    CHECK ("quantity" <> 0),
  CONSTRAINT "leave_ledger_adjustments_reason_check"
    CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "leave_ledger_adjustments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_policy_version_fkey"
    FOREIGN KEY ("agency_id", "policy_version_id")
    REFERENCES "leave_policy_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_authority_fkey"
    FOREIGN KEY ("agency_id", "authority_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_authority_version_fkey"
    FOREIGN KEY ("agency_id", "authority_document_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_evidence_version_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_reversal_fkey"
    FOREIGN KEY ("agency_id", "reverses_entry_id")
    REFERENCES "leave_ledger_entries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "leave_ledger_adjustments_reversal_key"
    UNIQUE ("agency_id", "reverses_entry_id"),
  CONSTRAINT "leave_ledger_adjustments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "leave_ledger_adjustments_account_idx"
  ON "leave_ledger_adjustments" ("agency_id", "leave_account_id", "recorded_at");

CREATE OR REPLACE FUNCTION guard_leave_account_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Accounts are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."leave_type_id" IS DISTINCT FROM NEW."leave_type_id"
    OR OLD."unit_code" IS DISTINCT FROM NEW."unit_code"
    OR OLD."opened_at" IS DISTINCT FROM NEW."opened_at" THEN
    RAISE EXCEPTION 'Leave Account identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'CLOSED' AND NEW."status" <> 'CLOSED' THEN
    RAISE EXCEPTION 'Closed Leave Accounts cannot be reopened'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."closed_at" IS NOT NULL AND OLD."closed_at" IS DISTINCT FROM NEW."closed_at" THEN
    RAISE EXCEPTION 'Leave Account close date is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_ledger_entry_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  original "leave_ledger_entries"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Leave Ledger Entries are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Ledger Entries are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."reverses_entry_id" IS NOT NULL THEN
    SELECT * INTO original
    FROM "leave_ledger_entries"
    WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."reverses_entry_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A reversal must reference an existing Leave Ledger Entry'
        USING ERRCODE = '55000';
    END IF;

    IF original."leave_account_id" <> NEW."leave_account_id" THEN
      RAISE EXCEPTION 'A reversal must use the same Leave Account as its original entry'
        USING ERRCODE = '55000';
    END IF;

    IF original."quantity" <> -NEW."quantity" THEN
      RAISE EXCEPTION 'A reversal must exactly negate its original entry'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_credit_commitment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Credit Commitments are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Terminal Leave Credit Commitment states are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."leave_account_id" IS DISTINCT FROM NEW."leave_account_id"
    OR OLD."quantity" IS DISTINCT FROM NEW."quantity"
    OR OLD."source_type" IS DISTINCT FROM NEW."source_type"
    OR OLD."source_id" IS DISTINCT FROM NEW."source_id"
    OR OLD."source_commitment_key" IS DISTINCT FROM NEW."source_commitment_key"
    OR OLD."succeeds_commitment_id" IS DISTINCT FROM NEW."succeeds_commitment_id"
    OR OLD."effective_from" IS DISTINCT FROM NEW."effective_from" THEN
    RAISE EXCEPTION 'Leave Credit Commitment identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "leave_accounts_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_accounts"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_account_mutation();
CREATE TRIGGER "leave_ledger_entries_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_ledger_entry_mutation();
CREATE TRIGGER "leave_credit_commitments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_credit_commitments"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_credit_commitment_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "leave_accounts" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_ledger_entries" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "leave_credit_commitments" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_account_openings" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_ledger_adjustments" TO hris_app;

ALTER TABLE "leave_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_credit_commitments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_credit_commitments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_account_openings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_account_openings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger_adjustments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "leave_accounts_select" ON "leave_accounts"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_accounts_insert" ON "leave_accounts"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_accounts_update" ON "leave_accounts"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_ledger_entries_select" ON "leave_ledger_entries"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_ledger_entries_insert" ON "leave_ledger_entries"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_credit_commitments_select" ON "leave_credit_commitments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_credit_commitments_insert" ON "leave_credit_commitments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_credit_commitments_update" ON "leave_credit_commitments"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_account_openings_select" ON "leave_account_openings"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_account_openings_insert" ON "leave_account_openings"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_ledger_adjustments_select" ON "leave_ledger_adjustments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_ledger_adjustments_insert" ON "leave_ledger_adjustments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.accounts.read', 'leave', 'MEDIUM', 'Read Agency Leave Accounts, Ledger Entries, and Commitments'),
  ('leave.credits.adjust', 'leave', 'HIGH', 'Adjust Leave Credits and Leave Account Status')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.credits.adjust'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.accounts.read'
WHERE r."code" IN (
  'agency_administrator',
  'hrmo_administrator',
  'personnel_records_officer',
  'budget_officer',
  'payroll_preparer',
  'appointing_authority',
  'internal_auditor'
)
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.accounts.read'
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
    WHERE schemaname = 'public' AND indexname = 'leave_accounts_one_open_uq'
  ) THEN
    RAISE EXCEPTION 'Leave Account open-period verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'leave_ledger_entries_one_reversal_uq'
  ) THEN
    RAISE EXCEPTION 'Leave Ledger reversal uniqueness verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_ledger_entries_source_key'
  ) THEN
    RAISE EXCEPTION 'Leave Ledger source idempotency verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_credit_commitments_source_key'
  ) THEN
    RAISE EXCEPTION 'Leave Credit Commitment source idempotency verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.accounts.read') THEN
    RAISE EXCEPTION 'Leave Account read permission verification failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.credits.adjust') THEN
    RAISE EXCEPTION 'Leave Credit adjust permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee' AND p."code" = 'leave.accounts.read'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'Employee Leave Account read grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator' AND p."code" = 'leave.credits.adjust'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Leave Credit adjust grant verification failed';
  END IF;
END;
$$;
