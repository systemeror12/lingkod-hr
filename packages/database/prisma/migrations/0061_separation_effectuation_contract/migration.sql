-- Correction plan: separation cases and effects are authoritative history.
-- After deployment, correct them only through reviewed forward migrations;
-- do not drop or rewrite records created by an effective separation.

CREATE TABLE "separation_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "separation_type" TEXT NOT NULL,
  "proposed_effective_date" DATE NOT NULL,
  "approved_effective_date" DATE,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "initiated_by_membership_id" UUID NOT NULL,
  "approved_by_membership_id" UUID,
  "service_segment_id" UUID,
  "position_incumbency_id" UUID,
  "effectuated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "separation_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "separation_cases_type_check" CHECK ("separation_type" IN (
    'RESIGNATION', 'DISMISSAL', 'DROPPING_FROM_ROLLS', 'EXPIRATION',
    'TERMINATION', 'RETIREMENT', 'DEATH', 'TRANSFER', 'REORGANIZATION', 'OTHER'
  )),
  CONSTRAINT "separation_cases_status_check" CHECK ("status" IN (
    'DRAFT', 'SUBMITTED', 'FOR_REVIEW', 'APPROVED',
    'CLEARANCE_IN_PROGRESS', 'CLEARED', 'EFFECTIVE', 'CANCELLED'
  )),
  CONSTRAINT "separation_cases_effectuation_check" CHECK (
    ("status" = 'EFFECTIVE' AND "effectuated_at" IS NOT NULL)
    OR ("status" <> 'EFFECTIVE' AND "effectuated_at" IS NULL)
  ),
  CONSTRAINT "separation_cases_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "separation_cases_employee_fkey"
    FOREIGN KEY ("agency_id", "employee_id") REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "separation_cases_initiator_fkey"
    FOREIGN KEY ("agency_id", "initiated_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "separation_cases_approver_fkey"
    FOREIGN KEY ("agency_id", "approved_by_membership_id") REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "separation_cases_service_segment_fkey"
    FOREIGN KEY ("agency_id", "service_segment_id") REFERENCES "service_segments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "separation_cases_position_incumbency_fkey"
    FOREIGN KEY ("agency_id", "position_incumbency_id") REFERENCES "position_incumbencies"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "separation_cases_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE UNIQUE INDEX "separation_cases_one_active_uq"
  ON "separation_cases" ("agency_id", "employee_id")
  WHERE "status" IN ('SUBMITTED', 'FOR_REVIEW', 'APPROVED', 'CLEARANCE_IN_PROGRESS', 'CLEARED');
CREATE INDEX "separation_cases_employee_status_idx"
  ON "separation_cases" ("agency_id", "employee_id", "status");

CREATE TABLE "separation_effects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "separation_case_id" UUID NOT NULL,
  "effect_type" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" UUID NOT NULL,
  "applied_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL,
  "failure_reason" TEXT,
  CONSTRAINT "separation_effects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "separation_effects_type_check" CHECK ("effect_type" IN (
    'CLOSE_SERVICE', 'VACATE_POSITION', 'STOP_SCHEDULE',
    'STOP_PAYROLL', 'DEACTIVATE_MEMBERSHIP', 'REVOKE_SESSIONS'
  )),
  CONSTRAINT "separation_effects_status_check" CHECK ("status" IN ('PENDING', 'APPLIED', 'FAILED', 'REVERSED')),
  CONSTRAINT "separation_effects_agency_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "separation_effects_case_fkey"
    FOREIGN KEY ("agency_id", "separation_case_id") REFERENCES "separation_cases"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "separation_effects_agency_id_key" UNIQUE ("agency_id", "id"),
  CONSTRAINT "separation_effects_case_type_target_key" UNIQUE ("separation_case_id", "effect_type", "target_id")
);

CREATE INDEX "separation_effects_case_idx"
  ON "separation_effects" ("agency_id", "separation_case_id");

GRANT SELECT, INSERT, UPDATE ON TABLE "separation_cases" TO hris_app;
GRANT SELECT, INSERT ON TABLE "separation_effects" TO hris_app;

ALTER TABLE "separation_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "separation_cases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "separation_effects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "separation_effects" FORCE ROW LEVEL SECURITY;

CREATE POLICY "separation_cases_select" ON "separation_cases"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "separation_cases_insert" ON "separation_cases"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "separation_cases_update" ON "separation_cases"
  FOR UPDATE USING ("agency_id" = app_agency_id()) WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "separation_effects_select" ON "separation_effects"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "separation_effects_insert" ON "separation_effects"
  FOR INSERT WITH CHECK (
    "agency_id" = app_agency_id()
    AND current_setting('app.personnel_action_transition', true) = 'on'
  );

DO $$
BEGIN
  IF to_regclass('public.separation_cases') IS NULL
    OR to_regclass('public.separation_effects') IS NULL
    OR NOT COALESCE((
      SELECT relforcerowsecurity FROM pg_class WHERE oid = 'separation_cases'::regclass
    ), false)
    OR NOT COALESCE((
      SELECT relforcerowsecurity FROM pg_class WHERE oid = 'separation_effects'::regclass
    ), false) THEN
    RAISE EXCEPTION 'Separation effectuation contract verification failed';
  END IF;
END;
$$;
