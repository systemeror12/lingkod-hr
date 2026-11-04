-- Phase 8 CTO Requests (#542), as hris-controls §5.19, overtime-coc-cto-schema.md
-- §5, and ADR 0009 leave them. An Employee or Leave Administrator drafts, submits,
-- and discards; the Employee withdraws; the Supervisor recommends; the Supervisor
-- or Approving Official returns. Approval and usage posting are #543's.
-- cancelled_by_cto_cancellation_id arrives with cto_cancellations (#549), since
-- it can have no foreign key before then and nothing can set it.

CREATE TABLE "cto_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "coc_account_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "approved_by_membership_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "cto_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cto_requests_status_check"
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'FOR_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT "cto_requests_approver_pair_check"
    CHECK (("approved_at" IS NULL) = ("approved_by_membership_id" IS NULL)),
  CONSTRAINT "cto_requests_approved_check"
    CHECK ("status" <> 'APPROVED' OR "approved_at" IS NOT NULL),
  CONSTRAINT "cto_requests_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "cto_requests_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "cto_requests_coc_account_fkey"
    FOREIGN KEY ("agency_id", "coc_account_id")
    REFERENCES "coc_accounts"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "cto_requests_approved_by_fkey"
    FOREIGN KEY ("agency_id", "approved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "cto_requests_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "cto_requests_employee_status_idx"
  ON "cto_requests" ("agency_id", "employee_id", "status");

CREATE TABLE "cto_request_dates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "cto_request_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "unit" TEXT NOT NULL,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "charged_minutes" INTEGER NOT NULL,
  "attendance_cto_input_id" UUID,
  CONSTRAINT "cto_request_dates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cto_request_dates_unit_check" CHECK ("unit" IN ('WHOLE', 'HALF')),
  CONSTRAINT "cto_request_dates_charged_minutes_check" CHECK ("charged_minutes" > 0),
  CONSTRAINT "cto_request_dates_interval_check"
    CHECK (
      ("unit" = 'WHOLE' AND "starts_at" IS NULL AND "ends_at" IS NULL)
      OR ("unit" = 'HALF' AND "ends_at" > "starts_at")
    ),
  CONSTRAINT "cto_request_dates_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "cto_request_dates_request_fkey"
    FOREIGN KEY ("agency_id", "cto_request_id")
    REFERENCES "cto_requests"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "cto_request_dates_request_work_date_key" UNIQUE ("cto_request_id", "work_date"),
  CONSTRAINT "cto_request_dates_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "cto_request_dates_work_date_idx"
  ON "cto_request_dates" ("agency_id", "work_date");

-- A request starts as a DRAFT. Whose it is never changes; status moves only along
-- the hris-controls state table, and only approval sets the approver.
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

CREATE TRIGGER "cto_requests_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "cto_requests"
  FOR EACH ROW EXECUTE FUNCTION guard_cto_request_mutation();

-- A date joins a DRAFT and keeps its Work Date, unit, and interval. Only a DRAFT's
-- charge is re-read, at submission; approval (#543) retains the Attendance input.
-- Locking the request FOR SHARE serializes adding dates with commands that lock it
-- FOR UPDATE.
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
    IF request_status IS DISTINCT FROM 'DRAFT' OR NEW."attendance_cto_input_id" IS NOT NULL THEN
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cto_request_dates_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "cto_request_dates"
  FOR EACH ROW EXECUTE FUNCTION guard_cto_request_date_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "cto_requests" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "cto_request_dates" TO hris_app;

ALTER TABLE "cto_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cto_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "cto_request_dates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cto_request_dates" FORCE ROW LEVEL SECURITY;

CREATE POLICY "cto_requests_select" ON "cto_requests"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "cto_requests_insert" ON "cto_requests"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "cto_requests_update" ON "cto_requests"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "cto_request_dates_select" ON "cto_request_dates"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "cto_request_dates_insert" ON "cto_request_dates"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "cto_request_dates_update" ON "cto_request_dates"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

-- hris-controls §6.9 baseline grants. Employee `O` on `.create`, `.submit`, and
-- `.withdraw`; Supervisor `S` on `.recommend` and `.return` (ADR 0007); Approving
-- Official `A` on `.return`. Leave Administrator `A` on `.create` and `.submit` goes
-- to both administrator roles, as Leave's own grants do, because no Leave
-- Administrator role is seeded. The HR Administrator's `C` cells are not baseline
-- grants.
--
-- The Approving Official's route step names `.approve` and `.reject`, which Approval
-- requires to exist, so their catalog rows are here. Granting them is #543's.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.cto.create', 'overtime', 'MEDIUM', 'Draft or discard a CTO Request'),
  ('overtime.cto.submit', 'overtime', 'MEDIUM', 'Submit a CTO Request to its Approval Route'),
  ('overtime.cto.withdraw', 'overtime', 'MEDIUM', 'Withdraw a CTO Request before approval'),
  ('overtime.cto.recommend', 'overtime', 'MEDIUM', 'Recommend a CTO Request for approval'),
  ('overtime.cto.return', 'overtime', 'MEDIUM', 'Return a CTO Request to its Employee with a comment'),
  ('overtime.cto.approve', 'overtime', 'HIGH', 'Approve a CTO Request and post its COC usage'),
  ('overtime.cto.reject', 'overtime', 'MEDIUM', 'Reject a CTO Request with a reason')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.cto.create', 'overtime.cto.submit', 'overtime.cto.withdraw')
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.cto.recommend', 'overtime.cto.return')
WHERE r."code" = 'supervisor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'overtime.cto.return'
WHERE r."code" = 'appointing_authority'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.cto.create', 'overtime.cto.submit')
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
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
    WHERE relname IN ('cto_requests', 'cto_request_dates')
      AND relrowsecurity AND relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'CTO Request row-level security verification failed';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."agency_id" IS NULL
      AND (
        (r."code" = 'employee' AND rp."scope_policy" = 'OWN'
          AND p."code" IN ('overtime.cto.create', 'overtime.cto.submit', 'overtime.cto.withdraw'))
        OR (r."code" = 'supervisor' AND rp."scope_policy" = 'DIRECT_REPORTS'
          AND p."code" IN ('overtime.cto.recommend', 'overtime.cto.return'))
        OR (r."code" = 'appointing_authority' AND rp."scope_policy" = 'AGENCY'
          AND p."code" = 'overtime.cto.return')
        OR (r."code" IN ('agency_administrator', 'hrmo_administrator') AND rp."scope_policy" = 'AGENCY'
          AND p."code" IN ('overtime.cto.create', 'overtime.cto.submit'))
      )
  ) <> 10 THEN
    RAISE EXCEPTION 'CTO Request grant verification failed';
  END IF;
END;
$$;
