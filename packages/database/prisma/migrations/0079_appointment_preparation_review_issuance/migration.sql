-- Phase 6 Appointment preparation, review, and issuance. Appointment accepts an
-- immutable Recruitment selected-candidate package through Recruitment's
-- application service, revalidates the Plantilla reservation through Plantilla,
-- and moves through DRAFT -> FOR_REVIEW -> FOR_SIGNATURE -> ISSUED | CANCELLED.
-- Issued versions and their evidence links are frozen. Corrections create a
-- linked successor version with reason and authority evidence. The evidenced
-- Agency regulatory status selects the CS Form No. 33 variant; missing
-- configuration blocks preparation and issuance.

CREATE TABLE "appointment_agency_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "regulatory_status" TEXT NOT NULL
    CHECK ("regulatory_status" IN ('REGULATED', 'ACCREDITED_OR_DEREGULATED')),
  "status_evidence_document_version_id" UUID NOT NULL,
  "configured_by_membership_id" UUID NOT NULL,
  "configured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "appointment_agency_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_agency_settings_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_agency_settings_evidence_fkey"
    FOREIGN KEY ("agency_id", "status_evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_agency_settings_configured_by_fkey"
    FOREIGN KEY ("agency_id", "configured_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_agency_settings_updated_by_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_agency_settings_agency_key" UNIQUE ("agency_id"),
  CONSTRAINT "appointment_agency_settings_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "appointments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "recruitment_handoff_id" UUID NOT NULL,
  "recruitment_selection_package" JSONB NOT NULL,
  "position_id" UUID NOT NULL,
  "appointee_person_key" UUID NOT NULL,
  "workflow_status" TEXT NOT NULL
    CHECK ("workflow_status" IN ('DRAFT', 'FOR_REVIEW', 'FOR_SIGNATURE', 'ISSUED', 'CANCELLED')),
  "current_version_id" UUID,
  "issued_at" TIMESTAMPTZ(6),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointments_handoff_fkey"
    FOREIGN KEY ("agency_id", "recruitment_handoff_id")
    REFERENCES "recruitment_appointment_handoffs"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointments_position_fkey"
    FOREIGN KEY ("agency_id", "position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointments_created_by_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointments_updated_by_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointments_status_check"
    CHECK ("workflow_status" <> 'ISSUED' OR "issued_at" IS NOT NULL),
  CONSTRAINT "appointments_agency_handoff_key" UNIQUE ("agency_id", "recruitment_handoff_id"),
  CONSTRAINT "appointments_agency_id_key" UNIQUE ("agency_id", "id")
);

-- One non-cancelled Appointment per Plantilla Position. A cancelled Appointment
-- releases the position for a later, source-backed selection and appointment.
CREATE UNIQUE INDEX "appointments_active_position_uq"
  ON "appointments" ("agency_id", "position_id")
  WHERE "workflow_status" <> 'CANCELLED';

CREATE INDEX "appointments_workflow_idx"
  ON "appointments" ("agency_id", "workflow_status", "created_at");

CREATE TABLE "appointment_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "employment_status" TEXT NOT NULL
    CHECK ("employment_status" IN (
      'PERMANENT', 'TEMPORARY', 'COTERMINOUS', 'FIXED_TERM',
      'CONTRACTUAL', 'SUBSTITUTE', 'PROVISIONAL'
    )),
  "nature_of_appointment" TEXT NOT NULL
    CHECK ("nature_of_appointment" IN (
      'ORIGINAL', 'PROMOTION', 'TRANSFER', 'REEMPLOYMENT', 'REAPPOINTMENT',
      'REINSTATEMENT', 'RECLASSIFICATION', 'DEMOTION'
    )),
  "salary_grade" INTEGER NOT NULL CHECK ("salary_grade" > 0),
  "salary_step" INTEGER NOT NULL CHECK ("salary_step" > 0),
  "effectivity_date" DATE NOT NULL,
  "appointing_authority_membership_id" UUID NOT NULL,
  "form_variant" TEXT NOT NULL
    CHECK ("form_variant" IN ('CS_FORM_33_A_2025', 'CS_FORM_33_B_2025')),
  "signature_method" TEXT NOT NULL
    CHECK ("signature_method" IN ('WET_INK', 'ELECTRONIC', 'DIGITAL_CERTIFICATE')),
  "signature_evidence_document_version_id" UUID,
  "appointment_document_version_id" UUID NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'ISSUED', 'SUPERSEDED')),
  "issued_at" TIMESTAMPTZ(6),
  "issued_by_membership_id" UUID,
  "replaces_version_id" UUID,
  "correction_reason" TEXT,
  "correction_authority_document_version_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "appointment_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_appointment_fkey"
    FOREIGN KEY ("agency_id", "appointment_id")
    REFERENCES "appointments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_authority_fkey"
    FOREIGN KEY ("agency_id", "appointing_authority_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_form_fkey"
    FOREIGN KEY ("agency_id", "appointment_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_signature_evidence_fkey"
    FOREIGN KEY ("agency_id", "signature_evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_replaces_fkey"
    FOREIGN KEY ("agency_id", "replaces_version_id")
    REFERENCES "appointment_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_correction_authority_fkey"
    FOREIGN KEY ("agency_id", "correction_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_issued_by_fkey"
    FOREIGN KEY ("agency_id", "issued_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_versions_signature_check"
    CHECK ("signature_method" = 'WET_INK' OR "signature_evidence_document_version_id" IS NOT NULL),
  CONSTRAINT "appointment_versions_successor_check"
    CHECK (
      "replaces_version_id" IS NULL
      OR ("correction_reason" IS NOT NULL AND "correction_authority_document_version_id" IS NOT NULL)
    ),
  CONSTRAINT "appointment_versions_issued_check"
    CHECK ("status" <> 'ISSUED' OR ("issued_at" IS NOT NULL AND "issued_by_membership_id" IS NOT NULL)),
  CONSTRAINT "appointment_versions_draft_issued_check"
    CHECK ("issued_at" IS NULL OR "status" <> 'DRAFT'),
  CONSTRAINT "appointment_versions_number_key" UNIQUE ("appointment_id", "version_no"),
  CONSTRAINT "appointment_versions_agency_appointment_id_key"
    UNIQUE ("agency_id", "appointment_id", "id"),
  CONSTRAINT "appointment_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "appointment_document_version_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "appointment_version_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "link_role" TEXT NOT NULL
    CHECK ("link_role" IN (
      'PDS', 'WORK_EXPERIENCE_SHEET', 'ELIGIBILITY_PROOF', 'POSITION_DESCRIPTION_FORM',
      'SELECTION_CERTIFICATION', 'PUBLICATION_CERTIFICATION', 'AUTHORITY_OR_DELEGATION',
      'CONDITION_SPECIFIC_ATTACHMENT'
    )),
  CONSTRAINT "appointment_document_version_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_document_version_links_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_document_version_links_version_fkey"
    FOREIGN KEY ("agency_id", "appointment_version_id")
    REFERENCES "appointment_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_document_version_links_document_version_fkey"
    FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_document_version_links_role_key"
    UNIQUE ("appointment_version_id", "document_version_id", "link_role"),
  CONSTRAINT "appointment_document_version_links_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_current_version_fk"
  FOREIGN KEY ("agency_id", "id", "current_version_id")
  REFERENCES "appointment_versions"("agency_id", "appointment_id", "id")
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION guard_appointment_agency_settings_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Appointment settings require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Appointment settings are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id" THEN
    RAISE EXCEPTION 'Appointment settings identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_appointment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Appointments require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Appointments are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."workflow_status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Appointments begin as drafts' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "recruitment_appointment_handoffs" handoff
      WHERE handoff."agency_id" = NEW."agency_id"
        AND handoff."id" = NEW."recruitment_handoff_id"
        AND handoff."position_id" = NEW."position_id"
    ) THEN
      RAISE EXCEPTION 'Appointments must bind their Recruitment handoff and Plantilla Position' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."recruitment_handoff_id" IS DISTINCT FROM NEW."recruitment_handoff_id"
    OR OLD."recruitment_selection_package" IS DISTINCT FROM NEW."recruitment_selection_package"
    OR OLD."position_id" IS DISTINCT FROM NEW."position_id"
    OR OLD."appointee_person_key" IS DISTINCT FROM NEW."appointee_person_key"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Appointment identity and its Recruitment package are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."workflow_status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelled Appointments are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."workflow_status" = 'DRAFT'
    AND NEW."workflow_status" NOT IN ('DRAFT', 'FOR_REVIEW') THEN
    RAISE EXCEPTION 'Draft Appointment has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."workflow_status" = 'FOR_REVIEW'
    AND NEW."workflow_status" NOT IN ('FOR_REVIEW', 'DRAFT', 'FOR_SIGNATURE') THEN
    RAISE EXCEPTION 'Appointment under review has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."workflow_status" = 'FOR_SIGNATURE'
    AND NEW."workflow_status" NOT IN ('FOR_SIGNATURE', 'ISSUED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Appointment awaiting signature has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."workflow_status" = 'ISSUED'
    AND NEW."workflow_status" NOT IN ('ISSUED', 'CANCELLED', 'DRAFT') THEN
    RAISE EXCEPTION 'Issued Appointment has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF NEW."workflow_status" = 'ISSUED' AND NEW."issued_at" IS NULL THEN
    RAISE EXCEPTION 'Issued Appointments require an issuance time' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_appointment_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Appointment versions require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Appointment versions are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Appointment versions begin as drafts' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "appointments" appointment
      WHERE appointment."agency_id" = NEW."agency_id"
        AND appointment."id" = NEW."appointment_id"
        AND appointment."workflow_status" IN ('DRAFT', 'ISSUED')
    ) THEN
      RAISE EXCEPTION 'Appointment versions require an editable Appointment' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."appointment_id" IS DISTINCT FROM NEW."appointment_id"
    OR OLD."version_no" IS DISTINCT FROM NEW."version_no"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Appointment version identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded Appointment versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'ISSUED' THEN
    IF NEW."status" <> 'SUPERSEDED' THEN
      RAISE EXCEPTION 'Issued Appointment versions are frozen' USING ERRCODE = '55000';
    END IF;
    IF NEW."employment_status" IS DISTINCT FROM OLD."employment_status"
      OR NEW."nature_of_appointment" IS DISTINCT FROM OLD."nature_of_appointment"
      OR NEW."salary_grade" IS DISTINCT FROM OLD."salary_grade"
      OR NEW."salary_step" IS DISTINCT FROM OLD."salary_step"
      OR NEW."effectivity_date" IS DISTINCT FROM OLD."effectivity_date"
      OR NEW."appointing_authority_membership_id" IS DISTINCT FROM OLD."appointing_authority_membership_id"
      OR NEW."form_variant" IS DISTINCT FROM OLD."form_variant"
      OR NEW."signature_method" IS DISTINCT FROM OLD."signature_method"
      OR NEW."signature_evidence_document_version_id" IS DISTINCT FROM OLD."signature_evidence_document_version_id"
      OR NEW."appointment_document_version_id" IS DISTINCT FROM OLD."appointment_document_version_id"
      OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
      OR NEW."issued_by_membership_id" IS DISTINCT FROM OLD."issued_by_membership_id"
      OR NEW."replaces_version_id" IS DISTINCT FROM OLD."replaces_version_id"
      OR NEW."correction_reason" IS DISTINCT FROM OLD."correction_reason"
      OR NEW."correction_authority_document_version_id" IS DISTINCT FROM OLD."correction_authority_document_version_id" THEN
      RAISE EXCEPTION 'Issued Appointment versions are frozen' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" NOT IN ('DRAFT', 'ISSUED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'Draft Appointment version has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'ISSUED'
    AND (NEW."issued_at" IS NULL OR NEW."issued_by_membership_id" IS NULL) THEN
    RAISE EXCEPTION 'Issued Appointment versions require an issuer and issuance time' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_appointment_document_version_link_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
  row_agency_id UUID;
  row_version_id UUID;
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Appointment evidence requires the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Appointment evidence links are replaced, not updated' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    row_agency_id := OLD."agency_id";
    row_version_id := OLD."appointment_version_id";
  ELSE
    row_agency_id := NEW."agency_id";
    row_version_id := NEW."appointment_version_id";
  END IF;
  SELECT version."status" INTO version_status
  FROM "appointment_versions" version
  WHERE version."agency_id" = row_agency_id
    AND version."id" = row_version_id;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Issued Appointment evidence is frozen' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "appointment_agency_settings_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "appointment_agency_settings"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_agency_settings_mutation();
CREATE TRIGGER "appointments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_mutation();
CREATE TRIGGER "appointment_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "appointment_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_version_mutation();
CREATE TRIGGER "appointment_document_version_links_mutation_trigger"
  BEFORE INSERT OR DELETE ON "appointment_document_version_links"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_document_version_link_mutation();

CREATE TRIGGER "appointment_agency_settings_set_updated_at_trigger"
  BEFORE UPDATE ON "appointment_agency_settings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "appointments_set_updated_at_trigger"
  BEFORE UPDATE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "appointment_versions_set_updated_at_trigger"
  BEFORE UPDATE ON "appointment_versions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();

GRANT SELECT, INSERT, UPDATE ON TABLE "appointment_agency_settings" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "appointments" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "appointment_versions" TO hris_app;
GRANT SELECT, INSERT, DELETE ON TABLE "appointment_document_version_links" TO hris_app;

REVOKE DELETE ON TABLE "appointment_agency_settings" FROM hris_app;
REVOKE DELETE ON TABLE "appointments" FROM hris_app;
REVOKE DELETE ON TABLE "appointment_versions" FROM hris_app;
REVOKE UPDATE ON TABLE "appointment_document_version_links" FROM hris_app;

ALTER TABLE "appointment_agency_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_agency_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointment_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointment_document_version_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_document_version_links" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appointment_agency_settings_rls_select"
  ON "appointment_agency_settings" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "appointment_agency_settings_rls_insert"
  ON "appointment_agency_settings" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');
CREATE POLICY "appointment_agency_settings_rls_update"
  ON "appointment_agency_settings" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "appointments_rls_select"
  ON "appointments" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "appointments_rls_insert"
  ON "appointments" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');
CREATE POLICY "appointments_rls_update"
  ON "appointments" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "appointment_versions_rls_select"
  ON "appointment_versions" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "appointment_versions_rls_insert"
  ON "appointment_versions" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');
CREATE POLICY "appointment_versions_rls_update"
  ON "appointment_versions" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "appointment_document_version_links_rls_select"
  ON "appointment_document_version_links" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "appointment_document_version_links_rls_insert"
  ON "appointment_document_version_links" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');
CREATE POLICY "appointment_document_version_links_rls_delete"
  ON "appointment_document_version_links" FOR DELETE
  USING ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('appointments.records.read', 'appointments', 'MEDIUM', 'Read Appointment records, versions, evidence, and workflow history'),
  ('appointments.records.create', 'appointments', 'HIGH', 'Prepare Appointment records and draft versions from a selected candidate'),
  ('appointments.records.submit', 'appointments', 'HIGH', 'Submit an Appointment draft for review'),
  ('appointments.records.return', 'appointments', 'HIGH', 'Return an Appointment draft for correction with a required reason'),
  ('appointments.records.endorse', 'appointments', 'CRITICAL', 'Endorse a reviewed Appointment for signature'),
  ('appointments.records.issue', 'appointments', 'CRITICAL', 'Issue the reviewed Appointment as the appointing authority'),
  ('appointments.records.cancel', 'appointments', 'CRITICAL', 'Cancel an unsignable or unassumed Appointment with authority and reason'),
  ('appointments.settings.manage', 'appointments', 'CRITICAL', 'Configure the evidenced Agency regulatory status and Appointment form path')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'appointments.records.read', 'appointments.records.create', 'appointments.records.submit',
  'appointments.records.return', 'appointments.records.endorse',
  'appointments.records.cancel', 'appointments.settings.manage'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'personnel_records_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'appointments.records.read', 'appointments.records.issue', 'appointments.records.cancel'
)
WHERE r."code" = 'appointing_authority' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('appointments.records.read')
WHERE r."code" IN ('budget_officer', 'internal_auditor') AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appointment_agency_settings'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appointments'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appointment_versions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appointment_document_version_links'::regclass), false) THEN
    RAISE EXCEPTION 'Appointment migration verification failed';
  END IF;
END;
$$;
