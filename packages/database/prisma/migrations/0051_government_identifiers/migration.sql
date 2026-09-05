CREATE TABLE "government_identifiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "identifier_type" TEXT NOT NULL,
  "encrypted_value" BYTEA NOT NULL,
  "encryption_version" SMALLINT NOT NULL DEFAULT 1,
  "masked_value" TEXT NOT NULL,
  "verified_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "reason" TEXT,
  "evidence_document_id" UUID,
  "evidence_document_version_id" UUID,
  "replaces_identifier_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "government_identifiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "government_identifiers_type_check"
    CHECK ("identifier_type" IN ('UMID', 'PAGIBIG', 'PHILHEALTH', 'PHILSYS_PCN', 'TIN')),
  CONSTRAINT "government_identifiers_status_check"
    CHECK ("status" IN ('ACTIVE', 'REPLACED', 'INVALID')),
  CONSTRAINT "government_identifiers_masked_value_check"
    CHECK (length(btrim("masked_value")) > 0),
  CONSTRAINT "government_identifiers_effective_period_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "government_identifiers_evidence_pair_check"
    CHECK (("evidence_document_id" IS NULL) = ("evidence_document_version_id" IS NULL)),
  CONSTRAINT "government_identifiers_self_replacement_check"
    CHECK ("replaces_identifier_id" IS NULL OR "replaces_identifier_id" <> "id"),
  CONSTRAINT "government_identifiers_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "government_identifiers_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "government_identifiers_evidence_document_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "government_identifiers_evidence_version_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "government_identifiers_replaces_identifier_fkey"
    FOREIGN KEY ("agency_id", "replaces_identifier_id")
    REFERENCES "government_identifiers"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "government_identifiers_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "government_identifiers_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "government_identifiers_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "government_identifiers_replaces_identifier_key" UNIQUE ("agency_id", "replaces_identifier_id")
);

CREATE UNIQUE INDEX "government_identifiers_one_active_idx"
  ON "government_identifiers" ("agency_id", "employee_id", "identifier_type")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "government_identifiers_employee_effective_idx"
  ON "government_identifiers" ("agency_id", "employee_id", "identifier_type", "effective_from" DESC);

CREATE INDEX "government_identifiers_employee_status_idx"
  ON "government_identifiers" ("agency_id", "employee_id", "status");

CREATE OR REPLACE FUNCTION guard_government_identifier_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  replaced_employee_id UUID;
  replaced_identifier_type TEXT;
  replaced_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.government_identifier_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Government identifiers are managed by the application service'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Government identifiers must be created as active records'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."effective_to" IS NOT NULL THEN
      RAISE EXCEPTION 'Government identifiers cannot start with an end date'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."replaces_identifier_id" IS NOT NULL THEN
      SELECT "employee_id", "identifier_type", "status"
      INTO replaced_employee_id, replaced_identifier_type, replaced_status
      FROM "government_identifiers"
      WHERE "agency_id" = NEW."agency_id"
        AND "id" = NEW."replaces_identifier_id";

      IF replaced_employee_id IS DISTINCT FROM NEW."employee_id"
        OR replaced_identifier_type IS DISTINCT FROM NEW."identifier_type"
        OR replaced_status IS DISTINCT FROM 'REPLACED' THEN
        RAISE EXCEPTION 'Government identifier replacements must link the same employee and identifier type'
          USING ERRCODE = '23514';
      END IF;

      IF NEW."reason" IS NULL OR length(btrim(NEW."reason")) = 0 THEN
        RAISE EXCEPTION 'Government identifier replacements require a reason'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Government identifiers are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF current_setting('app.government_identifier_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Government identifiers are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."identifier_type" IS DISTINCT FROM OLD."identifier_type"
    OR NEW."encrypted_value" IS DISTINCT FROM OLD."encrypted_value"
    OR NEW."encryption_version" IS DISTINCT FROM OLD."encryption_version"
    OR NEW."masked_value" IS DISTINCT FROM OLD."masked_value"
    OR NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."evidence_document_id" IS DISTINCT FROM OLD."evidence_document_id"
    OR NEW."evidence_document_version_id" IS DISTINCT FROM OLD."evidence_document_version_id"
    OR NEW."replaces_identifier_id" IS DISTINCT FROM OLD."replaces_identifier_id"
    OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Government identifier identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('REPLACED', 'INVALID')) THEN
      RAISE EXCEPTION 'Government identifier status can only move from active to replaced or invalid'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF OLD."status" = 'ACTIVE'
    AND NEW."status" IN ('REPLACED', 'INVALID')
    AND (NEW."effective_to" IS NULL OR NEW."reason" IS NULL OR length(btrim(NEW."reason")) = 0) THEN
    RAISE EXCEPTION 'Government identifier transitions require an end date and reason'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
      OR NEW."reason" IS DISTINCT FROM OLD."reason")
    AND NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('REPLACED', 'INVALID')) THEN
    RAISE EXCEPTION 'Government identifier replacement details can only change during replacement or invalidation'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "government_identifiers_updated_at_trigger"
  BEFORE UPDATE ON "government_identifiers"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();

CREATE TRIGGER "government_identifiers_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "government_identifiers"
  FOR EACH ROW EXECUTE FUNCTION guard_government_identifier_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "government_identifiers" TO hris_app;

ALTER TABLE "government_identifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "government_identifiers" FORCE ROW LEVEL SECURITY;

CREATE POLICY "government_identifiers_select" ON "government_identifiers"
  FOR SELECT USING ("agency_id" = app_agency_id());

CREATE POLICY "government_identifiers_insert" ON "government_identifiers"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "government_identifiers_update" ON "government_identifiers"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.identifiers.read', 'personnel', 'MEDIUM', 'Read masked Employee government identifiers'),
  ('personnel.identifiers.manage', 'personnel', 'HIGH', 'Create, replace, and invalidate Employee government identifiers'),
  ('personnel.identifiers.reveal', 'personnel', 'HIGH', 'Reveal an Employee government identifier value'),
  ('personnel.identifiers.history.read', 'personnel', 'MEDIUM', 'Read Employee government identifier history')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.identifiers.read',
  'personnel.identifiers.manage',
  'personnel.identifiers.reveal',
  'personnel.identifiers.history.read'
)
WHERE r."code" IN ('personnel_records_officer', 'hrmo_administrator', 'agency_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.identifiers.read',
  'personnel.identifiers.history.read'
)
WHERE r."code" = 'internal_auditor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
