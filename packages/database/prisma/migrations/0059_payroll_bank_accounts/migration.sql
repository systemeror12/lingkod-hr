CREATE TABLE "payroll_bank_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "bank_code" TEXT NOT NULL,
  "account_name" TEXT NOT NULL,
  "encrypted_account_number" BYTEA NOT NULL,
  "encryption_version" SMALLINT NOT NULL DEFAULT 1,
  "masked_account_number" TEXT NOT NULL,
  "verification_state" TEXT NOT NULL DEFAULT 'PENDING',
  "verified_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "reason" TEXT,
  "evidence_document_id" UUID,
  "evidence_document_version_id" UUID,
  "predecessor_account_id" UUID,
  "transition_kind" TEXT,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "payroll_bank_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_bank_accounts_bank_code_check"
    CHECK ("bank_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  CONSTRAINT "payroll_bank_accounts_account_name_check"
    CHECK (length(btrim("account_name")) > 0),
  CONSTRAINT "payroll_bank_accounts_masked_number_check"
    CHECK (length(btrim("masked_account_number")) > 0),
  CONSTRAINT "payroll_bank_accounts_verification_check"
    CHECK ("verification_state" IN ('PENDING', 'VERIFIED')),
  CONSTRAINT "payroll_bank_accounts_status_check"
    CHECK ("status" IN ('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'REPLACED', 'CORRECTED')),
  CONSTRAINT "payroll_bank_accounts_verified_state_check"
    CHECK (
      ("status" = 'PENDING_VERIFICATION' AND "verification_state" = 'PENDING' AND "verified_at" IS NULL)
      OR ("status" IN ('ACTIVE', 'INACTIVE', 'REPLACED') AND "verification_state" = 'VERIFIED' AND "verified_at" IS NOT NULL)
      OR ("status" = 'CORRECTED' AND (
        ("verification_state" = 'PENDING' AND "verified_at" IS NULL)
        OR ("verification_state" = 'VERIFIED' AND "verified_at" IS NOT NULL)
      ))
    ),
  CONSTRAINT "payroll_bank_accounts_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "payroll_bank_accounts_evidence_pair_check"
    CHECK (("evidence_document_id" IS NULL) = ("evidence_document_version_id" IS NULL)),
  CONSTRAINT "payroll_bank_accounts_predecessor_pair_check"
    CHECK (("predecessor_account_id" IS NULL) = ("transition_kind" IS NULL)),
  CONSTRAINT "payroll_bank_accounts_transition_kind_check"
    CHECK ("transition_kind" IS NULL OR "transition_kind" IN ('REPLACEMENT', 'CORRECTION')),
  CONSTRAINT "payroll_bank_accounts_self_predecessor_check"
    CHECK ("predecessor_account_id" IS NULL OR "predecessor_account_id" <> "id"),
  CONSTRAINT "payroll_bank_accounts_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_bank_accounts_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_bank_accounts_evidence_document_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_bank_accounts_evidence_version_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_bank_accounts_predecessor_fkey"
    FOREIGN KEY ("agency_id", "predecessor_account_id")
    REFERENCES "payroll_bank_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_bank_accounts_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_bank_accounts_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_bank_accounts_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "payroll_bank_accounts_predecessor_key" UNIQUE ("agency_id", "predecessor_account_id")
);

ALTER TABLE "payroll_bank_accounts"
  ADD CONSTRAINT "payroll_bank_accounts_primary_period_excl"
  EXCLUDE USING gist (
    "agency_id" WITH =,
    "employee_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE INDEX "payroll_bank_accounts_employee_effective_idx"
  ON "payroll_bank_accounts" ("agency_id", "employee_id", "effective_from" DESC);
CREATE INDEX "payroll_bank_accounts_employee_status_idx"
  ON "payroll_bank_accounts" ("agency_id", "employee_id", "status");

CREATE OR REPLACE FUNCTION guard_payroll_bank_account_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  predecessor_employee_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll bank accounts are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF current_setting('app.payroll_bank_account_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Payroll bank accounts are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."predecessor_account_id" IS NULL AND NEW."status" <> 'PENDING_VERIFICATION' THEN
      RAISE EXCEPTION 'New payroll bank accounts must be pending verification'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."predecessor_account_id" IS NOT NULL THEN
      SELECT "employee_id" INTO predecessor_employee_id
      FROM "payroll_bank_accounts"
      WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."predecessor_account_id";
      IF predecessor_employee_id IS DISTINCT FROM NEW."employee_id" THEN
        RAISE EXCEPTION 'Payroll bank account successors must belong to the same Employee'
          USING ERRCODE = '23514';
      END IF;
      IF NEW."reason" IS NULL OR length(btrim(NEW."reason")) = 0 THEN
        RAISE EXCEPTION 'Payroll bank account successors require a reason'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."bank_code" IS DISTINCT FROM OLD."bank_code"
    OR NEW."account_name" IS DISTINCT FROM OLD."account_name"
    OR NEW."encrypted_account_number" IS DISTINCT FROM OLD."encrypted_account_number"
    OR NEW."encryption_version" IS DISTINCT FROM OLD."encryption_version"
    OR NEW."masked_account_number" IS DISTINCT FROM OLD."masked_account_number"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."predecessor_account_id" IS DISTINCT FROM OLD."predecessor_account_id"
    OR NEW."transition_kind" IS DISTINCT FROM OLD."transition_kind"
    OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Payroll bank account identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'PENDING_VERIFICATION' AND NEW."status" IN ('ACTIVE', 'INACTIVE', 'CORRECTED'))
    OR (OLD."status" = 'ACTIVE' AND NEW."status" IN ('INACTIVE', 'REPLACED', 'CORRECTED'))
    OR (OLD."status" IN ('INACTIVE', 'REPLACED') AND NEW."status" = 'CORRECTED')
  ) THEN
    RAISE EXCEPTION 'Unsupported payroll bank account status transition'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND (NEW."reason" IS NULL OR length(btrim(NEW."reason")) = 0) THEN
    RAISE EXCEPTION 'Payroll bank account transitions require a reason'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'PENDING_VERIFICATION' AND (
    NEW."verification_state" IS DISTINCT FROM OLD."verification_state"
    OR NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
    OR NEW."evidence_document_id" IS DISTINCT FROM OLD."evidence_document_id"
    OR NEW."evidence_document_version_id" IS DISTINCT FROM OLD."evidence_document_version_id"
  ) THEN
    RAISE EXCEPTION 'Verified payroll bank account evidence is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payroll_bank_accounts_updated_at_trigger"
  BEFORE UPDATE ON "payroll_bank_accounts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "payroll_bank_accounts_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_bank_accounts"
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_bank_account_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "payroll_bank_accounts" TO hris_app;

ALTER TABLE "payroll_bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_bank_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payroll_bank_accounts_select" ON "payroll_bank_accounts"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "payroll_bank_accounts_insert" ON "payroll_bank_accounts"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "payroll_bank_accounts_update" ON "payroll_bank_accounts"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('payroll.bank_accounts.read', 'payroll', 'MEDIUM', 'Read masked Employee payroll bank accounts'),
  ('payroll.bank_accounts.manage', 'payroll', 'HIGH', 'Maintain Employee payroll bank accounts'),
  ('payroll.bank_accounts.reveal', 'payroll', 'HIGH', 'Reveal an Employee payroll bank account number'),
  ('payroll.bank_accounts.history.read', 'payroll', 'MEDIUM', 'Read Employee payroll bank account history')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('payroll_preparer', 'Payroll Preparer', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'payroll.bank_accounts.read',
  'payroll.bank_accounts.manage',
  'payroll.bank_accounts.history.read'
)
WHERE r."code" IN ('personnel_records_officer', 'payroll_preparer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payroll.bank_accounts.reveal'
WHERE r."code" = 'payroll_preparer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'payroll.bank_accounts.read',
  'payroll.bank_accounts.history.read'
)
WHERE r."code" = 'internal_auditor' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
