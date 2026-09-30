-- Phase 7 Leave Cancellation decision. A Leave Cancellation is its own record,
-- separate from a Leave Withdrawal: it names the exact approved scope, reason,
-- evidence Document Versions, and bound Approval Route Version, and keeps its
-- decision and effect states apart. This migration records the decision only;
-- applying ledger, commitment, Attendance, and Payroll effects is later work.
--
-- prior_status records whether the application was APPROVED or POSTED when the
-- request was made, so a rejection returns it to that exact state. The Leave
-- Posting migration adds leave_posting_id once leave_postings exists.

CREATE TABLE "leave_cancellations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_application_id" uuid NOT NULL,
  "leave_application_version_id" uuid NOT NULL,
  "prior_status" text NOT NULL
    CHECK ("prior_status" IN ('APPROVED', 'POSTED')),
  "scope_type" text NOT NULL
    CHECK ("scope_type" IN ('WHOLE', 'PARTIAL')),
  "reason" text NOT NULL CHECK (btrim("reason") <> ''),
  "approval_route_version_id" uuid NOT NULL,
  "approval_request_id" uuid NOT NULL,
  "decision_status" text NOT NULL
    CHECK ("decision_status" IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  "effect_status" text NOT NULL
    CHECK ("effect_status" IN ('NOT_READY', 'PENDING', 'APPLIED', 'FAILED')),
  "requested_by_membership_id" uuid NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "last_effect_failure_code" citext,
  CONSTRAINT "leave_cancellations_decision_effect_check"
    CHECK (
      ("decision_status" = 'APPROVED' AND "effect_status" <> 'NOT_READY')
      OR ("decision_status" <> 'APPROVED' AND "effect_status" = 'NOT_READY')
    ),
  CONSTRAINT "leave_cancellations_application_fkey"
    FOREIGN KEY ("agency_id", "leave_application_id")
    REFERENCES "leave_applications" ("agency_id", "id"),
  CONSTRAINT "leave_cancellations_version_fkey"
    FOREIGN KEY ("agency_id", "leave_application_id", "leave_application_version_id")
    REFERENCES "leave_application_versions" ("agency_id", "leave_application_id", "id"),
  CONSTRAINT "leave_cancellations_route_version_fkey"
    FOREIGN KEY ("agency_id", "approval_route_version_id")
    REFERENCES "approval_route_versions" ("agency_id", "id"),
  CONSTRAINT "leave_cancellations_request_fkey"
    FOREIGN KEY ("agency_id", "approval_request_id")
    REFERENCES "approval_requests" ("agency_id", "id"),
  CONSTRAINT "leave_cancellations_requester_fkey"
    FOREIGN KEY ("agency_id", "requested_by_membership_id")
    REFERENCES "agency_memberships" ("agency_id", "id"),
  CONSTRAINT "leave_cancellations_request_key"
    UNIQUE ("approval_request_id"),
  CONSTRAINT "leave_cancellations_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE INDEX "leave_cancellations_application_idx"
  ON "leave_cancellations" ("agency_id", "leave_application_id");

-- One undecided cancellation per application keeps the projection unambiguous.
CREATE UNIQUE INDEX "leave_cancellations_open_key"
  ON "leave_cancellations" ("leave_application_id")
  WHERE "decision_status" = 'REQUESTED';

CREATE TABLE "leave_cancellation_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_cancellation_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "purpose_code" citext NOT NULL CHECK (btrim("purpose_code"::text) <> ''),
  CONSTRAINT "leave_cancellation_documents_cancellation_fkey"
    FOREIGN KEY ("agency_id", "leave_cancellation_id")
    REFERENCES "leave_cancellations" ("agency_id", "id"),
  CONSTRAINT "leave_cancellation_documents_document_version_fkey"
    FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions" ("agency_id", "id"),
  CONSTRAINT "leave_cancellation_documents_key"
    UNIQUE ("leave_cancellation_id", "document_version_id", "purpose_code"),
  CONSTRAINT "leave_cancellation_documents_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE TABLE "leave_cancellation_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT,
  "leave_cancellation_id" uuid NOT NULL,
  "approval_allocation_line_id" uuid NOT NULL,
  "date_from" date NOT NULL,
  "date_to" date NOT NULL,
  "quantity" numeric(12,4) NOT NULL CHECK ("quantity" > 0),
  CONSTRAINT "leave_cancellation_scopes_range_check"
    CHECK ("date_to" >= "date_from"),
  CONSTRAINT "leave_cancellation_scopes_cancellation_fkey"
    FOREIGN KEY ("agency_id", "leave_cancellation_id")
    REFERENCES "leave_cancellations" ("agency_id", "id"),
  CONSTRAINT "leave_cancellation_scopes_line_fkey"
    FOREIGN KEY ("agency_id", "approval_allocation_line_id")
    REFERENCES "leave_approval_allocation_lines" ("agency_id", "id"),
  CONSTRAINT "leave_cancellation_scopes_line_key"
    UNIQUE ("leave_cancellation_id", "approval_allocation_line_id"),
  CONSTRAINT "leave_cancellation_scopes_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE OR REPLACE FUNCTION guard_leave_cancellation_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leave Cancellations are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."decision_status" <> 'REQUESTED' THEN
      RAISE EXCEPTION 'A Leave Cancellation begins as requested'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    OLD."agency_id", OLD."leave_application_id", OLD."leave_application_version_id",
    OLD."prior_status", OLD."scope_type", OLD."reason",
    OLD."approval_route_version_id", OLD."approval_request_id",
    OLD."requested_by_membership_id", OLD."requested_at"
  ) IS DISTINCT FROM ROW(
    NEW."agency_id", NEW."leave_application_id", NEW."leave_application_version_id",
    NEW."prior_status", NEW."scope_type", NEW."reason",
    NEW."approval_route_version_id", NEW."approval_request_id",
    NEW."requested_by_membership_id", NEW."requested_at"
  ) THEN
    RAISE EXCEPTION 'Requested Leave Cancellation facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."decision_status" IS DISTINCT FROM OLD."decision_status"
    AND OLD."decision_status" <> 'REQUESTED' THEN
    RAISE EXCEPTION 'A decided Leave Cancellation decision is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."effect_status" IS DISTINCT FROM OLD."effect_status" AND NOT (
    (OLD."effect_status" = 'NOT_READY' AND NEW."effect_status" = 'PENDING')
    OR (OLD."effect_status" = 'PENDING' AND NEW."effect_status" IN ('APPLIED', 'FAILED'))
    OR (OLD."effect_status" = 'FAILED' AND NEW."effect_status" IN ('PENDING', 'APPLIED'))
  ) THEN
    RAISE EXCEPTION 'Leave Cancellation effect status transition is not permitted'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

-- A scope may only narrow the approved allocation line it names: the line must
-- belong to the cancelled Leave Application Version, and the dates and
-- quantity stay inside it.
CREATE OR REPLACE FUNCTION guard_leave_cancellation_scope_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  line RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Leave Cancellation scopes are immutable and retained'
      USING ERRCODE = '55000';
  END IF;

  SELECT l."date_from", l."date_to", l."quantity"
  INTO line
  FROM "leave_approval_allocation_lines" l
  JOIN "leave_approval_allocations" a
    ON a."agency_id" = l."agency_id" AND a."id" = l."leave_approval_allocation_id"
  JOIN "leave_cancellations" c
    ON c."agency_id" = a."agency_id"
    AND c."leave_application_version_id" = a."leave_application_version_id"
  WHERE l."agency_id" = NEW."agency_id"
    AND l."id" = NEW."approval_allocation_line_id"
    AND c."id" = NEW."leave_cancellation_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A cancellation scope must name an approved allocation line of the cancelled version'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."date_from" < line."date_from" OR NEW."date_to" > line."date_to" THEN
    RAISE EXCEPTION 'A cancellation scope cannot add dates outside the approved allocation line'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."quantity" > line."quantity" THEN
    RAISE EXCEPTION 'A cancellation scope cannot exceed the approved allocation line quantity'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_leave_cancellation_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  RAISE EXCEPTION 'Leave Cancellation document links are immutable and retained'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "leave_cancellations_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_cancellations"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_cancellation_mutation();
CREATE TRIGGER "leave_cancellation_scopes_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_cancellation_scopes"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_cancellation_scope_mutation();
CREATE TRIGGER "leave_cancellation_documents_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "leave_cancellation_documents"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_cancellation_document_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "leave_cancellations" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_cancellation_documents" TO hris_app;
GRANT SELECT, INSERT ON TABLE "leave_cancellation_scopes" TO hris_app;

ALTER TABLE "leave_cancellations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_cancellations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_cancellation_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_cancellation_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leave_cancellation_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_cancellation_scopes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "leave_cancellations_select" ON "leave_cancellations"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_cancellations_insert" ON "leave_cancellations"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "leave_cancellations_update" ON "leave_cancellations"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_cancellation_documents_select" ON "leave_cancellation_documents"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_cancellation_documents_insert" ON "leave_cancellation_documents"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "leave_cancellation_scopes_select" ON "leave_cancellation_scopes"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "leave_cancellation_scopes_insert" ON "leave_cancellation_scopes"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('leave.applications.request_cancel', 'leave', 'HIGH', 'Request whole or partial cancellation of approved or posted leave'),
  ('leave.applications.cancel', 'leave', 'CRITICAL', 'Approve a Leave Cancellation within its requested scope'),
  ('leave.applications.reject_cancel', 'leave', 'CRITICAL', 'Reject a Leave Cancellation with a reason')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.applications.request_cancel'
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.applications.request_cancel'
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'leave.applications.cancel',
  'leave.applications.reject_cancel'
)
WHERE r."code" IN ('hrmo_administrator', 'appointing_authority')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'leave_cancellations'
      AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'leave_cancellation_scopes'
      AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'leave_cancellation_documents'
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Leave Cancellation row-level security verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'leave.applications.reject_cancel'
  ) THEN
    RAISE EXCEPTION 'Leave Cancellation permission verification failed';
  END IF;
END;
$$;
