-- Phase 8 Certificates of COC Earned (#321), as overtime-coc-cto-schema.md §3
-- and ADR 0008 leave them. The Overtime module owns both tables. An HR
-- Administrator prepares a DRAFT for one Employee and calendar month, submits
-- it to the shared Approval Route, and may discard it before submission; the
-- Approving Official may return it. Approval and the COC award are #538's.

CREATE TABLE "coc_earned_certificates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "earned_month" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "prepared_by_membership_id" UUID NOT NULL,
  "approved_by_membership_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "coc_earned_certificates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coc_earned_certificates_earned_month_check"
    CHECK ("earned_month" = date_trunc('month', "earned_month")::date),
  CONSTRAINT "coc_earned_certificates_status_check"
    CHECK ("status" IN ('DRAFT', 'FOR_APPROVAL', 'APPROVED', 'DISCARDED')),
  CONSTRAINT "coc_earned_certificates_approved_check"
    CHECK (("status" = 'APPROVED') = ("approved_by_membership_id" IS NOT NULL AND "approved_at" IS NOT NULL)),
  CONSTRAINT "coc_earned_certificates_approver_not_preparer_check"
    CHECK ("approved_by_membership_id" IS DISTINCT FROM "prepared_by_membership_id"),
  CONSTRAINT "coc_earned_certificates_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "coc_earned_certificates_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_earned_certificates_prepared_by_fkey"
    FOREIGN KEY ("agency_id", "prepared_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_earned_certificates_approved_by_fkey"
    FOREIGN KEY ("agency_id", "approved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_earned_certificates_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "coc_earned_certificates_employee_month_idx"
  ON "coc_earned_certificates" ("agency_id", "employee_id", "earned_month");

CREATE TABLE "coc_earned_certificate_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "coc_earned_certificate_id" UUID NOT NULL,
  "overtime_service_record_id" UUID NOT NULL,
  "certified_minutes" INTEGER NOT NULL,
  "credited_minutes" NUMERIC(12,1),
  "excess_minutes" NUMERIC(12,1),
  "released_at" TIMESTAMPTZ(6),
  CONSTRAINT "coc_earned_certificate_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coc_earned_certificate_lines_certified_minutes_check"
    CHECK ("certified_minutes" > 0),
  CONSTRAINT "coc_earned_certificate_lines_credited_minutes_check"
    CHECK ("credited_minutes" IS NULL OR "credited_minutes" >= 0),
  CONSTRAINT "coc_earned_certificate_lines_excess_minutes_check"
    CHECK ("excess_minutes" IS NULL OR "excess_minutes" >= 0),
  CONSTRAINT "coc_earned_certificate_lines_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "coc_earned_certificate_lines_certificate_fkey"
    FOREIGN KEY ("agency_id", "coc_earned_certificate_id")
    REFERENCES "coc_earned_certificates"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_earned_certificate_lines_service_record_fkey"
    FOREIGN KEY ("agency_id", "overtime_service_record_id")
    REFERENCES "overtime_service_records"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "coc_earned_certificate_lines_certificate_record_key"
    UNIQUE ("coc_earned_certificate_id", "overtime_service_record_id"),
  CONSTRAINT "coc_earned_certificate_lines_agency_id_key" UNIQUE ("agency_id", "id")
);

-- A certified record is a line on at most one certificate that has not
-- released it; discarding a DRAFT releases its lines.
CREATE UNIQUE INDEX "coc_earned_certificate_lines_one_active_uq"
  ON "coc_earned_certificate_lines" ("overtime_service_record_id")
  WHERE "released_at" IS NULL;

-- A certificate starts as a DRAFT. What it covers and who prepared it never
-- change; status moves only along the hris-controls state table.
CREATE OR REPLACE FUNCTION guard_coc_earned_certificate_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'A Certificate of COC Earned is prepared as a DRAFT'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'coc_earned_certificates records cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."earned_month" IS DISTINCT FROM OLD."earned_month"
    OR NEW."prepared_by_membership_id" IS DISTINCT FROM OLD."prepared_by_membership_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'A prepared Certificate of COC Earned cannot be rewritten'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('FOR_APPROVAL', 'DISCARDED'))
    OR (OLD."status" = 'FOR_APPROVAL' AND NEW."status" IN ('DRAFT', 'APPROVED'))
  ) THEN
    RAISE EXCEPTION 'A Certificate of COC Earned cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "coc_earned_certificates_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "coc_earned_certificates"
  FOR EACH ROW EXECUTE FUNCTION guard_coc_earned_certificate_mutation();

-- A line joins a DRAFT and is a CERTIFIED record of the certificate's
-- Employee, under a COC authority, with a Work Date in the earned month, and
-- carries the record's certified minutes. Locking the certificate FOR SHARE
-- serializes adding lines with submit and discard, which lock it FOR UPDATE.
CREATE OR REPLACE FUNCTION guard_coc_earned_certificate_line_insert()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  certificate_status TEXT;
  certificate_employee_id UUID;
  certificate_month DATE;
  record_employee_id UUID;
  record_status TEXT;
  record_work_date DATE;
  record_minutes INTEGER;
  authority_method TEXT;
BEGIN
  IF NEW."released_at" IS NOT NULL
    OR NEW."credited_minutes" IS NOT NULL
    OR NEW."excess_minutes" IS NOT NULL
  THEN
    RAISE EXCEPTION 'A Certificate of COC Earned line is added unreleased and uncredited'
      USING ERRCODE = '55000';
  END IF;

  SELECT c."status", c."employee_id", c."earned_month"
  INTO certificate_status, certificate_employee_id, certificate_month
  FROM "coc_earned_certificates" c
  WHERE c."agency_id" = NEW."agency_id" AND c."id" = NEW."coc_earned_certificate_id"
  FOR SHARE;

  IF certificate_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Lines are added only to a DRAFT Certificate of COC Earned'
      USING ERRCODE = '55000';
  END IF;

  SELECT r."employee_id", r."status", r."work_date", r."certified_minutes", a."compensation_method"
  INTO record_employee_id, record_status, record_work_date, record_minutes, authority_method
  FROM "overtime_service_records" r
  JOIN "overtime_authority_employees" ae
    ON ae."agency_id" = r."agency_id" AND ae."id" = r."overtime_authority_employee_id"
  JOIN "overtime_authorities" a
    ON a."agency_id" = ae."agency_id" AND a."id" = ae."overtime_authority_id"
  WHERE r."agency_id" = NEW."agency_id" AND r."id" = NEW."overtime_service_record_id";

  IF record_status IS DISTINCT FROM 'CERTIFIED'
    OR authority_method IS DISTINCT FROM 'COC'
    OR record_employee_id IS DISTINCT FROM certificate_employee_id
    OR date_trunc('month', record_work_date)::date IS DISTINCT FROM certificate_month
    OR record_minutes IS DISTINCT FROM NEW."certified_minutes"
  THEN
    RAISE EXCEPTION 'A line is the Employee''s CERTIFIED service under a COC authority in the earned month'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "coc_earned_certificate_lines_insert_trigger"
  BEFORE INSERT ON "coc_earned_certificate_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_coc_earned_certificate_line_insert();

-- Lines are retained. The only change allowed here is releasing a discarded
-- certificate's lines, once. Approval (#538) writes the credited and excess
-- minutes.
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
  IF NEW."agency_id" IS DISTINCT FROM OLD."agency_id"
    OR NEW."coc_earned_certificate_id" IS DISTINCT FROM OLD."coc_earned_certificate_id"
    OR NEW."overtime_service_record_id" IS DISTINCT FROM OLD."overtime_service_record_id"
    OR NEW."certified_minutes" IS DISTINCT FROM OLD."certified_minutes"
    OR NEW."credited_minutes" IS DISTINCT FROM OLD."credited_minutes"
    OR NEW."excess_minutes" IS DISTINCT FROM OLD."excess_minutes"
    OR OLD."released_at" IS NOT NULL
    OR NEW."released_at" IS NULL
  THEN
    RAISE EXCEPTION 'A Certificate of COC Earned line can only be released'
      USING ERRCODE = '55000';
  END IF;

  SELECT c."status" INTO certificate_status
  FROM "coc_earned_certificates" c
  WHERE c."agency_id" = NEW."agency_id" AND c."id" = NEW."coc_earned_certificate_id";

  IF certificate_status IS DISTINCT FROM 'DISCARDED' THEN
    RAISE EXCEPTION 'Only a DISCARDED Certificate of COC Earned releases its lines'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "coc_earned_certificate_lines_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "coc_earned_certificate_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_coc_earned_certificate_line_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "coc_earned_certificates" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "coc_earned_certificate_lines" TO hris_app;

ALTER TABLE "coc_earned_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coc_earned_certificates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "coc_earned_certificate_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coc_earned_certificate_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY "coc_earned_certificates_select" ON "coc_earned_certificates"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "coc_earned_certificates_insert" ON "coc_earned_certificates"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "coc_earned_certificates_update" ON "coc_earned_certificates"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "coc_earned_certificate_lines_select" ON "coc_earned_certificate_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "coc_earned_certificate_lines_insert" ON "coc_earned_certificate_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "coc_earned_certificate_lines_update" ON "coc_earned_certificate_lines"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

-- hris-controls §6.9 baseline grants, both AGENCY: HR Admin `A` on
-- `overtime.coc_certificates.prepare` and Approving Official `A` on `.approve`.
-- The HR Administrator's `C` (agency-configurable) on `.approve` is not a
-- baseline grant.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.coc_certificates.prepare', 'overtime', 'MEDIUM', 'Prepare, submit, and discard a Certificate of COC Earned'),
  ('overtime.coc_certificates.approve', 'overtime', 'HIGH', 'Approve or return a Certificate of COC Earned')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.coc_certificates.prepare'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.coc_certificates.approve'
WHERE r."code" = 'appointing_authority'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT COUNT(*) FROM pg_class
    WHERE relname IN ('coc_earned_certificates', 'coc_earned_certificate_lines')
      AND relrowsecurity AND relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'Certificate of COC Earned row-level security verification failed';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."agency_id" IS NULL
      AND rp."scope_policy" = 'AGENCY'
      AND (
        (p."code" = 'overtime.coc_certificates.prepare'
          AND r."code" IN ('agency_administrator', 'hrmo_administrator'))
        OR (p."code" = 'overtime.coc_certificates.approve'
          AND r."code" = 'appointing_authority')
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Certificate of COC Earned grant verification failed';
  END IF;
END;
$$;
