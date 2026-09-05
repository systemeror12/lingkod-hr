ALTER TABLE "pds_declaration_details"
  ALTER COLUMN "related_within_third_degree" DROP NOT NULL,
  ALTER COLUMN "related_within_fourth_degree_lgu" DROP NOT NULL,
  ALTER COLUMN "administrative_offense" DROP NOT NULL,
  ALTER COLUMN "criminal_charge" DROP NOT NULL,
  ALTER COLUMN "criminal_case_date_unknown" DROP NOT NULL,
  ALTER COLUMN "conviction" DROP NOT NULL,
  ALTER COLUMN "separated_from_service" DROP NOT NULL,
  ALTER COLUMN "election_candidacy" DROP NOT NULL,
  ALTER COLUMN "resigned_before_election" DROP NOT NULL,
  ALTER COLUMN "immigrant_permanent_resident" DROP NOT NULL,
  ALTER COLUMN "indigenous_group_member" DROP NOT NULL,
  ALTER COLUMN "person_with_disability" DROP NOT NULL,
  ALTER COLUMN "solo_parent" DROP NOT NULL;

ALTER TABLE "pds_certification_details"
  ALTER COLUMN "truth_declaration_accepted" DROP NOT NULL,
  ALTER COLUMN "authorization_accepted" DROP NOT NULL,
  ALTER COLUMN "misrepresentation_warning_accepted" DROP NOT NULL,
  ALTER COLUMN "government_id_type" DROP NOT NULL,
  ALTER COLUMN "government_id_number" DROP NOT NULL,
  ALTER COLUMN "government_id_issued_at" DROP NOT NULL,
  ALTER COLUMN "government_id_issued_place" DROP NOT NULL,
  ALTER COLUMN "employee_signature_document_id" DROP NOT NULL,
  ALTER COLUMN "employee_signature_document_version_id" DROP NOT NULL,
  ALTER COLUMN "employee_date_accomplished" DROP NOT NULL,
  ALTER COLUMN "subscribed_and_sworn_text" DROP NOT NULL,
  ALTER COLUMN "subscribed_and_sworn_at" DROP NOT NULL,
  ALTER COLUMN "oath_administered_by" DROP NOT NULL,
  ALTER COLUMN "oath_administered_at" DROP NOT NULL;

ALTER TABLE "pds_page_signatures"
  ALTER COLUMN "signature_document_id" DROP NOT NULL,
  ALTER COLUMN "signature_document_version_id" DROP NOT NULL,
  ALTER COLUMN "signed_at" DROP NOT NULL,
  ALTER COLUMN "signature_date" DROP NOT NULL;

ALTER TABLE "pds_page_signatures"
  DROP CONSTRAINT IF EXISTS "pds_page_signatures_signed_pair_check";
ALTER TABLE "pds_page_signatures"
  ADD CONSTRAINT "pds_page_signatures_signed_pair_check"
    CHECK (("signed_at" IS NULL) = ("signature_date" IS NULL));

ALTER TABLE "pds_transition_events"
  DROP CONSTRAINT IF EXISTS "pds_transition_events_actor_fkey",
  DROP CONSTRAINT IF EXISTS "pds_transition_events_actor_membership_fkey",
  DROP CONSTRAINT IF EXISTS "pds_transition_events_actor_user_fkey";
ALTER TABLE "pds_transition_events"
  ADD CONSTRAINT "pds_transition_events_actor_fkey"
    FOREIGN KEY ("agency_id", "actor_membership_id", "actor_user_id")
    REFERENCES "agency_memberships"("agency_id", "id", "user_id") ON DELETE RESTRICT;

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
