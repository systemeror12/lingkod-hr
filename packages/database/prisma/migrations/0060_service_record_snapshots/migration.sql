CREATE TABLE "service_record_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "as_of_date" DATE NOT NULL,
  "rendering_contract_version" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "generated_by_membership_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersedes_snapshot_id" UUID,
  "correction_reason" TEXT,
  "correction_evidence_document_id" UUID,
  "correction_evidence_document_version_id" UUID,
  CONSTRAINT "service_record_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_record_snapshots_contract_check"
    CHECK (btrim("rendering_contract_version") <> ''),
  CONSTRAINT "service_record_snapshots_snapshot_check"
    CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "service_record_snapshots_correction_check" CHECK (
    ("supersedes_snapshot_id" IS NULL
      AND "correction_reason" IS NULL
      AND "correction_evidence_document_id" IS NULL
      AND "correction_evidence_document_version_id" IS NULL)
    OR
    ("supersedes_snapshot_id" IS NOT NULL
      AND btrim("correction_reason") <> ''
      AND "correction_evidence_document_id" IS NOT NULL
      AND "correction_evidence_document_version_id" IS NOT NULL)
  ),
  CONSTRAINT "service_record_snapshots_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "service_record_snapshots_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_record_snapshots_generator_fkey"
    FOREIGN KEY ("agency_id", "generated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_record_snapshots_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_snapshot_id")
    REFERENCES "service_record_snapshots"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_record_snapshots_correction_document_fkey"
    FOREIGN KEY ("agency_id", "correction_evidence_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_record_snapshots_correction_version_fkey"
    FOREIGN KEY (
      "agency_id", "correction_evidence_document_id", "correction_evidence_document_version_id"
    ) REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "service_record_snapshots_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "service_record_snapshots_one_replacement_key"
    UNIQUE ("agency_id", "supersedes_snapshot_id")
);

CREATE INDEX "service_record_snapshots_employee_generated_idx"
  ON "service_record_snapshots" ("agency_id", "employee_id", "generated_at" DESC);

CREATE FUNCTION guard_service_record_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  superseded "service_record_snapshots"%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Service Record snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.service_record_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Service Record generation requires the application service' USING ERRCODE = '55000';
  END IF;
  IF NEW."supersedes_snapshot_id" IS NOT NULL THEN
    SELECT * INTO superseded
    FROM "service_record_snapshots"
    WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."supersedes_snapshot_id";
    IF NOT FOUND
      OR superseded."employee_id" IS DISTINCT FROM NEW."employee_id"
      OR superseded."as_of_date" IS DISTINCT FROM NEW."as_of_date" THEN
      RAISE EXCEPTION 'A replacement must preserve the superseded Employee and as-of date'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "service_record_snapshots_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "service_record_snapshots"
  FOR EACH ROW EXECUTE FUNCTION guard_service_record_snapshot_mutation();

GRANT SELECT, INSERT ON TABLE "service_record_snapshots" TO hris_app;

ALTER TABLE "service_record_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_record_snapshots" FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_record_snapshots_select" ON "service_record_snapshots"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "service_record_snapshots_insert" ON "service_record_snapshots"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.service_records.read', 'personnel', 'HIGH', 'Read permitted Service Record snapshots'),
  ('personnel.service_records.generate', 'personnel', 'HIGH', 'Generate Service Record snapshots'),
  ('personnel.service_records.replace', 'personnel', 'HIGH', 'Create reasoned Service Record replacements'),
  ('personnel.service_records.audit.read', 'personnel', 'MEDIUM', 'Read Service Record history')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.service_records.read', 'personnel.service_records.generate',
  'personnel.service_records.replace', 'personnel.service_records.audit.read'
)
WHERE r."code" IN ('personnel_records_officer', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'personnel.service_records.read'
WHERE r."code" = 'employee' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.service_records.read', 'personnel.service_records.audit.read'
)
WHERE r."code" IN ('data_protection_officer', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
