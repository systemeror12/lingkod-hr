-- Phase 6 CSC transaction tracking. External submission and official action
-- events are append-only evidence against an exact issued Appointment Version.
-- They never change Appointment workflow status, Employment Status, Nature of
-- Appointment, or the issued version. A derived external standing may be shown
-- or used for command eligibility, but the events remain the source of truth.
-- Regulated agencies record approval or disapproval; accredited or deregulated
-- agencies record validation or invalidation.

CREATE TABLE "appointment_external_submission_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "appointment_version_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL
    CHECK ("event_type" IN ('SUBMITTED', 'RECEIVED', 'RETURNED', 'RESUBMITTED')),
  "external_reference" TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "receiving_office" TEXT NOT NULL CHECK (btrim("receiving_office") <> ''),
  "recorded_by_membership_id" UUID NOT NULL,
  "reason" TEXT,
  "evidence_document_version_id" UUID NOT NULL,
  CONSTRAINT "appointment_external_submission_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_external_submission_events_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_submission_events_version_fkey"
    FOREIGN KEY ("agency_id", "appointment_version_id")
    REFERENCES "appointment_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_submission_events_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_submission_events_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_submission_events_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE INDEX "appointment_external_submission_events_version_idx"
  ON "appointment_external_submission_events"
  ("agency_id", "appointment_version_id", "occurred_at");

CREATE TABLE "appointment_external_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "appointment_version_id" UUID NOT NULL,
  "action" TEXT NOT NULL
    CHECK ("action" IN ('APPROVED', 'DISAPPROVED', 'VALIDATED', 'INVALIDATED')),
  "external_reference" TEXT NOT NULL CHECK (btrim("external_reference") <> ''),
  "action_at" TIMESTAMPTZ(6) NOT NULL,
  "recorded_by_membership_id" UUID NOT NULL,
  "reason" TEXT,
  "evidence_document_version_id" UUID NOT NULL,
  CONSTRAINT "appointment_external_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_external_actions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_actions_version_fkey"
    FOREIGN KEY ("agency_id", "appointment_version_id")
    REFERENCES "appointment_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_actions_recorder_fkey"
    FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_actions_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_external_actions_agency_id_key"
    UNIQUE ("agency_id", "id")
);

CREATE INDEX "appointment_external_actions_version_idx"
  ON "appointment_external_actions"
  ("agency_id", "appointment_version_id", "action_at");

CREATE OR REPLACE FUNCTION guard_appointment_external_event_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'External Appointment events require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'External Appointment events are append-only' USING ERRCODE = '55000';
  END IF;
  SELECT version."status" INTO version_status
  FROM "appointment_versions" version
  WHERE version."agency_id" = NEW."agency_id"
    AND version."id" = NEW."appointment_version_id";
  IF version_status IS DISTINCT FROM 'ISSUED' THEN
    RAISE EXCEPTION 'External Appointment events require an issued Appointment version' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "appointment_external_submission_events_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "appointment_external_submission_events"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_external_event_mutation();
CREATE TRIGGER "appointment_external_actions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "appointment_external_actions"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_external_event_mutation();

GRANT SELECT, INSERT ON TABLE "appointment_external_submission_events" TO hris_app;
GRANT SELECT, INSERT ON TABLE "appointment_external_actions" TO hris_app;

REVOKE UPDATE, DELETE ON TABLE "appointment_external_submission_events" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "appointment_external_actions" FROM hris_app;

ALTER TABLE "appointment_external_submission_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_external_submission_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointment_external_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_external_actions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appointment_external_submission_events_rls_select"
  ON "appointment_external_submission_events" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "appointment_external_submission_events_rls_insert"
  ON "appointment_external_submission_events" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');
CREATE POLICY "appointment_external_actions_rls_select"
  ON "appointment_external_actions" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "appointment_external_actions_rls_insert"
  ON "appointment_external_actions" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('appointments.external_events.record', 'appointments', 'HIGH', 'Record append-only external submission, receipt, return, and resubmission events against an issued Appointment'),
  ('appointments.external_actions.record', 'appointments', 'CRITICAL', 'Record append-only official approval, disapproval, validation, or invalidation from exact external evidence')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'appointments.external_events.record', 'appointments.external_actions.record'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'personnel_records_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appointment_external_submission_events'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appointment_external_actions'::regclass), false) THEN
    RAISE EXCEPTION 'Appointment external tracking migration verification failed';
  END IF;
END;
$$;
