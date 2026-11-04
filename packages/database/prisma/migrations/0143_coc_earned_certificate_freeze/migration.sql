-- Phase 8 COC award on approval (#538). Approving a Certificate of COC Earned
-- freezes each line's credited and excess minutes, once, in the transaction
-- that moved the certificate to APPROVED. 0142 left lines able only to be
-- released, so this adds the one write approval needs.
CREATE OR REPLACE FUNCTION guard_coc_earned_certificate_line_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  certificate_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'coc_earned_certificate_lines records cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  SELECT c."status" INTO certificate_status
  FROM "coc_earned_certificates" c
  WHERE c."agency_id" = NEW."agency_id" AND c."id" = NEW."coc_earned_certificate_id";

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."coc_earned_certificate_id" IS DISTINCT FROM OLD."coc_earned_certificate_id"
    OR NEW."overtime_service_record_id" IS DISTINCT FROM OLD."overtime_service_record_id"
    OR NEW."certified_minutes" IS DISTINCT FROM OLD."certified_minutes"
  THEN
    RAISE EXCEPTION 'A Certificate of COC Earned line can only be released'
      USING ERRCODE = '55000';
  END IF;

  IF certificate_status = 'APPROVED'
    AND OLD."released_at" IS NULL
    AND NEW."released_at" IS NULL
    AND OLD."credited_minutes" IS NULL
    AND OLD."excess_minutes" IS NULL
    AND NEW."credited_minutes" IS NOT NULL
    AND NEW."excess_minutes" IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  IF NEW."credited_minutes" IS DISTINCT FROM OLD."credited_minutes"
    OR NEW."excess_minutes" IS DISTINCT FROM OLD."excess_minutes"
    OR OLD."released_at" IS NOT NULL
    OR NEW."released_at" IS NULL
  THEN
    RAISE EXCEPTION 'A Certificate of COC Earned line can only be released'
      USING ERRCODE = '55000';
  END IF;

  IF certificate_status IS DISTINCT FROM 'DISCARDED' THEN
    RAISE EXCEPTION 'Only a DISCARDED Certificate of COC Earned releases its lines'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
