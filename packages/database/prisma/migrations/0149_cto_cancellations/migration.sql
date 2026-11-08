-- Phase 8 CTO cancellation (#324), as hris-controls §5.19 and
-- overtime-coc-cto-schema.md §5 leave it. The Approving Official cancels or
-- recalls (JC 2, s. 2004 item 5.9.3) the whole request or named Work Dates. Each
-- cancelled date names its cancellation, and the request becomes CANCELLED once
-- no uncancelled date remains. A cancellation and its dates' marks are final.

CREATE TABLE "cto_cancellations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "cto_request_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "cancelled_by_membership_id" UUID NOT NULL,
  "cancelled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "cto_cancellations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cto_cancellations_kind_check" CHECK ("kind" IN ('RECALL', 'EMPLOYEE_REQUEST')),
  CONSTRAINT "cto_cancellations_reason_check" CHECK (btrim("reason") <> ''),
  CONSTRAINT "cto_cancellations_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "cto_cancellations_request_fkey"
    FOREIGN KEY ("agency_id", "cto_request_id")
    REFERENCES "cto_requests"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "cto_cancellations_cancelled_by_fkey"
    FOREIGN KEY ("agency_id", "cancelled_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "cto_cancellations_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "cto_cancellations_request_idx"
  ON "cto_cancellations" ("agency_id", "cto_request_id");

ALTER TABLE "cto_request_dates"
  ADD COLUMN "cancelled_by_cto_cancellation_id" UUID,
  ADD CONSTRAINT "cto_request_dates_cancelled_by_fkey"
    FOREIGN KEY ("agency_id", "cancelled_by_cto_cancellation_id")
    REFERENCES "cto_cancellations"("agency_id", "id") ON DELETE RESTRICT;

-- A cancellation is recorded only against an APPROVED request and never changes.
CREATE OR REPLACE FUNCTION guard_cto_cancellation_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'CTO Cancellations are final'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "cto_requests" r
    WHERE r."agency_id" = NEW."agency_id" AND r."id" = NEW."cto_request_id"
      AND r."status" = 'APPROVED'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Only an APPROVED CTO Request is cancelled'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cto_cancellations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "cto_cancellations"
  FOR EACH ROW EXECUTE FUNCTION guard_cto_cancellation_mutation();

-- 0144's guard, plus: a date of an APPROVED request is cancelled once, by a
-- cancellation of its own request, and stays cancelled.
CREATE OR REPLACE FUNCTION guard_cto_request_date_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  request_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cto_request_dates records cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  SELECT r."status" INTO request_status
  FROM "cto_requests" r
  WHERE r."agency_id" = NEW."agency_id" AND r."id" = NEW."cto_request_id"
  FOR SHARE;

  IF TG_OP = 'INSERT' THEN
    IF request_status IS DISTINCT FROM 'DRAFT'
      OR NEW."attendance_cto_input_id" IS NOT NULL
      OR NEW."cancelled_by_cto_cancellation_id" IS NOT NULL
    THEN
      RAISE EXCEPTION 'Work Dates are added only to a DRAFT CTO Request'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."cto_request_id" IS DISTINCT FROM OLD."cto_request_id"
    OR NEW."work_date" IS DISTINCT FROM OLD."work_date"
    OR NEW."unit" IS DISTINCT FROM OLD."unit"
    OR NEW."starts_at" IS DISTINCT FROM OLD."starts_at"
    OR NEW."ends_at" IS DISTINCT FROM OLD."ends_at"
  THEN
    RAISE EXCEPTION 'A CTO Request date cannot be rewritten'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."charged_minutes" IS DISTINCT FROM OLD."charged_minutes"
    AND request_status IS DISTINCT FROM 'DRAFT'
  THEN
    RAISE EXCEPTION 'Only a DRAFT CTO Request date changes its charge'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."attendance_cto_input_id" IS DISTINCT FROM OLD."attendance_cto_input_id"
    AND OLD."attendance_cto_input_id" IS NOT NULL
  THEN
    RAISE EXCEPTION 'A CTO Request date keeps the Attendance CTO input it retained'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."cancelled_by_cto_cancellation_id" IS DISTINCT FROM OLD."cancelled_by_cto_cancellation_id"
    AND (
      OLD."cancelled_by_cto_cancellation_id" IS NOT NULL
      OR request_status IS DISTINCT FROM 'APPROVED'
      OR NOT EXISTS (
        SELECT 1 FROM "cto_cancellations" c
        WHERE c."agency_id" = NEW."agency_id"
          AND c."id" = NEW."cancelled_by_cto_cancellation_id"
          AND c."cto_request_id" = NEW."cto_request_id"
      )
    )
  THEN
    RAISE EXCEPTION 'A Work Date of an APPROVED CTO Request is cancelled once, by its own request''s cancellation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- 0144's guard, plus: an APPROVED request is CANCELLED only once every date is.
CREATE OR REPLACE FUNCTION guard_cto_request_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'
      OR NEW."approved_by_membership_id" IS NOT NULL
      OR NEW."approved_at" IS NOT NULL
    THEN
      RAISE EXCEPTION 'A CTO Request is created as a DRAFT'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cto_requests records cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."coc_account_id" IS DISTINCT FROM OLD."coc_account_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'A CTO Request cannot be rewritten'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED', 'CANCELLED'))
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('FOR_APPROVAL', 'DRAFT', 'CANCELLED'))
    OR (OLD."status" = 'FOR_APPROVAL' AND NEW."status" IN ('APPROVED', 'REJECTED', 'DRAFT', 'CANCELLED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'A CTO Request cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" = 'CANCELLED' AND EXISTS (
    SELECT 1 FROM "cto_request_dates" d
    WHERE d."agency_id" = NEW."agency_id" AND d."cto_request_id" = NEW."id"
      AND d."cancelled_by_cto_cancellation_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'An APPROVED CTO Request is CANCELLED only once every Work Date is cancelled'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (OLD."status" = 'FOR_APPROVAL' AND NEW."status" = 'APPROVED')
    AND (
      NEW."approved_by_membership_id" IS DISTINCT FROM OLD."approved_by_membership_id"
      OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
    )
  THEN
    RAISE EXCEPTION 'Only approval records a CTO Request approver'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT SELECT, INSERT ON TABLE "cto_cancellations" TO hris_app;

ALTER TABLE "cto_cancellations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cto_cancellations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "cto_cancellations_select" ON "cto_cancellations"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "cto_cancellations_insert" ON "cto_cancellations"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

-- hris-controls §6.9 baseline grant: Approving Official `A` on `.cancel`, mapped
-- to the appointing_authority role as 0147 does for `.approve` and `.reject`. The
-- HR Administrator's `C` cell is not a baseline grant.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.cto.cancel', 'overtime', 'HIGH', 'Cancel or recall approved CTO and return its COC')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.cto.cancel'
WHERE r."code" = 'appointing_authority'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'cto_cancellations' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'CTO Cancellation row-level security verification failed';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."agency_id" IS NULL
      AND r."code" = 'appointing_authority'
      AND rp."scope_policy" = 'AGENCY'
      AND p."code" = 'overtime.cto.cancel'
  ) <> 1 THEN
    RAISE EXCEPTION 'CTO cancellation grant verification failed';
  END IF;
END;
$$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
