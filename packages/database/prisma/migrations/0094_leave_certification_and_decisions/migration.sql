-- Phase 7 certification and decision records. A certification freezes the
-- Leave Account facts reviewed for one Leave Application Version and binds the
-- Leave Credit Commitments raised under account lock. The recommendation and
-- approval allocation append the review trail without rewriting the request.

CREATE TABLE "leave_credit_certifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_application_version_id" uuid NOT NULL,
  "eligibility_assessment_id" uuid NOT NULL,
  "approval_decision_id" uuid NOT NULL,
  "balance_as_of" date NOT NULL,
  "ledger_recorded_through" timestamptz NOT NULL,
  "certified_by_membership_id" uuid NOT NULL,
  "certified_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "leave_credit_certifications_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id")
    REFERENCES "leave_application_versions" ("agency_id", "id"),
  CONSTRAINT "leave_credit_certifications_assessment_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id", "eligibility_assessment_id")
    REFERENCES "leave_eligibility_assessments" ("agency_id", "leave_application_version_id", "id"),
  CONSTRAINT "leave_credit_certifications_decision_fkey"
    FOREIGN KEY ("agency_id", "approval_decision_id")
    REFERENCES "approval_decisions" ("agency_id", "id"),
  CONSTRAINT "leave_credit_certifications_certifier_fkey"
    FOREIGN KEY ("agency_id", "certified_by_membership_id")
    REFERENCES "agency_memberships" ("agency_id", "id"),
  CONSTRAINT "leave_credit_certifications_version_key"
    UNIQUE ("leave_application_version_id"),
  CONSTRAINT "leave_credit_certifications_agency_version_key"
    UNIQUE ("agency_id", "leave_application_version_id"),
  CONSTRAINT "leave_credit_certifications_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_credit_certification_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_credit_certification_id" uuid NOT NULL,
  "leave_account_id" uuid NOT NULL,
  "posted_balance" numeric(12,4) NOT NULL,
  "active_commitments" numeric(12,4) NOT NULL CHECK ("active_commitments" >= 0),
  "application_quantity" numeric(12,4) NOT NULL CHECK ("application_quantity" > 0),
  "available_after_application" numeric(12,4) NOT NULL,
  "leave_credit_commitment_id" uuid NOT NULL,
  CONSTRAINT "leave_credit_certification_lines_certification_fkey"
    FOREIGN KEY ("agency_id", "leave_credit_certification_id")
    REFERENCES "leave_credit_certifications" ("agency_id", "id"),
  CONSTRAINT "leave_credit_certification_lines_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts" ("agency_id", "id"),
  CONSTRAINT "leave_credit_certification_lines_commitment_fkey"
    FOREIGN KEY ("agency_id", "leave_credit_commitment_id")
    REFERENCES "leave_credit_commitments" ("agency_id", "id"),
  CONSTRAINT "leave_credit_certification_lines_account_key"
    UNIQUE ("leave_credit_certification_id", "leave_account_id"),
  CONSTRAINT "leave_credit_certification_lines_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_recommendations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_application_version_id" uuid NOT NULL,
  "approval_decision_id" uuid NOT NULL,
  "outcome" text NOT NULL
    CHECK ("outcome" IN ('RECOMMEND_APPROVAL','RECOMMEND_REJECTION')),
  "reason" text,
  "recommended_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "leave_recommendations_negative_reason_check"
    CHECK ("outcome" <> 'RECOMMEND_REJECTION' OR "reason" IS NOT NULL),
  CONSTRAINT "leave_recommendations_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id")
    REFERENCES "leave_application_versions" ("agency_id", "id"),
  CONSTRAINT "leave_recommendations_decision_fkey"
    FOREIGN KEY ("agency_id", "approval_decision_id")
    REFERENCES "approval_decisions" ("agency_id", "id"),
  CONSTRAINT "leave_recommendations_version_key"
    UNIQUE ("leave_application_version_id"),
  CONSTRAINT "leave_recommendations_agency_version_key"
    UNIQUE ("agency_id", "leave_application_version_id"),
  CONSTRAINT "leave_recommendations_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_approval_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_application_version_id" uuid NOT NULL,
  "approval_decision_id" uuid NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "leave_approval_allocations_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_version_id")
    REFERENCES "leave_application_versions" ("agency_id", "id"),
  CONSTRAINT "leave_approval_allocations_decision_fkey"
    FOREIGN KEY ("agency_id", "approval_decision_id")
    REFERENCES "approval_decisions" ("agency_id", "id"),
  CONSTRAINT "leave_approval_allocations_version_key"
    UNIQUE ("leave_application_version_id"),
  CONSTRAINT "leave_approval_allocations_agency_version_key"
    UNIQUE ("agency_id", "leave_application_version_id"),
  CONSTRAINT "leave_approval_allocations_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_approval_allocation_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_approval_allocation_id" uuid NOT NULL,
  "sequence_no" integer NOT NULL CHECK ("sequence_no" > 0),
  "date_from" date NOT NULL,
  "date_to" date NOT NULL,
  "allocation_kind" text NOT NULL
    CHECK ("allocation_kind" IN (
      'LEAVE_ACCOUNT','LEAVE_WITHOUT_PAY','NON_CREDIT'
    )),
  "leave_account_id" uuid,
  "quantity" numeric(12,4) NOT NULL CHECK ("quantity" > 0),
  "unit_code" text NOT NULL
    CHECK ("unit_code" IN (
      'WORKING_DAY','CALENDAR_DAY','SCHEDULED_MINUTE','SOURCE_DEFINED'
    )),
  CONSTRAINT "leave_approval_allocation_lines_dates_check"
    CHECK ("date_to" >= "date_from"),
  CONSTRAINT "leave_approval_allocation_lines_account_check"
    CHECK (
      ("allocation_kind" = 'LEAVE_ACCOUNT' AND "leave_account_id" IS NOT NULL)
      OR
      ("allocation_kind" <> 'LEAVE_ACCOUNT' AND "leave_account_id" IS NULL)
    ),
  CONSTRAINT "leave_approval_allocation_lines_allocation_fkey"
    FOREIGN KEY ("agency_id", "leave_approval_allocation_id")
    REFERENCES "leave_approval_allocations" ("agency_id", "id"),
  CONSTRAINT "leave_approval_allocation_lines_account_fkey"
    FOREIGN KEY ("agency_id", "leave_account_id")
    REFERENCES "leave_accounts" ("agency_id", "id"),
  CONSTRAINT "leave_approval_allocation_lines_sequence_key"
    UNIQUE ("leave_approval_allocation_id", "sequence_no"),
  CONSTRAINT "leave_approval_allocation_lines_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE OR REPLACE FUNCTION guard_leave_certification_record_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% records are immutable', TG_ARGV[0]
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION '% records are retained and cannot be deleted', TG_ARGV[0]
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "leave_credit_certifications_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_credit_certifications"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_certification_record_mutation('Leave Credit Certification');
CREATE TRIGGER "leave_credit_certification_lines_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_credit_certification_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_certification_record_mutation('Leave Credit Certification Line');
CREATE TRIGGER "leave_recommendations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_recommendations"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_certification_record_mutation('Leave Recommendation');
CREATE TRIGGER "leave_approval_allocations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_approval_allocations"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_certification_record_mutation('Leave Approval Allocation');
CREATE TRIGGER "leave_approval_allocation_lines_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_approval_allocation_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_certification_record_mutation('Leave Approval Allocation Line');

GRANT SELECT, INSERT ON TABLE "leave_credit_certifications" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_credit_certification_lines" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_recommendations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_approval_allocations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_approval_allocation_lines" TO hris_app;

ALTER TABLE "leave_credit_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_credit_certifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_credit_certification_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_credit_certification_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_recommendations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_approval_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_approval_allocations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_approval_allocation_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_approval_allocation_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY "leave_credit_certifications_select" ON "leave_credit_certifications"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_credit_certifications_insert" ON "leave_credit_certifications"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_credit_certification_lines_select" ON "leave_credit_certification_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_credit_certification_lines_insert" ON "leave_credit_certification_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_recommendations_select" ON "leave_recommendations"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_recommendations_insert" ON "leave_recommendations"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_approval_allocations_select" ON "leave_approval_allocations"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_approval_allocations_insert" ON "leave_approval_allocations"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_approval_allocation_lines_select" ON "leave_approval_allocation_lines"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_approval_allocation_lines_insert" ON "leave_approval_allocation_lines"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.applications.route', 'leave', 'HIGH', 'Send a submitted Leave Application for credit certification'),
  ('leave.credits.certify', 'leave', 'HIGH', 'Certify leave credits and raise Leave Credit Commitments'),
  ('leave.applications.recommend', 'leave', 'MEDIUM', 'Recommend approval or rejection of a certified Leave Application'),
  ('leave.applications.approve', 'leave', 'CRITICAL', 'Approve a Leave Application within the certified request'),
  ('leave.applications.reject', 'leave', 'CRITICAL', 'Reject a certified Leave Application with a reason'),
  ('leave.applications.return', 'leave', 'HIGH', 'Return a Leave Application for material information or evidence')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.applications.route',
  'leave.credits.certify'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'personnel_records_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.applications.recommend'
WHERE r."code" = 'hrmo_administrator'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.applications.approve',
  'leave.applications.reject'
)
WHERE r."code" IN ('hrmo_administrator', 'appointing_authority')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.applications.return'
WHERE r."code" IN (
  'agency_administrator', 'hrmo_administrator',
  'personnel_records_officer', 'appointing_authority'
)
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'leave.credits.certify') THEN
    RAISE EXCEPTION 'Leave credit certification permission verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'personnel_records_officer'
      AND p."code" = 'leave.credits.certify'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Leave Credit Certifier grant verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'appointing_authority'
      AND p."code" = 'leave.applications.approve'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'Leave Application Approver grant verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'leave_credit_certifications_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Leave Credit Certification immutability verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_credit_certifications_assessment_fkey'
  ) THEN
    RAISE EXCEPTION 'Leave Credit Certification assessment binding verification failed';
  END IF;
END;
$$;
