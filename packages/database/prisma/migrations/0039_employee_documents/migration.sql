-- Personnel links reuse Document identity, immutable versions, and private
-- storage. This table owns only the Agency-scoped Employee relationship and
-- its controlled personnel meaning.

CREATE TABLE "employee_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "personnel_classification" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "release_state" TEXT NOT NULL DEFAULT 'PENDING',
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_documents_classification_check"
    CHECK ("personnel_classification" IN (
      'PDS',
      'WES',
      'APPOINTMENT',
      'OATH_OF_OFFICE',
      'ASSUMPTION_TO_DUTY',
      'MEDICAL',
      'CLEARANCE',
      'ELIGIBILITY',
      'EDUCATION',
      'TRAINING',
      'LICENSE',
      'PERFORMANCE',
      'SALN',
      'SALARY_ADJUSTMENT',
      'SEPARATION',
      'GOVERNMENT_IDENTIFIER',
      'BANK_ACCOUNT'
    )),
  CONSTRAINT "employee_documents_purpose_check"
    CHECK ("purpose" IN (
      'PDS_SUPPORT',
      'WES_SUPPORT',
      'APPOINTMENT_SUPPORT',
      'PERSONNEL_ACTION_SUPPORT',
      'SERVICE_RECORD_SUPPORT',
      'PAYROLL_SUPPORT',
      'LEAVE_SUPPORT',
      'PERFORMANCE_SUPPORT',
      'COMPLIANCE_SUPPORT',
      'OWN_RECORD_UPLOAD'
    )),
  CONSTRAINT "employee_documents_release_state_check"
    CHECK ("release_state" IN ('PENDING', 'RELEASED', 'WITHHELD')),
  CONSTRAINT "employee_documents_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "employee_documents_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_documents_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_documents_version_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_documents_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_documents_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "employee_documents_identity_key"
    UNIQUE ("agency_id", "employee_id", "document_version_id", "personnel_classification", "purpose")
);

CREATE INDEX "employee_documents_employee_created_idx"
  ON "employee_documents" ("agency_id", "employee_id", "created_at" DESC);
CREATE INDEX "employee_documents_employee_release_idx"
  ON "employee_documents" ("agency_id", "employee_id", "release_state");

CREATE OR REPLACE FUNCTION guard_employee_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.employee_document_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Employee Document links are managed by the application service'
      USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "employee_documents_mutation_trigger"
  BEFORE INSERT OR DELETE ON "employee_documents"
  FOR EACH ROW EXECUTE FUNCTION guard_employee_document_mutation();

GRANT SELECT, INSERT, DELETE ON TABLE "employee_documents" TO hris_app;

ALTER TABLE "employee_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY "employee_documents_select" ON "employee_documents"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "employee_documents_insert" ON "employee_documents"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "employee_documents_delete" ON "employee_documents"
  FOR DELETE USING ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.documents.read', 'personnel', 'MEDIUM', 'Read released Employee Personnel Documents'),
  ('personnel.documents.upload', 'personnel', 'HIGH', 'Upload Employee-owned Personnel Documents'),
  ('personnel.documents.classify', 'personnel', 'HIGH', 'Link and classify Employee Personnel Documents'),
  ('personnel.documents.read_sensitive', 'personnel', 'HIGH', 'Read restricted Employee Personnel Documents')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.documents.read',
  'personnel.documents.upload',
  'personnel.documents.classify',
  'personnel.documents.read_sensitive'
)
WHERE r."code" IN ('personnel_records_officer', 'hrmo_administrator', 'agency_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.documents.read',
  'personnel.documents.read_sensitive'
)
WHERE r."code" = 'internal_auditor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
