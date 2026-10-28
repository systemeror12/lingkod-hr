-- Phase 8 COC Accounts and COC Ledger (#537), as overtime-coc-cto-schema.md §4
-- and ADR 0009 shape them. A COC Account covers one Employee and one
-- continuous period of employment in the Agency. A COC Ledger Entry is a
-- signed number of minutes at one decimal place, with the Valid Until of the
-- COC it changes, a typed source and posting key, and the national rule it
-- applied. There is no entry-type enum. The balance is derived from entries
-- and never stored.
--
-- `earned_month` is set only on certificate awards, so the 40-hour monthly cap
-- can count COC already credited for the month under the account lock, without
-- reading the Overtime module's certificates. New credit comes only from a
-- certificate, so any other positive entry must be a reversal.

CREATE TABLE "coc_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "opened_at" DATE NOT NULL,
  "closed_at" DATE,
  CONSTRAINT "coc_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coc_accounts_status_check"
    CHECK ("status" IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT "coc_accounts_status_close_check"
    CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL)),
  CONSTRAINT "coc_accounts_close_period_check"
    CHECK ("closed_at" IS NULL OR "closed_at" >= "opened_at"),
  CONSTRAINT "coc_accounts_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "coc_accounts_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_accounts_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "coc_accounts_one_active_uq"
  ON "coc_accounts" ("agency_id", "employee_id")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "coc_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "coc_account_id" UUID NOT NULL,
  "minutes" NUMERIC(12,1) NOT NULL,
  "effective_date" DATE NOT NULL,
  "valid_until" DATE NOT NULL,
  "earned_month" DATE,
  "source_type" CITEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "source_posting_key" CITEXT NOT NULL,
  "rule_code" TEXT NOT NULL,
  "reason" TEXT,
  "supporting_document_version_id" UUID,
  "reverses_entry_id" UUID,
  "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_by_membership_id" UUID,
  CONSTRAINT "coc_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coc_ledger_entries_minutes_check"
    CHECK ("minutes" <> 0),
  CONSTRAINT "coc_ledger_entries_valid_until_check"
    CHECK ("valid_until" = make_date(extract(year FROM "valid_until")::int, 12, 31)),
  CONSTRAINT "coc_ledger_entries_earned_month_check"
    CHECK (
      "earned_month" IS NULL
      OR (
        "earned_month" = date_trunc('month', "earned_month")::date
        AND "valid_until" = make_date(extract(year FROM "earned_month")::int + 1, 12, 31)
        AND "minutes" > 0
        AND "reverses_entry_id" IS NULL
      )
    ),
  CONSTRAINT "coc_ledger_entries_credit_source_check"
    CHECK ("minutes" < 0 OR "earned_month" IS NOT NULL OR "reverses_entry_id" IS NOT NULL),
  CONSTRAINT "coc_ledger_entries_source_type_check"
    CHECK (btrim("source_type"::text) <> ''),
  CONSTRAINT "coc_ledger_entries_source_posting_key_check"
    CHECK (btrim("source_posting_key"::text) <> ''),
  CONSTRAINT "coc_ledger_entries_rule_code_check"
    CHECK (btrim("rule_code") <> ''),
  CONSTRAINT "coc_ledger_entries_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "coc_ledger_entries_account_fkey"
    FOREIGN KEY ("agency_id", "coc_account_id")
    REFERENCES "coc_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_ledger_entries_supporting_document_fkey"
    FOREIGN KEY ("agency_id", "supporting_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_ledger_entries_reversal_fkey"
    FOREIGN KEY ("agency_id", "reverses_entry_id")
    REFERENCES "coc_ledger_entries"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_ledger_entries_poster_fkey"
    FOREIGN KEY ("agency_id", "posted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_ledger_entries_source_key"
    UNIQUE (
      "agency_id", "coc_account_id",
      "source_type", "source_id", "source_posting_key"
    ),
  CONSTRAINT "coc_ledger_entries_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "coc_ledger_entries_one_reversal_uq"
  ON "coc_ledger_entries" ("agency_id", "reverses_entry_id")
  WHERE "reverses_entry_id" IS NOT NULL;

CREATE INDEX "coc_ledger_entries_balance_idx"
  ON "coc_ledger_entries" ("agency_id", "coc_account_id", "effective_date");

CREATE INDEX "coc_ledger_entries_source_idx"
  ON "coc_ledger_entries" ("agency_id", "source_type", "source_id");

CREATE INDEX "coc_ledger_entries_earned_month_idx"
  ON "coc_ledger_entries" ("agency_id", "earned_month")
  WHERE "earned_month" IS NOT NULL;

-- An account keeps its identity. Only closing changes it, once.
CREATE OR REPLACE FUNCTION guard_coc_account_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COC Accounts are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."opened_at" IS DISTINCT FROM NEW."opened_at" THEN
    RAISE EXCEPTION 'COC Account identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'A closed COC Account is final'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Posted entries are immutable. A reversal exactly negates its original in the
-- same account and Valid Until (ADR 0009).
CREATE OR REPLACE FUNCTION guard_coc_ledger_entry_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  original "coc_ledger_entries"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'COC Ledger Entries are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COC Ledger Entries are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."reverses_entry_id" IS NOT NULL THEN
    SELECT * INTO original
    FROM "coc_ledger_entries"
    WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."reverses_entry_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A reversal must reference an existing COC Ledger Entry'
        USING ERRCODE = '55000';
    END IF;
    IF original."coc_account_id" <> NEW."coc_account_id"
      OR original."valid_until" <> NEW."valid_until" THEN
      RAISE EXCEPTION 'A reversal must use the same COC Account and Valid Until as its original'
        USING ERRCODE = '55000';
    END IF;
    IF original."minutes" <> -NEW."minutes" THEN
      RAISE EXCEPTION 'A reversal must exactly negate its original entry'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "coc_accounts_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "coc_accounts"
  FOR EACH ROW EXECUTE FUNCTION guard_coc_account_mutation();
CREATE TRIGGER "coc_ledger_entries_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "coc_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION guard_coc_ledger_entry_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "coc_accounts" TO hris_app;
GRANT SELECT, INSERT ON TABLE "coc_ledger_entries" TO hris_app;

ALTER TABLE "coc_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coc_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "coc_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coc_ledger_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "coc_accounts_select" ON "coc_accounts"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "coc_accounts_insert" ON "coc_accounts"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "coc_accounts_update" ON "coc_accounts"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "coc_ledger_entries_select" ON "coc_ledger_entries"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "coc_ledger_entries_insert" ON "coc_ledger_entries"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'coc_accounts_one_active_uq'
  ) THEN
    RAISE EXCEPTION 'COC Account one-active verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'coc_ledger_entries_one_reversal_uq'
  ) THEN
    RAISE EXCEPTION 'COC Ledger reversal uniqueness verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coc_ledger_entries_source_key'
  ) THEN
    RAISE EXCEPTION 'COC Ledger source idempotency verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'coc_ledger_entries' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'COC Ledger forced RLS verification failed';
  END IF;
END;
$$;
