DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'agency_profile_versions'::regclass
      AND conname = 'agency_profile_versions_active_no_overlap'
  ) THEN
    ALTER TABLE "agency_profile_versions"
      ADD CONSTRAINT "agency_profile_versions_active_no_overlap"
      EXCLUDE USING GIST (
        "agency_id" WITH =,
        DATERANGE("effective_from", COALESCE("effective_to", 'infinity'::DATE), '[]') WITH &&
      ) WHERE ("status" = 'ACTIVE');
  END IF;
END;
$$;
