CREATE OR REPLACE FUNCTION guard_government_identifier_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  replaced_employee_id UUID;
  replaced_identifier_type TEXT;
  replaced_status TEXT;
  replaced_effective_to DATE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.government_identifier_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Government identifiers are managed by the application service'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Government identifiers must be created as active records'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."effective_to" IS NOT NULL THEN
      RAISE EXCEPTION 'Government identifiers cannot start with an end date'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."replaces_identifier_id" IS NOT NULL THEN
      SELECT
        "employee_id",
        "identifier_type",
        "status",
        "effective_to"
      INTO
        replaced_employee_id,
        replaced_identifier_type,
        replaced_status,
        replaced_effective_to
      FROM "government_identifiers"
      WHERE "agency_id" = NEW."agency_id"
        AND "id" = NEW."replaces_identifier_id";

      IF replaced_employee_id IS DISTINCT FROM NEW."employee_id"
        OR replaced_identifier_type IS DISTINCT FROM NEW."identifier_type"
        OR replaced_status IS DISTINCT FROM 'REPLACED'
        OR replaced_effective_to IS NULL
        OR NEW."effective_from" IS DISTINCT FROM replaced_effective_to + 1 THEN
        RAISE EXCEPTION 'Government identifier replacements must continue the replaced effective period'
          USING ERRCODE = '23514';
      END IF;

      IF NEW."reason" IS NULL OR length(btrim(NEW."reason")) = 0 THEN
        RAISE EXCEPTION 'Government identifier replacements require a reason'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Government identifiers are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF current_setting('app.government_identifier_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Government identifiers are managed by the application service'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."identifier_type" IS DISTINCT FROM OLD."identifier_type"
    OR NEW."encrypted_value" IS DISTINCT FROM OLD."encrypted_value"
    OR NEW."encryption_version" IS DISTINCT FROM OLD."encryption_version"
    OR NEW."masked_value" IS DISTINCT FROM OLD."masked_value"
    OR NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."evidence_document_id" IS DISTINCT FROM OLD."evidence_document_id"
    OR NEW."evidence_document_version_id" IS DISTINCT FROM OLD."evidence_document_version_id"
    OR NEW."replaces_identifier_id" IS DISTINCT FROM OLD."replaces_identifier_id"
    OR NEW."created_by_membership_id" IS DISTINCT FROM OLD."created_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Government identifier identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('REPLACED', 'INVALID')) THEN
      RAISE EXCEPTION 'Government identifier status can only move from active to replaced or invalid'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF OLD."status" = 'ACTIVE'
    AND NEW."status" IN ('REPLACED', 'INVALID')
    AND (NEW."effective_to" IS NULL OR NEW."reason" IS NULL OR length(btrim(NEW."reason")) = 0) THEN
    RAISE EXCEPTION 'Government identifier transitions require an end date and reason'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
      OR NEW."reason" IS DISTINCT FROM OLD."reason")
    AND NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('REPLACED', 'INVALID')) THEN
    RAISE EXCEPTION 'Government identifier replacement details can only change during replacement or invalidation'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
