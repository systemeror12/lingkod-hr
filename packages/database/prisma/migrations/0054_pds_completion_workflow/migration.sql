ALTER TABLE "pds_versions"
  ADD COLUMN "employee_certified_at" TIMESTAMPTZ(6),
  ADD COLUMN "employee_certified_by_membership_id" UUID,
  ADD COLUMN "hr_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "hr_verified_by_membership_id" UUID,
  ADD CONSTRAINT "pds_versions_employee_certifier_fkey"
    FOREIGN KEY ("agency_id", "employee_certified_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "pds_versions_hr_verifier_fkey"
    FOREIGN KEY ("agency_id", "hr_verified_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "pds_versions_employee_certifier_pair_check"
    CHECK (("employee_certified_at" IS NULL) = ("employee_certified_by_membership_id" IS NULL)),
  ADD CONSTRAINT "pds_versions_hr_verifier_pair_check"
    CHECK (("hr_verified_at" IS NULL) = ("hr_verified_by_membership_id" IS NULL));

ALTER TABLE "pds_wes_artifacts"
  ADD COLUMN "employee_signature_document_id" UUID,
  ADD COLUMN "employee_signature_document_version_id" UUID,
  ADD COLUMN "signed_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "pds_wes_artifacts_employee_signature_pair_check"
    CHECK (("employee_signature_document_id" IS NULL) = ("employee_signature_document_version_id" IS NULL)),
  ADD CONSTRAINT "pds_wes_artifacts_employee_signature_document_fkey"
    FOREIGN KEY ("agency_id", "employee_signature_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "pds_wes_artifacts_employee_signature_version_fkey"
    FOREIGN KEY ("agency_id", "employee_signature_document_id", "employee_signature_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT;

CREATE TABLE "pds_other_information" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "skills_and_hobbies" TEXT,
  "non_academic_distinctions" TEXT,
  "association_memberships" TEXT,
  CONSTRAINT "pds_other_information_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_other_information_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_other_information_version_key" UNIQUE ("agency_id", "pds_version_id"),
  CONSTRAINT "pds_other_information_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_other_information_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "pds_declaration_details" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "related_within_third_degree" BOOLEAN,
  "related_within_third_degree_details" TEXT,
  "related_within_fourth_degree_lgu" BOOLEAN,
  "related_within_fourth_degree_details" TEXT,
  "administrative_offense" BOOLEAN,
  "administrative_offense_details" TEXT,
  "criminal_charge" BOOLEAN,
  "criminal_case_details" TEXT,
  "criminal_case_date" DATE,
  "criminal_case_date_unknown" BOOLEAN,
  "criminal_case_status" TEXT,
  "conviction" BOOLEAN,
  "conviction_details" TEXT,
  "separated_from_service" BOOLEAN,
  "separation_details" TEXT,
  "separation_mode" TEXT,
  "election_candidacy" BOOLEAN,
  "election_candidacy_details" TEXT,
  "resigned_before_election" BOOLEAN,
  "resigned_before_election_details" TEXT,
  "immigrant_permanent_resident" BOOLEAN,
  "immigrant_permanent_resident_country" TEXT,
  "immigrant_permanent_resident_details" TEXT,
  "indigenous_group_member" BOOLEAN,
  "indigenous_group" TEXT,
  "person_with_disability" BOOLEAN,
  "disability_specification" TEXT,
  "disability_id_number" TEXT,
  "solo_parent" BOOLEAN,
  "solo_parent_specification" TEXT,
  "solo_parent_id_number" TEXT,
  CONSTRAINT "pds_declaration_details_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_declaration_details_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_declaration_details_version_key" UNIQUE ("agency_id", "pds_version_id"),
  CONSTRAINT "pds_declaration_details_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_declaration_details_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_declaration_details_case_date_check"
    CHECK ("criminal_case_date" IS NULL OR "criminal_case_date" <= CURRENT_DATE)
);

CREATE TABLE "pds_reference_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "contact" TEXT NOT NULL,
  CONSTRAINT "pds_reference_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_reference_records_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_reference_records_sequence_key" UNIQUE ("agency_id", "pds_version_id", "sequence_no"),
  CONSTRAINT "pds_reference_records_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_reference_records_required_text_check"
    CHECK (length(btrim("name")) > 0 AND length(btrim("address")) > 0 AND length(btrim("contact")) > 0),
  CONSTRAINT "pds_reference_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_reference_records_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT
);
CREATE INDEX "pds_reference_records_version_sequence_idx"
  ON "pds_reference_records" ("agency_id", "pds_version_id", "sequence_no");

CREATE TABLE "pds_certification_details" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "truth_declaration_accepted" BOOLEAN,
  "authorization_accepted" BOOLEAN,
  "misrepresentation_warning_accepted" BOOLEAN,
  "photo_document_id" UUID,
  "photo_document_version_id" UUID,
  "government_id_type" TEXT,
  "government_id_number" TEXT,
  "government_id_issued_at" DATE,
  "government_id_issued_place" TEXT,
  "employee_signature_document_id" UUID,
  "employee_signature_document_version_id" UUID,
  "employee_date_accomplished" DATE,
  "thumbmark_document_id" UUID,
  "thumbmark_document_version_id" UUID,
  "subscribed_and_sworn_text" TEXT,
  "subscribed_and_sworn_at" TIMESTAMPTZ(6),
  "oath_administered_by" TEXT,
  "oath_administrator_signature_document_id" UUID,
  "oath_administrator_signature_document_version_id" UUID,
  "oath_administered_at" TIMESTAMPTZ(6),
  CONSTRAINT "pds_certification_details_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_certification_details_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_certification_details_version_key" UNIQUE ("agency_id", "pds_version_id"),
  CONSTRAINT "pds_certification_details_required_text_check"
    CHECK (("government_id_type" IS NULL OR length(btrim("government_id_type")) > 0)
      AND ("government_id_number" IS NULL OR length(btrim("government_id_number")) > 0)
      AND ("government_id_issued_place" IS NULL OR length(btrim("government_id_issued_place")) > 0)
      AND ("subscribed_and_sworn_text" IS NULL OR length(btrim("subscribed_and_sworn_text")) > 0)
      AND ("oath_administered_by" IS NULL OR length(btrim("oath_administered_by")) > 0)),
  CONSTRAINT "pds_certification_details_photo_pair_check"
    CHECK (("photo_document_id" IS NULL) = ("photo_document_version_id" IS NULL)),
  CONSTRAINT "pds_certification_details_employee_signature_pair_check"
    CHECK (("employee_signature_document_id" IS NULL) = ("employee_signature_document_version_id" IS NULL)),
  CONSTRAINT "pds_certification_details_thumbmark_pair_check"
    CHECK (("thumbmark_document_id" IS NULL) = ("thumbmark_document_version_id" IS NULL)),
  CONSTRAINT "pds_certification_details_oath_signature_pair_check"
    CHECK (("oath_administrator_signature_document_id" IS NULL) = ("oath_administrator_signature_document_version_id" IS NULL)),
  CONSTRAINT "pds_certification_details_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_photo_document_fkey"
    FOREIGN KEY ("agency_id", "photo_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_photo_version_fkey"
    FOREIGN KEY ("agency_id", "photo_document_id", "photo_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_employee_signature_document_fkey"
    FOREIGN KEY ("agency_id", "employee_signature_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_employee_signature_version_fkey"
    FOREIGN KEY ("agency_id", "employee_signature_document_id", "employee_signature_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_thumbmark_document_fkey"
    FOREIGN KEY ("agency_id", "thumbmark_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_thumbmark_version_fkey"
    FOREIGN KEY ("agency_id", "thumbmark_document_id", "thumbmark_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_oath_signature_document_fkey"
    FOREIGN KEY ("agency_id", "oath_administrator_signature_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_certification_details_oath_signature_version_fkey"
    FOREIGN KEY ("agency_id", "oath_administrator_signature_document_id", "oath_administrator_signature_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "pds_page_signatures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "page_key" TEXT NOT NULL,
  "signature_document_id" UUID,
  "signature_document_version_id" UUID,
  "signed_at" TIMESTAMPTZ(6),
  "signature_date" DATE,
  CONSTRAINT "pds_page_signatures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_page_signatures_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_page_signatures_page_key" UNIQUE ("agency_id", "pds_version_id", "page_key"),
  CONSTRAINT "pds_page_signatures_page_key_check" CHECK (length(btrim("page_key")) > 0),
  CONSTRAINT "pds_page_signatures_signature_pair_check"
    CHECK (("signature_document_id" IS NULL) = ("signature_document_version_id" IS NULL)),
  CONSTRAINT "pds_page_signatures_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_page_signatures_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_page_signatures_document_fkey"
    FOREIGN KEY ("agency_id", "signature_document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_page_signatures_version_evidence_fkey"
    FOREIGN KEY ("agency_id", "signature_document_id", "signature_document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "pds_transition_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_membership_id" UUID NOT NULL,
  "reason" TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_snapshot" JSONB,
  CONSTRAINT "pds_transition_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_transition_events_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_transition_events_status_check"
    CHECK ("from_status" IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'CERTIFIED', 'SUPERSEDED')
      AND "to_status" IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'CERTIFIED', 'SUPERSEDED')),
  CONSTRAINT "pds_transition_events_required_text_check"
    CHECK (length(btrim("action")) > 0),
  CONSTRAINT "pds_transition_events_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_transition_events_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_transition_events_actor_user_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_transition_events_actor_membership_fkey"
    FOREIGN KEY ("agency_id", "actor_membership_id", "actor_user_id")
    REFERENCES "agency_memberships"("agency_id", "id", "user_id") ON DELETE RESTRICT
);
CREATE INDEX "pds_transition_events_version_time_idx"
  ON "pds_transition_events" ("agency_id", "pds_version_id", "occurred_at");

CREATE TABLE "pds_output_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "wes_artifact_id" UUID,
  "output_key" TEXT NOT NULL,
  "output_type" TEXT NOT NULL,
  "form_version" TEXT NOT NULL,
  "template_version" TEXT,
  "source_artifact_id" TEXT NOT NULL,
  "source_artifact_hash" TEXT NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "data_as_of_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RELEASED',
  "rendering_metadata" JSONB NOT NULL,
  "signature_metadata" JSONB NOT NULL,
  "rendered_content" JSONB NOT NULL,
  CONSTRAINT "pds_output_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_output_artifacts_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_output_artifacts_output_key" UNIQUE ("agency_id", "pds_version_id", "output_key"),
  CONSTRAINT "pds_output_artifacts_type_check" CHECK ("output_type" IN ('PDS', 'WES')),
  CONSTRAINT "pds_output_artifacts_status_check" CHECK ("status" = 'RELEASED'),
  CONSTRAINT "pds_output_artifacts_required_text_check"
    CHECK (length(btrim("output_key")) > 0
      AND length(btrim("form_version")) > 0
      AND length(btrim("source_artifact_id")) > 0
      AND length(btrim("source_artifact_hash")) > 0),
  CONSTRAINT "pds_output_artifacts_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_output_artifacts_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_output_artifacts_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id", "employee_id")
    REFERENCES "pds_versions"("agency_id", "id", "employee_id") ON DELETE RESTRICT,
  CONSTRAINT "pds_output_artifacts_wes_artifact_fkey"
    FOREIGN KEY ("agency_id", "wes_artifact_id", "pds_version_id")
    REFERENCES "pds_wes_artifacts"("agency_id", "id", "pds_version_id") ON DELETE RESTRICT
);
CREATE INDEX "pds_output_artifacts_employee_status_idx"
  ON "pds_output_artifacts" ("agency_id", "employee_id", "status");

CREATE OR REPLACE FUNCTION guard_pds_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  transition_is_allowed BOOLEAN;
BEGIN
  IF current_setting('app.pds_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'PDS versions are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PDS versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'PDS versions must start as drafts'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."version_no" IS DISTINCT FROM NEW."version_no"
    OR OLD."form_version" IS DISTINCT FROM NEW."form_version"
    OR OLD."supersedes_version_id" IS DISTINCT FROM NEW."supersedes_version_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'PDS version identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = NEW."status" THEN
    IF OLD."status" IN ('DRAFT', 'RETURNED') THEN
      RETURN NEW;
    END IF;

    IF OLD."status" = 'SUBMITTED'
      AND OLD."employee_certified_at" IS NULL
      AND OLD."employee_certified_by_membership_id" IS NULL
      AND NEW."employee_certified_at" IS NOT NULL
      AND NEW."employee_certified_by_membership_id" IS NOT NULL
      AND (to_jsonb(OLD) - 'updated_by_membership_id' - 'updated_at' - 'row_version' - 'employee_certified_at' - 'employee_certified_by_membership_id')
        IS NOT DISTINCT FROM
        (to_jsonb(NEW) - 'updated_by_membership_id' - 'updated_at' - 'row_version' - 'employee_certified_at' - 'employee_certified_by_membership_id') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only draft or returned PDS versions may be edited'
      USING ERRCODE = '55000';
  END IF;

  transition_is_allowed := (OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED')
    OR (OLD."status" = 'RETURNED' AND NEW."status" = 'SUBMITTED')
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" = 'RETURNED')
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" = 'CERTIFIED')
    OR (OLD."status" = 'CERTIFIED' AND NEW."status" = 'SUPERSEDED');

  IF NOT transition_is_allowed THEN
    RAISE EXCEPTION 'Invalid PDS status transition from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUBMITTED' AND NEW."status" = 'CERTIFIED'
    AND (NEW."employee_certified_at" IS NULL
      OR NEW."employee_certified_by_membership_id" IS NULL
      OR NEW."hr_verified_at" IS NULL
      OR NEW."hr_verified_by_membership_id" IS NULL) THEN
    RAISE EXCEPTION 'Certified PDS versions require employee certification and HR verification'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'CERTIFIED' AND NEW."status" = 'SUPERSEDED'
    AND NOT EXISTS (
      SELECT 1
      FROM "pds_versions" successor
      WHERE successor."agency_id" = OLD."agency_id"
        AND successor."employee_id" = OLD."employee_id"
        AND successor."supersedes_version_id" = OLD."id"
        AND successor."status" = 'CERTIFIED'
    ) THEN
    RAISE EXCEPTION 'Certified PDS versions can be superseded only by a certified successor'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(OLD) - 'status' - 'updated_by_membership_id' - 'updated_at' - 'row_version' - 'employee_certified_at' - 'employee_certified_by_membership_id' - 'hr_verified_at' - 'hr_verified_by_membership_id')
    IS DISTINCT FROM
    (to_jsonb(NEW) - 'status' - 'updated_by_membership_id' - 'updated_at' - 'row_version' - 'employee_certified_at' - 'employee_certified_by_membership_id' - 'hr_verified_at' - 'hr_verified_by_membership_id') THEN
    RAISE EXCEPTION 'PDS status transitions cannot change declared content'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_pds_append_only()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.pds_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'PDS workflow rows are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PDS workflow and output rows are append-only'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "pds_other_information_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_other_information"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_declaration_details_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_declaration_details"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_reference_records_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_reference_records"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_certification_details_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_certification_details"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_page_signatures_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_page_signatures"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_transition_events_append_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_transition_events"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_append_only();
CREATE TRIGGER "pds_output_artifacts_append_only_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_output_artifacts"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_append_only();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_other_information" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_declaration_details" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_reference_records" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_certification_details" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_page_signatures" TO hris_app;
GRANT SELECT, INSERT ON TABLE "pds_transition_events" TO hris_app;
GRANT SELECT, INSERT ON TABLE "pds_output_artifacts" TO hris_app;

ALTER TABLE "pds_other_information" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_other_information" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_declaration_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_declaration_details" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_reference_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_reference_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_certification_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_certification_details" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_page_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_page_signatures" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_transition_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_transition_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_output_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_output_artifacts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pds_other_information_isolation" ON "pds_other_information"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_declaration_details_isolation" ON "pds_declaration_details"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_reference_records_isolation" ON "pds_reference_records"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_certification_details_isolation" ON "pds_certification_details"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_page_signatures_isolation" ON "pds_page_signatures"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_transition_events_isolation" ON "pds_transition_events"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_output_artifacts_isolation" ON "pds_output_artifacts"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
