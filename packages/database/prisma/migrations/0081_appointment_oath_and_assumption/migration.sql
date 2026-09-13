-- Phase 6 oath and Assumption to Duty. The appointee acknowledgment, versioned
-- oath, and versioned assumption are separate evidenced events. Issuance alone
-- never creates an assumption or active service, and CSC approval or validation
-- is not a prerequisite. Failure to assume and lawful pre-assumption
-- cancellation preserve notice, authority, dates, and exact evidence before the
-- owning Plantilla service releases the reservation.

CREATE TABLE "appointment_acknowledgments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "appointment_version_id" UUID NOT NULL,
  "acknowledged_at" TIMESTAMPTZ(6) NOT NULL,
  "evidence_document_version_id" UUID NOT NULL,
  CONSTRAINT "appointment_acknowledgments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_acknowledgments_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_acknowledgments_version_fkey"
    FOREIGN KEY ("agency_id", "appointment_version_id")
    REFERENCES "appointment_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_acknowledgments_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_acknowledgments_version_key"
    UNIQUE ("appointment_version_id"),
  CONSTRAINT "appointment_acknowledgments_agency_version_key"
    UNIQUE ("agency_id", "appointment_version_id"),
  CONSTRAINT "appointment_acknowledgments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "oaths_of_office" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "appointment_version_id" UUID NOT NULL,
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_by_membership_id" UUID NOT NULL,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "oaths_of_office_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oaths_of_office_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "oaths_of_office_version_fkey"
    FOREIGN KEY ("agency_id", "appointment_version_id")
    REFERENCES "appointment_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oaths_of_office_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oaths_of_office_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oaths_of_office_version_key" UNIQUE ("appointment_version_id"),
  CONSTRAINT "oaths_of_office_agency_version_key"
    UNIQUE ("agency_id", "appointment_version_id"),
  CONSTRAINT "oaths_of_office_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "oath_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "oath_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "oath_date" DATE NOT NULL,
  "administered_by_membership_id" UUID NOT NULL,
  "authority" TEXT NOT NULL CHECK (btrim("authority") <> ''),
  "place" TEXT,
  "permitted_virtual_method" TEXT,
  "document_version_id" UUID NOT NULL,
  "replaces_oath_version_id" UUID,
  "correction_reason" TEXT,
  "correction_authority_document_version_id" UUID,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "oath_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oath_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "oath_versions_oath_fkey"
    FOREIGN KEY ("agency_id", "oath_id")
    REFERENCES "oaths_of_office"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oath_versions_administerer_fkey"
    FOREIGN KEY ("agency_id", "administered_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oath_versions_document_fkey"
    FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oath_versions_predecessor_fkey"
    FOREIGN KEY ("agency_id", "replaces_oath_version_id")
    REFERENCES "oath_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oath_versions_correction_authority_fkey"
    FOREIGN KEY ("agency_id", "correction_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "oath_versions_version_key" UNIQUE ("oath_id", "version_no"),
  CONSTRAINT "oath_versions_agency_oath_id_key" UNIQUE ("agency_id", "oath_id", "id"),
  CONSTRAINT "oath_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "oaths_of_office"
  ADD CONSTRAINT "oaths_of_office_current_version_fk"
  FOREIGN KEY ("agency_id", "id", "current_version_id")
  REFERENCES "oath_versions"("agency_id", "oath_id", "id")
  ON DELETE RESTRICT;

CREATE TABLE "assumptions_to_duty" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "appointment_version_id" UUID NOT NULL,
  "current_version_id" UUID,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('PENDING', 'ASSUMED', 'DID_NOT_ASSUME', 'CANCELLED')),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by_membership_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_by_membership_id" UUID NOT NULL,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "assumptions_to_duty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assumptions_to_duty_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "assumptions_to_duty_version_fkey"
    FOREIGN KEY ("agency_id", "appointment_version_id")
    REFERENCES "appointment_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumptions_to_duty_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumptions_to_duty_updater_fkey"
    FOREIGN KEY ("agency_id", "updated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumptions_to_duty_version_key" UNIQUE ("appointment_version_id"),
  CONSTRAINT "assumptions_to_duty_agency_version_key"
    UNIQUE ("agency_id", "appointment_version_id"),
  CONSTRAINT "assumptions_to_duty_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "assumption_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "assumption_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL CHECK ("version_no" > 0),
  "oath_version_id" UUID NOT NULL,
  "actual_assumption_date" DATE NOT NULL,
  "certified_by_membership_id" UUID NOT NULL,
  "certifying_authority" TEXT NOT NULL CHECK (btrim("certifying_authority") <> ''),
  "certified_at" TIMESTAMPTZ(6) NOT NULL,
  "document_version_id" UUID NOT NULL,
  "replaces_assumption_version_id" UUID,
  "correction_reason" TEXT,
  "correction_authority_document_version_id" UUID,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "assumption_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assumption_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_versions_assumption_fkey"
    FOREIGN KEY ("agency_id", "assumption_id")
    REFERENCES "assumptions_to_duty"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_versions_oath_version_fkey"
    FOREIGN KEY ("agency_id", "oath_version_id")
    REFERENCES "oath_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_versions_certifier_fkey"
    FOREIGN KEY ("agency_id", "certified_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_versions_document_fkey"
    FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_versions_predecessor_fkey"
    FOREIGN KEY ("agency_id", "replaces_assumption_version_id")
    REFERENCES "assumption_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_versions_correction_authority_fkey"
    FOREIGN KEY ("agency_id", "correction_authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_versions_version_key" UNIQUE ("assumption_id", "version_no"),
  CONSTRAINT "assumption_versions_agency_assumption_id_key"
    UNIQUE ("agency_id", "assumption_id", "id"),
  CONSTRAINT "assumption_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

ALTER TABLE "assumptions_to_duty"
  ADD CONSTRAINT "assumptions_to_duty_current_version_fk"
  FOREIGN KEY ("agency_id", "id", "current_version_id")
  REFERENCES "assumption_versions"("agency_id", "assumption_id", "id")
  ON DELETE RESTRICT;

CREATE TABLE "assumption_outcome_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "assumption_id" UUID NOT NULL,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('DID_NOT_ASSUME', 'CANCELLED')),
  "notice_date" DATE,
  "deadline_date" DATE,
  "outcome_date" DATE NOT NULL,
  "reason" TEXT NOT NULL CHECK (btrim("reason") <> ''),
  "authorized_by_membership_id" UUID NOT NULL,
  "authority_document_version_id" UUID NOT NULL,
  "evidence_document_version_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "assumption_outcome_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assumption_outcome_events_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_outcome_events_assumption_fkey"
    FOREIGN KEY ("agency_id", "assumption_id")
    REFERENCES "assumptions_to_duty"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_outcome_events_authorizer_fkey"
    FOREIGN KEY ("agency_id", "authorized_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_outcome_events_authority_fkey"
    FOREIGN KEY ("agency_id", "authority_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_outcome_events_evidence_fkey"
    FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "assumption_outcome_events_notice_check"
    CHECK ("outcome" <> 'DID_NOT_ASSUME' OR ("notice_date" IS NOT NULL AND "deadline_date" IS NOT NULL)),
  CONSTRAINT "assumption_outcome_events_assumption_key" UNIQUE ("assumption_id"),
  CONSTRAINT "assumption_outcome_events_agency_assumption_key"
    UNIQUE ("agency_id", "assumption_id"),
  CONSTRAINT "assumption_outcome_events_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE OR REPLACE FUNCTION guard_appointment_acknowledgment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Appointment acknowledgments require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Appointment acknowledgments are retained and cannot be changed' USING ERRCODE = '55000';
  END IF;
  SELECT version."status" INTO version_status
  FROM "appointment_versions" version
  WHERE version."agency_id" = NEW."agency_id"
    AND version."id" = NEW."appointment_version_id";
  IF version_status IS DISTINCT FROM 'ISSUED' THEN
    RAISE EXCEPTION 'Appointment acknowledgment requires an issued Appointment version' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_oath_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Oaths require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Oaths are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."current_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Oaths begin without a current version' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."appointment_version_id" IS DISTINCT FROM NEW."appointment_version_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Oath identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_oath_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  version_status TEXT;
  acknowledged BOOLEAN;
  predecessor_version INTEGER;
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Oath versions require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Oath versions are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT appointment_version."status"
  INTO version_status
  FROM "oaths_of_office" oath
  JOIN "appointment_versions" appointment_version
    ON appointment_version."agency_id" = oath."agency_id"
    AND appointment_version."id" = oath."appointment_version_id"
  WHERE oath."agency_id" = NEW."agency_id"
    AND oath."id" = NEW."oath_id";
  IF version_status IS DISTINCT FROM 'ISSUED' THEN
    RAISE EXCEPTION 'Oath versions require an issued Appointment version' USING ERRCODE = '55000';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM "oaths_of_office" oath
    JOIN "appointment_acknowledgments" acknowledgment
      ON acknowledgment."agency_id" = oath."agency_id"
      AND acknowledgment."appointment_version_id" = oath."appointment_version_id"
    WHERE oath."agency_id" = NEW."agency_id"
      AND oath."id" = NEW."oath_id"
  ) INTO acknowledged;
  IF NOT acknowledged THEN
    RAISE EXCEPTION 'Oath versions require the appointee acknowledgment' USING ERRCODE = '55000';
  END IF;
  IF NEW."version_no" = 1 THEN
    IF NEW."replaces_oath_version_id" IS NOT NULL
      OR NEW."correction_reason" IS NOT NULL
      OR NEW."correction_authority_document_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'The first Oath version cannot replace a predecessor' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF NEW."replaces_oath_version_id" IS NULL
      OR NEW."correction_reason" IS NULL
      OR NEW."correction_authority_document_version_id" IS NULL THEN
      RAISE EXCEPTION 'Replacement Oath versions require reason and authority' USING ERRCODE = '55000';
    END IF;
    SELECT version."version_no" INTO predecessor_version
    FROM "oath_versions" version
    WHERE version."agency_id" = NEW."agency_id"
      AND version."id" = NEW."replaces_oath_version_id"
      AND version."oath_id" = NEW."oath_id";
    IF predecessor_version IS NULL OR NEW."version_no" <> predecessor_version + 1 THEN
      RAISE EXCEPTION 'Replacement Oath versions must follow their predecessor' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_assumption_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Assumptions require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assumptions are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' OR NEW."current_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Assumptions begin pending without a current version' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."appointment_version_id" IS DISTINCT FROM NEW."appointment_version_id"
    OR OLD."created_by_membership_id" IS DISTINCT FROM NEW."created_by_membership_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Assumption identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'PENDING' THEN
    IF NEW."status" NOT IN ('PENDING', 'ASSUMED', 'DID_NOT_ASSUME', 'CANCELLED') THEN
      RAISE EXCEPTION 'Pending Assumption has an invalid transition' USING ERRCODE = '55000';
    END IF;
  ELSIF OLD."status" = 'ASSUMED' THEN
    IF NEW."status" <> 'ASSUMED' THEN
      RAISE EXCEPTION 'An assumed Assumption is finalized and cannot change status' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'Finalized Assumptions cannot change status' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'ASSUMED' AND NEW."current_version_id" IS NULL THEN
    RAISE EXCEPTION 'An assumed Assumption requires its current version' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" <> 'ASSUMED' AND NEW."current_version_id" IS NOT NULL THEN
    RAISE EXCEPTION 'An unassumed Assumption cannot have a current version' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_assumption_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  assumption_status TEXT;
  predecessor_version INTEGER;
  oath_matches BOOLEAN;
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Assumption versions require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assumption versions are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT assumption."status" INTO assumption_status
  FROM "assumptions_to_duty" assumption
  WHERE assumption."agency_id" = NEW."agency_id"
    AND assumption."id" = NEW."assumption_id";
  IF assumption_status IS NULL THEN
    RAISE EXCEPTION 'Assumption version requires its Assumption' USING ERRCODE = '55000';
  END IF;
  IF NEW."version_no" = 1 THEN
    IF NEW."replaces_assumption_version_id" IS NOT NULL
      OR NEW."correction_reason" IS NOT NULL
      OR NEW."correction_authority_document_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'The first Assumption version cannot replace a predecessor' USING ERRCODE = '55000';
    END IF;
    IF assumption_status <> 'PENDING' THEN
      RAISE EXCEPTION 'The first Assumption version requires a pending Assumption' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF NEW."replaces_assumption_version_id" IS NULL
      OR NEW."correction_reason" IS NULL
      OR NEW."correction_authority_document_version_id" IS NULL THEN
      RAISE EXCEPTION 'Replacement Assumption versions require reason and authority' USING ERRCODE = '55000';
    END IF;
    SELECT version."version_no" INTO predecessor_version
    FROM "assumption_versions" version
    WHERE version."agency_id" = NEW."agency_id"
      AND version."id" = NEW."replaces_assumption_version_id"
      AND version."assumption_id" = NEW."assumption_id";
    IF predecessor_version IS NULL OR NEW."version_no" <> predecessor_version + 1 THEN
      RAISE EXCEPTION 'Replacement Assumption versions must follow their predecessor' USING ERRCODE = '55000';
    END IF;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM "assumptions_to_duty" assumption
    JOIN "oaths_of_office" oath
      ON oath."agency_id" = assumption."agency_id"
      AND oath."appointment_version_id" = assumption."appointment_version_id"
    JOIN "oath_versions" oath_version
      ON oath_version."agency_id" = oath."agency_id"
      AND oath_version."oath_id" = oath."id"
    WHERE assumption."agency_id" = NEW."agency_id"
      AND assumption."id" = NEW."assumption_id"
      AND oath_version."id" = NEW."oath_version_id"
  ) INTO oath_matches;
  IF NOT oath_matches THEN
    RAISE EXCEPTION 'Assumption versions require the linked Oath version' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_assumption_outcome_event_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  assumption_status TEXT;
BEGIN
  IF current_setting('app.appointment_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Assumption outcomes require the Appointment service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assumption outcomes are retained and cannot be changed' USING ERRCODE = '55000';
  END IF;
  SELECT assumption."status" INTO assumption_status
  FROM "assumptions_to_duty" assumption
  WHERE assumption."agency_id" = NEW."agency_id"
    AND assumption."id" = NEW."assumption_id";
  IF assumption_status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Assumption outcomes require a pending Assumption' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "appointment_acknowledgments_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "appointment_acknowledgments"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_acknowledgment_mutation();
CREATE TRIGGER "oaths_of_office_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "oaths_of_office"
  FOR EACH ROW EXECUTE FUNCTION guard_oath_mutation();
CREATE TRIGGER "oath_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "oath_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_oath_version_mutation();
CREATE TRIGGER "assumptions_to_duty_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "assumptions_to_duty"
  FOR EACH ROW EXECUTE FUNCTION guard_assumption_mutation();
CREATE TRIGGER "assumption_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "assumption_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_assumption_version_mutation();
CREATE TRIGGER "assumption_outcome_events_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "assumption_outcome_events"
  FOR EACH ROW EXECUTE FUNCTION guard_assumption_outcome_event_mutation();

CREATE TRIGGER "oaths_of_office_set_updated_at_trigger"
  BEFORE UPDATE ON "oaths_of_office"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();
CREATE TRIGGER "assumptions_to_duty_set_updated_at_trigger"
  BEFORE UPDATE ON "assumptions_to_duty"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_row_version();

GRANT SELECT, INSERT ON TABLE "appointment_acknowledgments" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "oaths_of_office" TO hris_app;
GRANT SELECT, INSERT ON TABLE "oath_versions" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "assumptions_to_duty" TO hris_app;
GRANT SELECT, INSERT ON TABLE "assumption_versions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "assumption_outcome_events" TO hris_app;

REVOKE UPDATE, DELETE ON TABLE "appointment_acknowledgments" FROM hris_app;
REVOKE DELETE ON TABLE "oaths_of_office" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "oath_versions" FROM hris_app;
REVOKE DELETE ON TABLE "assumptions_to_duty" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "assumption_versions" FROM hris_app;
REVOKE UPDATE, DELETE ON TABLE "assumption_outcome_events" FROM hris_app;

ALTER TABLE "appointment_acknowledgments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_acknowledgments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oaths_of_office" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oaths_of_office" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oath_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oath_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assumptions_to_duty" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assumptions_to_duty" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assumption_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assumption_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assumption_outcome_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assumption_outcome_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appointment_acknowledgments_rls_select"
  ON "appointment_acknowledgments" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "appointment_acknowledgments_rls_insert"
  ON "appointment_acknowledgments" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "oaths_of_office_rls_select"
  ON "oaths_of_office" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "oaths_of_office_rls_insert"
  ON "oaths_of_office" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');
CREATE POLICY "oaths_of_office_rls_update"
  ON "oaths_of_office" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "oath_versions_rls_select"
  ON "oath_versions" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "oath_versions_rls_insert"
  ON "oath_versions" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "assumptions_to_duty_rls_select"
  ON "assumptions_to_duty" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "assumptions_to_duty_rls_insert"
  ON "assumptions_to_duty" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');
CREATE POLICY "assumptions_to_duty_rls_update"
  ON "assumptions_to_duty" FOR UPDATE
  USING ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on')
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "assumption_versions_rls_select"
  ON "assumption_versions" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "assumption_versions_rls_insert"
  ON "assumption_versions" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

CREATE POLICY "assumption_outcome_events_rls_select"
  ON "assumption_outcome_events" FOR SELECT
  USING ("agency_id" = app_agency_id());
CREATE POLICY "assumption_outcome_events_rls_insert"
  ON "assumption_outcome_events" FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id() AND current_setting('app.appointment_transition', true) = 'on');

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('appointments.assumption.create', 'appointments', 'HIGH', 'Record the appointee acknowledgment of the issued Appointment and open the pending assumption'),
  ('appointments.oath.record', 'appointments', 'HIGH', 'Record or replace the versioned oath of office from exact evidence'),
  ('appointments.assumption.certify', 'appointments', 'CRITICAL', 'Certify the actual Assumption to Duty and publish the assumed Appointment contract'),
  ('appointments.assumption.fail', 'appointments', 'CRITICAL', 'Record an evidenced failure to assume without reopening the Selection Decision'),
  ('appointments.assumption.cancel', 'appointments', 'CRITICAL', 'Record a lawful pre-assumption cancellation with authority and evidence'),
  ('appointments.assumption.correct', 'appointments', 'CRITICAL', 'Correct an oath or Assumption to Duty through a linked evidenced replacement')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'appointments.assumption.create',
  'appointments.oath.record',
  'appointments.assumption.certify',
  'appointments.assumption.fail',
  'appointments.assumption.cancel',
  'appointments.assumption.correct'
)
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator', 'personnel_records_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'appointments.oath.record',
  'appointments.assumption.certify',
  'appointments.assumption.cancel',
  'appointments.assumption.correct'
)
WHERE r."code" = 'appointing_authority' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appointment_acknowledgments'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'oaths_of_office'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'oath_versions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'assumptions_to_duty'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'assumption_versions'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'assumption_outcome_events'::regclass), false) THEN
    RAISE EXCEPTION 'Oath and assumption migration verification failed';
  END IF;
END;
$$;
