ALTER TABLE "pds_eligibility_records"
  DROP CONSTRAINT "pds_eligibility_records_rating_check",
  DROP CONSTRAINT "pds_eligibility_records_name_check",
  ADD CONSTRAINT "pds_eligibility_records_rating_check"
    CHECK ("rating" IS NULL OR btrim("rating") <> ''),
  ADD CONSTRAINT "pds_eligibility_records_name_check"
    CHECK (btrim("eligibility_name") <> '');

REVOKE UPDATE ON TABLE "pds_education_records" FROM hris_app;
REVOKE UPDATE ON TABLE "pds_eligibility_records" FROM hris_app;
