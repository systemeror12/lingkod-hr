-- Revised 2026 PDS education and civil-service eligibility sections.

CREATE TABLE "pds_education_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "level" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "school_name" TEXT NOT NULL,
  "degree_course" TEXT NOT NULL,
  "period_of_attendance" TEXT NOT NULL,
  "highest_level_units" TEXT NOT NULL,
  "year_graduated" INTEGER,
  "honors" TEXT NOT NULL,
  "document_id" UUID,
  "document_version_id" UUID,
  CONSTRAINT "pds_education_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_education_records_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_education_records_level_check"
    CHECK ("level" IN ('ELEMENTARY', 'SECONDARY', 'VOCATIONAL_TRADE', 'COLLEGE', 'GRADUATE_STUDIES')),
  CONSTRAINT "pds_education_records_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_education_records_year_check"
    CHECK ("year_graduated" IS NULL OR "year_graduated" BETWEEN 1 AND 9999),
  CONSTRAINT "pds_education_records_evidence_pair_check"
    CHECK (("document_id" IS NULL) = ("document_version_id" IS NULL)),
  CONSTRAINT "pds_education_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_education_records_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_education_records_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_education_records_document_version_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_education_records_sequence_key"
    UNIQUE ("pds_version_id", "level", "sequence_no")
);

CREATE INDEX "pds_education_records_version_idx"
  ON "pds_education_records" ("agency_id", "pds_version_id", "level", "sequence_no");

CREATE TABLE "pds_eligibility_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "pds_version_id" UUID NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "eligibility_name" TEXT NOT NULL,
  "rating" TEXT,
  "exam_date" DATE,
  "exam_place" TEXT NOT NULL,
  "license_no" TEXT,
  "valid_until" DATE,
  "document_id" UUID,
  "document_version_id" UUID,
  CONSTRAINT "pds_eligibility_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pds_eligibility_records_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "pds_eligibility_records_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "pds_eligibility_records_name_check"
    CHECK ("eligibility_name" IN (
      'Career Service',
      'RA 1080 (Board/Bar)',
      'Under Special Laws',
      'CES/CSEE',
      'Barangay Eligibility',
      'Driver''s License'
    )),
  CONSTRAINT "pds_eligibility_records_rating_check"
    CHECK (
      "rating" IS NULL
      OR btrim("rating") <> ''
    ),
  CONSTRAINT "pds_eligibility_records_exam_date_check"
    CHECK ("exam_date" IS NULL OR "exam_date" <= CURRENT_DATE),
  CONSTRAINT "pds_eligibility_records_license_pair_check"
    CHECK (("license_no" IS NULL) = ("valid_until" IS NULL)),
  CONSTRAINT "pds_eligibility_records_license_category_check"
    CHECK (
      ("eligibility_name" IN ('RA 1080 (Board/Bar)', 'Driver''s License')
        AND "license_no" IS NOT NULL
        AND "valid_until" IS NOT NULL)
      OR ("eligibility_name" NOT IN ('RA 1080 (Board/Bar)', 'Driver''s License')
        AND "license_no" IS NULL
        AND "valid_until" IS NULL)
    ),
  CONSTRAINT "pds_eligibility_records_valid_until_check"
    CHECK ("valid_until" IS NULL OR "exam_date" IS NULL OR "valid_until" >= "exam_date"),
  CONSTRAINT "pds_eligibility_records_license_no_check"
    CHECK ("license_no" IS NULL OR btrim("license_no") <> ''),
  CONSTRAINT "pds_eligibility_records_evidence_pair_check"
    CHECK (("document_id" IS NULL) = ("document_version_id" IS NULL)),
  CONSTRAINT "pds_eligibility_records_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "pds_eligibility_records_version_fkey"
    FOREIGN KEY ("agency_id", "pds_version_id")
    REFERENCES "pds_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_eligibility_records_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_eligibility_records_document_version_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "pds_eligibility_records_sequence_key"
    UNIQUE ("pds_version_id", "sequence_no")
);

CREATE INDEX "pds_eligibility_records_version_idx"
  ON "pds_eligibility_records" ("agency_id", "pds_version_id", "sequence_no");

CREATE TRIGGER "pds_education_records_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_education_records"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();
CREATE TRIGGER "pds_eligibility_records_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "pds_eligibility_records"
  FOR EACH ROW EXECUTE FUNCTION guard_pds_child_mutation();

GRANT SELECT, INSERT, DELETE ON TABLE "pds_education_records" TO hris_app;
GRANT SELECT, INSERT, DELETE ON TABLE "pds_eligibility_records" TO hris_app;

ALTER TABLE "pds_education_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_education_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pds_eligibility_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pds_eligibility_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pds_education_records_isolation" ON "pds_education_records"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "pds_eligibility_records_isolation" ON "pds_eligibility_records"
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
