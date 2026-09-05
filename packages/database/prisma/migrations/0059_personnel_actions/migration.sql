ALTER TABLE "delegated_authorities"
  ADD CONSTRAINT "delegated_authorities_agency_id_key" UNIQUE ("agency_id", "id");

CREATE TABLE "personnel_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "action_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "current_version_id" UUID,
  "prepared_by_membership_id" UUID NOT NULL,
  "approved_by_membership_id" UUID,
  "approval_delegation_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "supersedes_action_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "personnel_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personnel_actions_type_check" CHECK ("action_type" IN (
    'REASSIGNMENT', 'DETAIL', 'DESIGNATION', 'SECONDMENT',
    'SAME_ITEM_REINSTATEMENT', 'SEPARATION_RESIGNATION',
    'SEPARATION_DISMISSAL', 'SEPARATION_DROPPING_FROM_ROLLS',
    'SEPARATION_EXPIRATION', 'SEPARATION_TERMINATION',
    'SEPARATION_RETIREMENT', 'SEPARATION_DEATH',
    'SALARY_ADJUSTMENT', 'STEP_INCREMENT'
  )),
  CONSTRAINT "personnel_actions_status_check" CHECK ("status" IN (
    'DRAFT', 'FOR_REVIEW', 'FOR_APPROVAL', 'APPROVED',
    'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'
  )),
  CONSTRAINT "personnel_actions_approval_check" CHECK (
    ("approved_at" IS NULL AND "approved_by_membership_id" IS NULL AND "approval_delegation_id" IS NULL)
    OR ("approved_at" IS NOT NULL AND "approved_by_membership_id" IS NOT NULL)
  ),
  CONSTRAINT "personnel_actions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_actions_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_actions_preparer_fkey"
    FOREIGN KEY ("agency_id", "prepared_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_actions_approver_fkey"
    FOREIGN KEY ("agency_id", "approved_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_actions_approval_delegation_fkey"
    FOREIGN KEY ("agency_id", "approval_delegation_id")
    REFERENCES "delegated_authorities"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_actions_supersedes_fkey"
    FOREIGN KEY ("agency_id", "supersedes_action_id")
    REFERENCES "personnel_actions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_actions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "personnel_actions_current_version_relation_key"
    UNIQUE ("agency_id", "id", "current_version_id")
);

CREATE TABLE "personnel_action_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "action_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "proposed_effectivity" DATE NOT NULL,
  "from_service_segment_id" UUID NOT NULL,
  "target_position_id" UUID,
  "target_organization_unit_id" UUID,
  "target_facts" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_action_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personnel_action_versions_number_check" CHECK ("version_no" > 0),
  CONSTRAINT "personnel_action_versions_reason_check" CHECK (btrim("reason") <> ''),
  CONSTRAINT "personnel_action_versions_target_facts_check" CHECK (jsonb_typeof("target_facts") = 'object'),
  CONSTRAINT "personnel_action_versions_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_versions_action_fkey"
    FOREIGN KEY ("agency_id", "action_id")
    REFERENCES "personnel_actions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_versions_service_segment_fkey"
    FOREIGN KEY ("agency_id", "from_service_segment_id")
    REFERENCES "service_segments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_versions_target_position_fkey"
    FOREIGN KEY ("agency_id", "target_position_id")
    REFERENCES "plantilla_positions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_versions_target_unit_fkey"
    FOREIGN KEY ("agency_id", "target_organization_unit_id")
    REFERENCES "organization_units"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_versions_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_versions_action_number_key" UNIQUE ("action_id", "version_no"),
  CONSTRAINT "personnel_action_versions_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "personnel_action_versions_action_identity_key" UNIQUE ("agency_id", "action_id", "id")
);

ALTER TABLE "personnel_actions"
  ADD CONSTRAINT "personnel_actions_current_version_fkey"
  FOREIGN KEY ("agency_id", "id", "current_version_id")
  REFERENCES "personnel_action_versions"("agency_id", "action_id", "id") ON DELETE RESTRICT;

CREATE TABLE "personnel_action_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "action_version_id" UUID NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "source_date" DATE NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_action_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personnel_action_evidence_type_check" CHECK ("evidence_type" IN (
    'ABSENCE_RECORD', 'ACCEPTANCE', 'APPEAL_STATE', 'APPOINTMENT_TERM', 'AUTHORITY',
    'BACK_PAY_DETERMINATION', 'CSC_SUBMISSION', 'CURRENT_APPOINTMENT_STATION',
    'CURRENT_COMPENSATION', 'DEATH_CERTIFICATE', 'DETAIL_ORDER', 'DROPPING_ORDER',
    'DUE_PROCESS', 'ELIGIBILITY', 'EXECUTORY_DECISION', 'EXPERIENCE', 'GSIS_COVERAGE',
    'INTER_AGENCY_AGREEMENT', 'LEAVE_CERTIFICATION', 'NO_MISCONDUCT', 'NOSI', 'NOTICE',
    'OFFICE_ORDER', 'ORIGINAL_ITEM', 'PAY_AUTHORITY', 'PAY_TABLE_VERSION',
    'PERFORMANCE_OR_SERVICE', 'PERFORMANCE_RATING', 'PERMANENT_APPOINTMENT',
    'PRIOR_SEPARATION', 'QUALIFICATION', 'RECEIVING_DUTIES', 'RETIREMENT_NOTICE',
    'SALARY_ADJUSTMENT_NOTICE', 'SERVICE_CONTINUITY', 'SIGNED_MOA',
    'TERMINATION_ORDER', 'WITHDRAWAL_STATE', 'WRITTEN_RESIGNATION'
  )),
  CONSTRAINT "personnel_action_evidence_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_evidence_version_fkey"
    FOREIGN KEY ("agency_id", "action_version_id")
    REFERENCES "personnel_action_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_evidence_document_fkey"
    FOREIGN KEY ("agency_id", "document_id")
    REFERENCES "documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_evidence_document_version_fkey"
    FOREIGN KEY ("agency_id", "document_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "document_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_evidence_creator_fkey"
    FOREIGN KEY ("agency_id", "created_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "personnel_action_evidence_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "personnel_action_evidence_version_type_document_key"
    UNIQUE ("action_version_id", "evidence_type", "document_version_id")
);

ALTER TABLE "service_segments"
  ADD CONSTRAINT "service_segments_personnel_action_fkey"
  FOREIGN KEY ("agency_id", "personnel_action_id")
  REFERENCES "personnel_actions"("agency_id", "id") ON DELETE RESTRICT;

CREATE INDEX "personnel_actions_status_created_idx"
  ON "personnel_actions" ("agency_id", "status", "created_at" DESC);
CREATE INDEX "personnel_actions_employee_created_idx"
  ON "personnel_actions" ("agency_id", "employee_id", "created_at" DESC);
CREATE INDEX "personnel_action_versions_action_number_idx"
  ON "personnel_action_versions" ("agency_id", "action_id", "version_no");
CREATE INDEX "personnel_action_evidence_version_type_idx"
  ON "personnel_action_evidence" ("agency_id", "action_version_id", "evidence_type");

CREATE FUNCTION set_personnel_action_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  NEW."row_version" = OLD."row_version" + 1;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_personnel_action_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Personnel Actions are retained and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Personnel Action changes require the application service' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD."agency_id" IS DISTINCT FROM NEW."agency_id"
    OR OLD."employee_id" IS DISTINCT FROM NEW."employee_id"
    OR OLD."action_type" IS DISTINCT FROM NEW."action_type"
    OR OLD."prepared_by_membership_id" IS DISTINCT FROM NEW."prepared_by_membership_id"
    OR OLD."supersedes_action_id" IS DISTINCT FROM NEW."supersedes_action_id"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'Personnel Action identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('APPROVED', 'CANCELLED', 'SUPERSEDED') AND (
    OLD."current_version_id" IS DISTINCT FROM NEW."current_version_id"
    OR OLD."approved_by_membership_id" IS DISTINCT FROM NEW."approved_by_membership_id"
    OR OLD."approval_delegation_id" IS DISTINCT FROM NEW."approval_delegation_id"
    OR OLD."approved_at" IS DISTINCT FROM NEW."approved_at"
    OR NEW."status" NOT IN ('APPROVED', 'CANCELLED', 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'Approved Personnel Actions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_personnel_action_version_append_only()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Personnel Action versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Personnel Action versions require the application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_personnel_action_evidence_append_only()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Personnel Action evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF current_setting('app.personnel_action_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Personnel Action evidence requires the application service' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "personnel_actions_updated_at_trigger"
  BEFORE UPDATE ON "personnel_actions"
  FOR EACH ROW EXECUTE FUNCTION set_personnel_action_updated_at();
CREATE TRIGGER "personnel_actions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "personnel_actions"
  FOR EACH ROW EXECUTE FUNCTION guard_personnel_action_mutation();
CREATE TRIGGER "personnel_action_versions_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "personnel_action_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_personnel_action_version_append_only();
CREATE TRIGGER "personnel_action_evidence_mutation_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "personnel_action_evidence"
  FOR EACH ROW EXECUTE FUNCTION guard_personnel_action_evidence_append_only();

GRANT SELECT, INSERT, UPDATE ON TABLE "personnel_actions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "personnel_action_versions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "personnel_action_evidence" TO hris_app;

ALTER TABLE "personnel_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personnel_actions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "personnel_action_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personnel_action_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "personnel_action_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personnel_action_evidence" FORCE ROW LEVEL SECURITY;

CREATE POLICY "personnel_actions_select" ON "personnel_actions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "personnel_actions_insert" ON "personnel_actions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "personnel_actions_update" ON "personnel_actions"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "personnel_action_versions_select" ON "personnel_action_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "personnel_action_versions_insert" ON "personnel_action_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "personnel_action_evidence_select" ON "personnel_action_evidence"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "personnel_action_evidence_insert" ON "personnel_action_evidence"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.actions.read', 'personnel', 'MEDIUM', 'Read Personnel Actions'),
  ('personnel.actions.create', 'personnel', 'HIGH', 'Prepare Personnel Actions'),
  ('personnel.actions.submit', 'personnel', 'HIGH', 'Submit Personnel Actions'),
  ('personnel.actions.return', 'personnel', 'HIGH', 'Return deficient Personnel Actions'),
  ('personnel.actions.endorse', 'personnel', 'HIGH', 'Endorse Personnel Actions for approval'),
  ('personnel.actions.approve', 'personnel', 'CRITICAL', 'Approve Personnel Actions'),
  ('personnel.actions.reject', 'personnel', 'CRITICAL', 'Reject Personnel Actions'),
  ('personnel.actions.cancel', 'personnel', 'HIGH', 'Cancel draft Personnel Actions'),
  ('personnel.actions.cancel_approved', 'personnel', 'CRITICAL', 'Cancel approved Personnel Actions'),
  ('personnel.actions.effectuate', 'personnel', 'CRITICAL', 'Request Personnel Action effectuation'),
  ('personnel.actions.correct', 'personnel', 'HIGH', 'Prepare Personnel Action replacements'),
  ('personnel.actions.audit.read', 'personnel', 'MEDIUM', 'Read Personnel Action history')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "roles" ("code", "name", "is_system_template", "status")
VALUES ('appointing_authority', 'Appointing Authority', TRUE, 'ACTIVE')
ON CONFLICT ("code") WHERE "agency_id" IS NULL DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.actions.read', 'personnel.actions.create', 'personnel.actions.submit',
  'personnel.actions.cancel', 'personnel.actions.effectuate', 'personnel.actions.correct',
  'personnel.actions.audit.read'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.actions.read', 'personnel.actions.return', 'personnel.actions.endorse',
  'personnel.actions.effectuate', 'personnel.actions.correct', 'personnel.actions.audit.read'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'personnel.actions.read', 'personnel.actions.approve', 'personnel.actions.reject',
  'personnel.actions.cancel_approved', 'personnel.actions.audit.read'
)
WHERE r."code" = 'appointing_authority' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('personnel.actions.read', 'personnel.actions.audit.read')
WHERE r."code" IN ('agency_administrator', 'internal_auditor') AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
