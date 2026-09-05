-- Correction plan: this table is authoritative append-only history. Roll forward with a
-- reviewed migration; never drop records to reverse this capability.
CREATE TABLE "saln_compliance_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "requirement_reference" TEXT NOT NULL,
  "filing_year" SMALLINT NOT NULL,
  "filing_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "submitted_at" TIMESTAMPTZ(6),
  "repository_reference" TEXT,
  "acknowledgment_document_id" UUID,
  "acknowledgment_document_version_id" UUID,
  "corrects_record_id" UUID,
  "correction_reason" TEXT,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saln_compliance_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saln_compliance_year_check" CHECK ("filing_year" BETWEEN 1900 AND 2200),
  CONSTRAINT "saln_compliance_text_check" CHECK (
    length(btrim("requirement_reference")) BETWEEN 1 AND 500
    AND length(btrim("filing_type")) BETWEEN 1 AND 80
    AND ("repository_reference" IS NULL OR length(btrim("repository_reference")) BETWEEN 1 AND 500)
  ),
  CONSTRAINT "saln_compliance_status_check" CHECK ("status" IN ('NOT_SUBMITTED', 'SUBMITTED', 'ACKNOWLEDGED')),
  CONSTRAINT "saln_compliance_submission_check" CHECK (
    ("status" = 'NOT_SUBMITTED' AND "submitted_at" IS NULL)
    OR ("status" IN ('SUBMITTED', 'ACKNOWLEDGED') AND "submitted_at" IS NOT NULL)
  ),
  CONSTRAINT "saln_compliance_acknowledgment_pair_check" CHECK (
    ("acknowledgment_document_id" IS NULL) = ("acknowledgment_document_version_id" IS NULL)
  ),
  CONSTRAINT "saln_compliance_correction_pair_check" CHECK (
    ("corrects_record_id" IS NULL) = ("correction_reason" IS NULL)
    AND ("correction_reason" IS NULL OR length(btrim("correction_reason")) BETWEEN 1 AND 1000)
  ),
  CONSTRAINT "saln_compliance_self_correction_check" CHECK ("corrects_record_id" IS NULL OR "corrects_record_id" <> "id"),
  CONSTRAINT "saln_compliance_agency_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "saln_compliance_employee_fkey" FOREIGN KEY ("agency_id", "employee_id") REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "saln_compliance_acknowledgment_document_fkey" FOREIGN KEY ("agency_id", "acknowledgment_document_id") REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "saln_compliance_acknowledgment_version_fkey" FOREIGN KEY ("agency_id", "acknowledgment_document_id", "acknowledgment_document_version_id") REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "saln_compliance_corrects_fkey" FOREIGN KEY ("agency_id", "corrects_record_id") REFERENCES "saln_compliance_records"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "saln_compliance_creator_fkey" FOREIGN KEY ("agency_id", "created_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "saln_compliance_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "saln_compliance_corrects_key" UNIQUE ("agency_id", "corrects_record_id")
);

CREATE INDEX "saln_compliance_employee_year_idx"
  ON "saln_compliance_records" ("agency_id", "employee_id", "filing_year" DESC);

CREATE FUNCTION guard_saln_compliance_append_only()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  source_employee_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'SALN compliance records are append-only' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.saln_compliance_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'SALN compliance records require the application service' USING ERRCODE = '55000';
  END IF;
  IF NEW."corrects_record_id" IS NOT NULL THEN
    SELECT "employee_id" INTO source_employee_id
    FROM "saln_compliance_records"
    WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."corrects_record_id";
    IF source_employee_id IS DISTINCT FROM NEW."employee_id" THEN
      RAISE EXCEPTION 'A SALN correction must retain the Employee' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "saln_compliance_append_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "saln_compliance_records"
  FOR EACH ROW EXECUTE FUNCTION guard_saln_compliance_append_only();

GRANT SELECT, INSERT ON TABLE "saln_compliance_records" TO hris_app;
ALTER TABLE "saln_compliance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saln_compliance_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "saln_compliance_select" ON "saln_compliance_records"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "saln_compliance_insert" ON "saln_compliance_records"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.saln_compliance.read', 'personnel', 'HIGH', 'Read authorized SALN filing compliance metadata'),
  ('personnel.saln_compliance.update', 'personnel', 'HIGH', 'Record and correct SALN filing compliance metadata')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.saln_compliance.read', 'personnel.saln_compliance.update'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'personnel.saln_compliance.read'
WHERE r."code" IN ('data_protection_officer', 'internal_auditor') AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'personnel.saln_compliance.read'
WHERE r."code" = 'employee' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
