ALTER TABLE "pds_eligibility_records"
  DROP CONSTRAINT "pds_eligibility_records_rating_check",
  ADD CONSTRAINT "pds_eligibility_records_rating_check"
    CHECK (
      "rating" IS NULL
      OR "rating" IN ('N/A', 'If Applicable')
      OR "rating" ~ '^(100([.]0{1,2})?|([0-9]|[1-9][0-9])([.][0-9]{1,2})?)$'
    );
