-- Phase 6 applicant intake and qualification screening. Recruitment owns
-- Applicant and Application identity, linked evidence, and versioned screening
-- results. Screening compares against the Qualification Standard Version bound
-- to the Recruitment Case and never mutates completed results.

CREATE SEQUENCE "applications_application_no_seq";

CREATE TABLE "applicants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "first_name" TEXT NOT NULL CHECK (btrim("first_name") <> ''),
  "middle_name" TEXT,
  "last_name" TEXT NOT NULL CHECK (btrim("last_name") <> ''),
  "suffix" TEXT,
  "email_normalized" CITEXT,
  "mobile_number" TEXT,
  "privacy_notice_version" TEXT NOT NULL CHECK (btrim("privacy_notice_version") <> ''),
  "consented_at" TIMESTAMPTZ(6) NOT NULL,
  "deduplication_key" TEXT NOT NULL CHECK (btrim("deduplication_key") <> ''),
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "applicants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "applicants_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "applicants_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applicants_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "applicants_agency_deduplication_key"
    UNIQUE ("agency_id", "deduplication_key")
);

CREATE INDEX "applicants_name_idx" ON "applicants" ("agency_id", "last_name", "first_name");

CREATE TABLE "applications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "application_no" INTEGER NOT NULL DEFAULT nextval('applications_application_no_seq'),
  "vacancy_publication_id" UUID NOT NULL,
  "applicant_id" UUID NOT NULL,
  "qualification_standard_version_id" UUID NOT NULL,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED', 'WITHDRAWN', 'CLOSED')),
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "received_by_membership_id" UUID NOT NULL,
  "late_acceptance_reason" TEXT,
  "late_acceptance_authority_document_version_id" UUID,
  "withdrawn_at" TIMESTAMPTZ(6),
  "withdrawal_reason" TEXT,
  "closed_at" TIMESTAMPTZ(6),
  "closure_reason" TEXT,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "applications_late_acceptance_check"
    CHECK (("late_acceptance_reason" IS NULL) = ("late_acceptance_authority_document_version_id" IS NULL)),
  CONSTRAINT "applications_withdrawal_check"
    CHECK ("withdrawn_at" IS NULL OR "withdrawal_reason" IS NOT NULL),
  CONSTRAINT "applications_closure_check"
    CHECK ("closed_at" IS NULL OR "closure_reason" IS NOT NULL),
  CONSTRAINT "applications_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "applications_publication_fkey"
    FOREIGN KEY ("agency_id", "vacancy_publication_id")
    REFERENCES "vacancy_publications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applications_applicant_fkey"
    FOREIGN KEY ("agency_id", "applicant_id")
    REFERENCES "applicants"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applications_qualification_fkey"
    FOREIGN KEY ("agency_id", "qualification_standard_version_id")
    REFERENCES "qualification_standard_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applications_late_authority_fkey"
    FOREIGN KEY ("agency_id", "late_acceptance_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applications_receiver_fkey"
    FOREIGN KEY ("agency_id", "received_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applications_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applications_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "applications_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "applications_agency_application_no_key" UNIQUE ("agency_id", "application_no"),
  CONSTRAINT "applications_publication_applicant_key"
    UNIQUE ("agency_id", "vacancy_publication_id", "applicant_id")
);

CREATE INDEX "applications_lookup_idx"
  ON "applications" ("agency_id", "vacancy_publication_id", "status", "created_at");
CREATE INDEX "applications_applicant_idx" ON "applications" ("agency_id", "applicant_id");

CREATE TABLE "application_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL
    CHECK ("purpose" IN (
      'PRIVACY_CONSENT', 'EDUCATION', 'TRAINING', 'EXPERIENCE', 'ELIGIBILITY',
      'LICENSE', 'COMPETENCY', 'SPECIAL_REQUIREMENT', 'OTHER'
    )),
  "note" TEXT,
  "linked_by_membership_id" UUID NOT NULL,
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_documents_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "application_documents_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_documents_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_documents_version_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_documents_linker_fkey"
    FOREIGN KEY ("agency_id", "linked_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_documents_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "application_documents_link_key"
    UNIQUE ("agency_id", "application_id", "document_version_id", "purpose")
);

CREATE INDEX "application_documents_lookup_idx"
  ON "application_documents" ("agency_id", "application_id", "linked_at");

CREATE TABLE "application_screenings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "qualification_standard_version_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "result" TEXT NOT NULL CHECK ("result" IN ('INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED')),
  "reason" TEXT NOT NULL CHECK (btrim("reason") <> ''),
  "area_results" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("area_results") = 'array'),
  "screened_by_membership_id" UUID NOT NULL,
  "screened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replaces_screening_id" UUID,
  "correction_reason" TEXT,
  "correction_authority_document_version_id" UUID,
  CONSTRAINT "application_screenings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_screenings_correction_check"
    CHECK (
      ("replaces_screening_id" IS NULL AND "correction_reason" IS NULL)
      OR (
        "replaces_screening_id" IS NOT NULL
        AND "correction_reason" IS NOT NULL
        AND btrim("correction_reason") <> ''
      )
    ),
  CONSTRAINT "application_screenings_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "application_screenings_application_fkey"
    FOREIGN KEY ("agency_id", "application_id")
    REFERENCES "applications"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_screenings_qualification_fkey"
    FOREIGN KEY ("agency_id", "qualification_standard_version_id")
    REFERENCES "qualification_standard_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_screenings_screener_fkey"
    FOREIGN KEY ("agency_id", "screened_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_screenings_replaces_fkey"
    FOREIGN KEY ("agency_id", "replaces_screening_id")
    REFERENCES "application_screenings"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_screenings_correction_authority_fkey"
    FOREIGN KEY ("agency_id", "correction_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_screenings_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "application_screenings_application_version_key"
    UNIQUE ("application_id", "version_no"),
  CONSTRAINT "application_screenings_agency_replaces_key"
    UNIQUE ("agency_id", "replaces_screening_id")
);

CREATE INDEX "application_screenings_lookup_idx"
  ON "application_screenings" ("agency_id", "application_id", "version_no");

CREATE TABLE "application_screening_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "screening_id" UUID NOT NULL,
  "application_document_id" UUID NOT NULL,
  "area" TEXT NOT NULL
    CHECK ("area" IN (
      'EDUCATION', 'TRAINING', 'EXPERIENCE', 'ELIGIBILITY',
      'LICENSES', 'COMPETENCIES', 'SPECIAL_REQUIREMENTS'
    )),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_screening_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_screening_evidence_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "application_screening_evidence_screening_fkey"
    FOREIGN KEY ("agency_id", "screening_id")
    REFERENCES "application_screenings"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_screening_evidence_document_fkey"
    FOREIGN KEY ("agency_id", "application_document_id")
    REFERENCES "application_documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "application_screening_evidence_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "application_screening_evidence_key"
    UNIQUE ("screening_id", "area", "application_document_id")
);

CREATE INDEX "application_screening_evidence_lookup_idx"
  ON "application_screening_evidence" ("agency_id", "screening_id");

-- Applicants are agency-scoped identities. Identity facts are created once and
-- never rewritten; duplicates are resolved by the Recruitment service through
-- the agency-scoped deduplication key before insert.
CREATE OR REPLACE FUNCTION guard_applicant_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Applicant identities are retained and cannot be changed' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Applicants require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- The Application binds the exact Qualification Standard Version of its
-- publication, keeps receipt facts immutable, and only moves through the
-- screening lifecycle defined in the control document.
CREATE OR REPLACE FUNCTION guard_application_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Applications are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Applications require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "vacancy_publications" publication
      WHERE publication."agency_id" = NEW."agency_id"
        AND publication."id" = NEW."vacancy_publication_id"
        AND publication."status" = 'PUBLISHED'
        AND publication."qualification_standard_version_id" = NEW."qualification_standard_version_id"
    ) THEN
      RAISE EXCEPTION 'Applications must bind a published Vacancy Publication and its Qualification Standard Version' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."application_no" IS DISTINCT FROM NEW."application_no"
    OR OLD."vacancy_publication_id" IS DISTINCT FROM NEW."vacancy_publication_id"
    OR OLD."applicant_id" IS DISTINCT FROM NEW."applicant_id"
    OR OLD."qualification_standard_version_id" IS DISTINCT FROM NEW."qualification_standard_version_id"
    OR OLD."received_at" IS DISTINCT FROM NEW."received_at"
    OR OLD."received_by_membership_id" IS DISTINCT FROM NEW."received_by_membership_id"
    OR OLD."late_acceptance_reason" IS DISTINCT FROM NEW."late_acceptance_reason"
    OR OLD."late_acceptance_authority_document_version_id" IS DISTINCT FROM NEW."late_acceptance_authority_document_version_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Application identity and receipt facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IN ('WITHDRAWN', 'CLOSED') THEN
    RAISE EXCEPTION 'Withdrawn or closed Applications are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'RECEIVED' AND NEW."status" NOT IN ('RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Received Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'INCOMPLETE' AND NEW."status" NOT IN ('INCOMPLETE', 'RECEIVED', 'QUALIFIED', 'NOT_QUALIFIED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Incomplete Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'QUALIFIED' AND NEW."status" NOT IN ('QUALIFIED', 'INCOMPLETE', 'NOT_QUALIFIED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Qualified Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'NOT_QUALIFIED' AND NEW."status" NOT IN ('NOT_QUALIFIED', 'INCOMPLETE', 'QUALIFIED', 'WITHDRAWN', 'CLOSED') THEN
    RAISE EXCEPTION 'Not qualified Application has an invalid transition' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'WITHDRAWN' AND (NEW."withdrawn_at" IS NULL OR NEW."withdrawal_reason" IS NULL) THEN
    RAISE EXCEPTION 'Withdrawn Applications require a withdrawal time and reason' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'CLOSED' AND (NEW."closed_at" IS NULL OR NEW."closure_reason" IS NULL) THEN
    RAISE EXCEPTION 'Closed Applications require a closure time and reason' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Linked evidence is append-only. A link may be removed only while the
-- Application has no completed screening, and the screening evidence foreign
-- key prevents removal of a document already used as screening evidence.
CREATE OR REPLACE FUNCTION guard_application_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Application documents require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Linked Application documents are append-only' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "applications" application
      WHERE application."agency_id" = NEW."agency_id"
        AND application."id" = NEW."application_id"
        AND application."status" IN ('RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED')
    ) THEN
      RAISE EXCEPTION 'Application documents cannot be linked to a retained Application' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "applications" application
    WHERE application."agency_id" = OLD."agency_id"
      AND application."id" = OLD."application_id"
      AND application."status" IN ('RECEIVED', 'INCOMPLETE')
  ) THEN
    RAISE EXCEPTION 'Application documents cannot be removed after screening completes' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

-- Screening results are immutable and versioned. Every replacement must be the
-- next version of the Application and reference its immediate predecessor.
CREATE OR REPLACE FUNCTION guard_application_screening_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  current_version INTEGER;
  latest_screening_id UUID;
  application_status TEXT;
  application_qualification UUID;
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Application screenings require the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Completed Application screenings are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT application."status", application."qualification_standard_version_id"
    INTO application_status, application_qualification
  FROM "applications" application
  WHERE application."agency_id" = NEW."agency_id"
    AND application."id" = NEW."application_id";
  IF application_status IS NULL THEN
    RAISE EXCEPTION 'The Application for the screening does not exist' USING ERRCODE = '55000';
  END IF;
  IF application_status NOT IN ('RECEIVED', 'INCOMPLETE', 'QUALIFIED', 'NOT_QUALIFIED') THEN
    RAISE EXCEPTION 'The Application is not in the screening lifecycle' USING ERRCODE = '55000';
  END IF;
  IF application_qualification IS DISTINCT FROM NEW."qualification_standard_version_id" THEN
    RAISE EXCEPTION 'Screening must use the Qualification Standard Version bound to the Application' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(MAX(screening."version_no"), 0)
    INTO current_version
  FROM "application_screenings" screening
  WHERE screening."agency_id" = NEW."agency_id"
    AND screening."application_id" = NEW."application_id";
  IF NEW."version_no" <> current_version + 1 THEN
    RAISE EXCEPTION 'Screening versions must advance exactly once' USING ERRCODE = '55000';
  END IF;
  IF current_version > 0 THEN
    SELECT screening."id"
      INTO latest_screening_id
    FROM "application_screenings" screening
    WHERE screening."agency_id" = NEW."agency_id"
      AND screening."application_id" = NEW."application_id"
      AND screening."version_no" = current_version;
    IF NEW."replaces_screening_id" IS DISTINCT FROM latest_screening_id THEN
      RAISE EXCEPTION 'Screening replacements must reference the completed result they replace' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Screening evidence must point at a document already linked to the same
-- Application.
CREATE OR REPLACE FUNCTION guard_application_screening_evidence_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.recruitment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Application screening evidence requires the Recruitment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Application screening evidence is append-only' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "application_screenings" screening
    JOIN "application_documents" document
      ON document."agency_id" = screening."agency_id"
      AND document."application_id" = screening."application_id"
    WHERE screening."agency_id" = NEW."agency_id"
      AND screening."id" = NEW."screening_id"
      AND document."id" = NEW."application_document_id"
  ) THEN
    RAISE EXCEPTION 'Screening evidence must reference a document linked to the same Application' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "applicants_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "applicants"
  FOR EACH ROW EXECUTE FUNCTION guard_applicant_mutation();
CREATE TRIGGER "applications_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "applications"
  FOR EACH ROW EXECUTE FUNCTION guard_application_mutation();
CREATE TRIGGER "application_documents_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "application_documents"
  FOR EACH ROW EXECUTE FUNCTION guard_application_document_mutation();
CREATE TRIGGER "application_screenings_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "application_screenings"
  FOR EACH ROW EXECUTE FUNCTION guard_application_screening_mutation();
CREATE TRIGGER "application_screening_evidence_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "application_screening_evidence"
  FOR EACH ROW EXECUTE FUNCTION guard_application_screening_evidence_mutation();

GRANT USAGE, SELECT ON SEQUENCE "applications_application_no_seq" TO hris_app;
GRANT SELECT, INSERT ON TABLE "applicants" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "applications" TO hris_app;
GRANT SELECT, INSERT, DELETE ON TABLE "application_documents" TO hris_app;
GRANT SELECT, INSERT ON TABLE "application_screenings" TO hris_app;
GRANT SELECT, INSERT ON TABLE "application_screening_evidence" TO hris_app;

ALTER TABLE "applicants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applicants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "application_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "application_screenings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_screenings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "application_screening_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_screening_evidence" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'applicants', 'applications', 'application_documents',
    'application_screenings', 'application_screening_evidence'
  ] LOOP
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING ("agency_id" = app_agency_id())', table_name || '_rls', table_name);
    EXECUTE format('CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK ("agency_id" = app_agency_id() AND current_setting(''app.recruitment_transition'', true) = ''on'')', table_name || '_insert_rls', table_name);
  END LOOP;
END;
$$;

CREATE POLICY "applications_update_rls"
  ON "applications" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.recruitment_transition', true) = 'on');

CREATE POLICY "application_documents_delete_rls"
  ON "application_documents" FOR DELETE
  USING (
    "agency_id" = app_agency_id()
    AND current_setting('app.recruitment_transition', true) = 'on'
    AND EXISTS (
      SELECT 1
      FROM "applications" application
      WHERE application."agency_id" = "application_documents"."agency_id"
        AND application."id" = "application_documents"."application_id"
        AND application."status" IN ('RECEIVED', 'INCOMPLETE')
    )
  );

REVOKE UPDATE, DELETE ON TABLE "applicants" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "application_screenings" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "application_screening_evidence" FROM hris_app;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('recruitment.applications.read', 'recruitment', 'MEDIUM', 'Read Applicants and Applications'),
  ('recruitment.applications.create', 'recruitment', 'HIGH', 'Record Applicants and Applications'),
  ('recruitment.applications.update', 'recruitment', 'HIGH', 'Link evidence and reopen incomplete Applications'),
  ('recruitment.applications.screen', 'recruitment', 'HIGH', 'Record qualification screening'),
  ('recruitment.applications.disqualify', 'recruitment', 'CRITICAL', 'Mark an Applicant not qualified'),
  ('recruitment.applications.withdraw', 'recruitment', 'HIGH', 'Record an Applicant withdrawal'),
  ('recruitment.applications.close', 'recruitment', 'HIGH', 'Close a screened Application')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" LIKE 'recruitment.applications.%'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'recruitment_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'recruitment.applications.read'
WHERE r."code" IN ('appointing_authority', 'internal_auditor')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'applicants'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'applications'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'application_documents'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'application_screenings'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'application_screening_evidence'::regclass), false) THEN
    RAISE EXCEPTION 'Application screening capability migration verification failed';
  END IF;
END;
$$;
