CREATE OR REPLACE FUNCTION guard_pds_child_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
  old_version_status TEXT;
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

  IF TG_OP = 'UPDATE' THEN
    SELECT "status" INTO old_version_status
    FROM "pds_versions"
    WHERE "agency_id" = OLD."agency_id"
      AND "id" = OLD."pds_version_id";
    IF old_version_status IS NULL OR old_version_status NOT IN ('DRAFT', 'RETURNED') THEN
      RAISE EXCEPTION 'Certified or submitted PDS section rows are immutable'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
      OR NEW."pds_version_id" IS DISTINCT FROM OLD."pds_version_id" THEN
      RAISE EXCEPTION 'PDS section row ownership cannot change'
        USING ERRCODE = '55000';
    END IF;
    IF TG_TABLE_NAME = 'pds_wes_artifacts' THEN
      IF NEW."employee_id" IS DISTINCT FROM OLD."employee_id" THEN
        RAISE EXCEPTION 'WES artifact ownership cannot change'
          USING ERRCODE = '55000';
      END IF;
    ELSIF TG_TABLE_NAME = 'pds_wes_entries' THEN
      IF NEW."wes_artifact_id" IS DISTINCT FROM OLD."wes_artifact_id"
        OR NEW."work_experience_id" IS DISTINCT FROM OLD."work_experience_id" THEN
        RAISE EXCEPTION 'WES entry relationships cannot change'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'pds_wes_artifacts' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Submitted, certified, or superseded WES artifacts are immutable'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'pds_wes_entries' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
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
