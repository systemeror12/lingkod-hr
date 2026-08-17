-- A historical activated version may be voided only as part of a factual correction.
-- Its replacement keeps the same effective period and remains in retained history.

CREATE OR REPLACE FUNCTION guard_agency_profile_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agency profile versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'agency profile versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SUPERSEDED' AND (
    NEW."status" <> 'VOIDED'
    OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
    OR NEW."official_name" IS DISTINCT FROM OLD."official_name"
    OR NEW."acronym" IS DISTINCT FROM OLD."acronym"
    OR NEW."agency_type" IS DISTINCT FROM OLD."agency_type"
    OR NEW."parent_organization" IS DISTINCT FROM OLD."parent_organization"
    OR NEW."reporting_identifiers" IS DISTINCT FROM OLD."reporting_identifiers"
    OR NEW."appointing_authority_title" IS DISTINCT FROM OLD."appointing_authority_title"
    OR NEW."default_timezone" IS DISTINCT FROM OLD."default_timezone"
    OR NEW."default_currency" IS DISTINCT FROM OLD."default_currency"
    OR NEW."deployment_profile" IS DISTINCT FROM OLD."deployment_profile"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."effective_to" IS DISTINCT FROM OLD."effective_to"
    OR NEW."configuration" IS DISTINCT FROM OLD."configuration"
    OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'superseded Agency Profile versions are immutable except for correction voiding'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' AND (
    NEW."status" NOT IN ('SUPERSEDED', 'VOIDED')
    OR NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."version_no" IS DISTINCT FROM OLD."version_no"
    OR NEW."official_name" IS DISTINCT FROM OLD."official_name"
    OR NEW."acronym" IS DISTINCT FROM OLD."acronym"
    OR NEW."agency_type" IS DISTINCT FROM OLD."agency_type"
    OR NEW."parent_organization" IS DISTINCT FROM OLD."parent_organization"
    OR NEW."reporting_identifiers" IS DISTINCT FROM OLD."reporting_identifiers"
    OR NEW."appointing_authority_title" IS DISTINCT FROM OLD."appointing_authority_title"
    OR NEW."default_timezone" IS DISTINCT FROM OLD."default_timezone"
    OR NEW."default_currency" IS DISTINCT FROM OLD."default_currency"
    OR NEW."deployment_profile" IS DISTINCT FROM OLD."deployment_profile"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."domain_status" IS DISTINCT FROM OLD."domain_status"
    OR NEW."configuration" IS DISTINCT FROM OLD."configuration"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'activated Agency Profile versions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'a Draft Agency Profile can only be edited or activated'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
