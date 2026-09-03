ALTER TABLE "pds_versions"
  ADD CONSTRAINT "pds_versions_agency_id_id_employee_id_key"
  UNIQUE ("agency_id", "id", "employee_id");

CREATE TABLE "pds_work_experience_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "inclusive_from" DATE,
  "inclusive_to" DATE,
  "position_title" TEXT,
  "department_agency_office_company" TEXT,
  "monthly_salary" NUMERIC(14, 2),
  "salary_grade_step" TEXT,
  "appointment_status" TEXT,
  "government_service" TEXT,
  "is_current" BOOLEAN NOT NULL DEFAULT FALSE,
  "document_id" UUID,
  "document_version_id" UUID,
  CONSTRAINT "pds_work_experience_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_work_experience_records_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_work_experience_records_dates_check"
    CHECK ("inclusive_to" IS NULL OR "inclusive_from" IS NOT NULL AND "inclusive_to" >= "inclusive_from"),
  CONSTRAINT "pds_work_experience_records_current_date_check"
    CHECK (NOT "is_current" OR "inclusive_to" IS NULL),
  CONSTRAINT "pds_work_experience_records_government_service_check"
    CHECK ("government_service" IS NULL OR "government_service" IN ('Y', 'N')),
  CONSTRAINT "pds_work_experience_records_evidence_pair_check"
    CHECK (("document_id" IS NULL) = ("document_version_id" IS NULL)),
  CONSTRAINT "pds_work_experience_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_work_experience_records_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_work_experience_records_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_work_experience_records_version_evidence_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_work_experience_records_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_work_experience_records_version_id_key"
    UNIQUE ("agency_id", "pds_version_id", "id"),
  CONSTRAINT "pds_work_experience_records_sequence_key"
    UNIQUE ("agency_id", "pds_version_id", "sequence_no")
);

CREATE INDEX "pds_work_experience_records_version_sequence_idx"
  ON "pds_work_experience_records" ("agency_id", "pds_version_id", "sequence_no");

CREATE TABLE "pds_voluntary_work_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "organization_name_address" TEXT,
  "inclusive_from" DATE,
  "inclusive_to" DATE,
  "hours" NUMERIC(12, 4),
  "position_nature_of_work" TEXT,
  "document_id" UUID,
  "document_version_id" UUID,
  CONSTRAINT "pds_voluntary_work_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_voluntary_work_records_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_voluntary_work_records_dates_check"
    CHECK ("inclusive_to" IS NULL OR "inclusive_from" IS NOT NULL AND "inclusive_to" >= "inclusive_from"),
  CONSTRAINT "pds_voluntary_work_records_hours_check" CHECK ("hours" IS NULL OR "hours" >= 0),
  CONSTRAINT "pds_voluntary_work_records_evidence_pair_check"
    CHECK (("document_id" IS NULL) = ("document_version_id" IS NULL)),
  CONSTRAINT "pds_voluntary_work_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_voluntary_work_records_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_voluntary_work_records_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_voluntary_work_records_version_evidence_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_voluntary_work_records_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_voluntary_work_records_sequence_key"
    UNIQUE ("agency_id", "pds_version_id", "sequence_no")
);

CREATE INDEX "pds_voluntary_work_records_version_sequence_idx"
  ON "pds_voluntary_work_records" ("agency_id", "pds_version_id", "sequence_no");

CREATE TABLE "pds_learning_development_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "intervention_title" TEXT,
  "attendance_from" DATE,
  "attendance_to" DATE,
  "hours" NUMERIC(12, 4),
  "type" TEXT,
  "conducted_sponsored_by" TEXT,
  "document_id" UUID,
  "document_version_id" UUID,
  CONSTRAINT "pds_learning_development_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_learning_development_records_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_learning_development_records_dates_check"
    CHECK ("attendance_to" IS NULL OR "attendance_from" IS NOT NULL AND "attendance_to" >= "attendance_from"),
  CONSTRAINT "pds_learning_development_records_hours_check" CHECK ("hours" IS NULL OR "hours" >= 0),
  CONSTRAINT "pds_learning_development_records_evidence_pair_check"
    CHECK (("document_id" IS NULL) = ("document_version_id" IS NULL)),
  CONSTRAINT "pds_learning_development_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_learning_development_records_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_learning_development_records_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_learning_development_records_version_evidence_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_learning_development_records_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_learning_development_records_sequence_key"
    UNIQUE ("agency_id", "pds_version_id", "sequence_no")
);

CREATE INDEX "pds_learning_development_records_version_sequence_idx"
  ON "pds_learning_development_records" ("agency_id", "pds_version_id", "sequence_no");

CREATE TABLE "pds_wes_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "context_key" TEXT NOT NULL DEFAULT 'DEFAULT',
  "template_version" TEXT NOT NULL DEFAULT 'CS_FORM_212_ATTACHMENT_WES_ORAOHRA_2025_H2',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "document_id" UUID,
  "document_version_id" UUID,
  CONSTRAINT "pds_wes_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_wes_artifacts_context_check" CHECK (length(btrim("context_key")) > 0),
  CONSTRAINT "pds_wes_artifacts_status_check"
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'CERTIFIED', 'SUPERSEDED')),
  CONSTRAINT "pds_wes_artifacts_evidence_pair_check"
    CHECK (("document_id" IS NULL) = ("document_version_id" IS NULL)),
  CONSTRAINT "pds_wes_artifacts_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_wes_artifacts_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_wes_artifacts_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id", "employee_id")
    REFERENCES "pds_versions"("agency_id", "id", "employee_id") ON DELETE RESTRICT,
  CONSTRAINT "pds_wes_artifacts_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_wes_artifacts_version_evidence_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_wes_artifacts_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_wes_artifacts_version_id_key"
    UNIQUE ("agency_id", "id", "pds_version_id"),
  CONSTRAINT "pds_wes_artifacts_context_key"
    UNIQUE ("agency_id", "pds_version_id", "context_key")
);

CREATE INDEX "pds_wes_artifacts_employee_status_idx"
  ON "pds_wes_artifacts" ("agency_id", "employee_id", "status");

CREATE TABLE "pds_wes_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "wes_artifact_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "work_experience_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "duration_text" TEXT,
  "position" TEXT NOT NULL,
  "office_unit" TEXT NOT NULL,
  "immediate_supervisor" TEXT NOT NULL,
  "agency_organization_location" TEXT NOT NULL,
  "accomplishments" TEXT,
  "actual_duties" TEXT NOT NULL,
  CONSTRAINT "pds_wes_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_wes_entries_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_wes_entries_required_text_check"
    CHECK (length(btrim("position")) > 0 AND length(btrim("office_unit")) > 0
      AND length(btrim("immediate_supervisor")) > 0
      AND length(btrim("agency_organization_location")) > 0
      AND length(btrim("actual_duties")) > 0),
  CONSTRAINT "pds_wes_entries_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_wes_entries_artifact_fkey"
    FOREIGN KEY ("agency_id", "wes_artifact_id", "pds_version_id")
    REFERENCES "pds_wes_artifacts"("agency_id", "id", "pds_version_id") ON DELETE CASCADE,
  CONSTRAINT "pds_wes_entries_work_experience_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id", "work_experience_id")
    REFERENCES "pds_work_experience_records"("agency_id", "pds_version_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_wes_entries_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_wes_entries_artifact_sequence_key" UNIQUE ("wes_artifact_id", "sequence_no"),
  CONSTRAINT "pds_wes_entries_artifact_work_key" UNIQUE ("wes_artifact_id", "work_experience_id")
);

CREATE INDEX "pds_wes_entries_version_artifact_sequence_idx"
  ON "pds_wes_entries" ("agency_id", "pds_version_id", "wes_artifact_id", "sequence_no");

CREATE OR REPLACE FUNCTION guard_pds_child_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
  artifact_status TEXT;
  version_agency_id UUID;
  version_id UUID;
  artifact_id UUID;
BEGIN
  IF current_setting('app.pds_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'PDS section rows are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    version_agency_id := OLD."agency_id";
    version_id := OLD."pds_version_id";
  ELSE
    version_agency_id := NEW."agency_id";
    version_id := NEW."pds_version_id";
  END IF;

  SELECT "status" INTO version_status
  FROM "pds_versions"
  WHERE "agency_id" = version_agency_id
    AND "id" = version_id;
  IF version_status IS NULL OR version_status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'Certified or submitted PDS section rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_TABLE_NAME = 'pds_wes_artifacts' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      IF OLD."status" <> 'DRAFT' THEN
        RAISE EXCEPTION 'Submitted, certified, or superseded WES artifacts are immutable'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'pds_wes_entries' THEN
    IF TG_OP = 'DELETE' THEN
      artifact_id := OLD."wes_artifact_id";
    ELSE
      artifact_id := NEW."wes_artifact_id";
    END IF;
    SELECT "status" INTO artifact_status
    FROM "pds_wes_artifacts"
    WHERE "agency_id" = version_agency_id
      AND "id" = artifact_id;
    IF artifact_status IS NULL OR artifact_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Submitted, certified, or superseded WES entries are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "pds_work_experience_records_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_work_experience_records"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_voluntary_work_records_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_voluntary_work_records"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_learning_development_records_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_learning_development_records"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_wes_artifacts_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_wes_artifacts"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_wes_entries_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_wes_entries"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_work_experience_records" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_voluntary_work_records" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_learning_development_records" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_wes_artifacts" TO hris_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pds_wes_entries" TO hris_app;

ALTER TABLE "pds_work_experience_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_work_experience_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_voluntary_work_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_voluntary_work_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_learning_development_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_learning_development_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_wes_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_wes_artifacts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_wes_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_wes_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pds_work_experience_records_isolation" ON "pds_work_experience_records"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_voluntary_work_records_isolation" ON "pds_voluntary_work_records"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_learning_development_records_isolation" ON "pds_learning_development_records"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_wes_artifacts_isolation" ON "pds_wes_artifacts"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_wes_entries_isolation" ON "pds_wes_entries"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
