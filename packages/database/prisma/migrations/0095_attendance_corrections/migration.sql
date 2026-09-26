-- Phase 7 Attendance corrections. An Employee or scoped HR Administrator
-- requests an evidence-backed ADD, REPLACE, or VOID of one Attendance Event or
-- Attendance Context. The original fact is never edited: an applied correction
-- records one immutable normalized effect, supersedes the current Attendance
-- Day versions of every affected Work Date, and marks affected Employee
-- Attendance Submissions stale. A correction that touches a locked Attendance
-- Period Version stops at FOR_AUTHORIZATION and requires a different HR
-- Administrator to authorize one grouped Locked Attendance Adjustment before
-- complete successor Attendance Period Versions are created. Submission and
-- period-review workflows belong to #168 and #169; their records exist here so
-- corrections can prove staleness and successor membership.

CREATE TABLE "employee_attendance_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_period_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "submitted_by_membership_id" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(6),
  "on_behalf_reason" TEXT,
  "evidence_document_version_id" UUID,
  "reviewed_by_membership_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "review_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_attendance_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_attendance_submissions_version_no_check" CHECK ("version_no" > 0),
  CONSTRAINT "employee_attendance_submissions_status_check" CHECK (
    "status" IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'CANCELLED', 'STALE')
  ),
  CONSTRAINT "employee_attendance_submissions_on_behalf_check" CHECK (
    ("on_behalf_reason" IS NULL AND "evidence_document_version_id" IS NULL)
    OR ("on_behalf_reason" IS NOT NULL AND "evidence_document_version_id" IS NOT NULL)
  ),
  CONSTRAINT "employee_attendance_submissions_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submissions_period_fkey" FOREIGN KEY ("agency_id", "attendance_period_id")
    REFERENCES "attendance_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submissions_employee_fkey" FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submissions_submitter_fkey" FOREIGN KEY ("agency_id", "submitted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submissions_evidence_fkey" FOREIGN KEY ("agency_id", "evidence_document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submissions_reviewer_fkey" FOREIGN KEY ("agency_id", "reviewed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submissions_attendance_period_id_employee_id_version_no_key"
    UNIQUE ("attendance_period_id", "employee_id", "version_no"),
  CONSTRAINT "employee_attendance_submissions_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "employee_attendance_submissions_employee_idx"
  ON "employee_attendance_submissions" ("agency_id", "employee_id", "status");
CREATE INDEX "employee_attendance_submissions_period_idx"
  ON "employee_attendance_submissions" ("agency_id", "attendance_period_id", "status");

CREATE TABLE "employee_attendance_submission_days" (
  "agency_id" UUID NOT NULL,
  "employee_attendance_submission_id" UUID NOT NULL,
  "attendance_day_id" UUID NOT NULL,
  CONSTRAINT "employee_attendance_submission_days_pkey"
    PRIMARY KEY ("employee_attendance_submission_id", "attendance_day_id"),
  CONSTRAINT "employee_attendance_submission_days_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submission_days_submission_fkey" FOREIGN KEY ("agency_id", "employee_attendance_submission_id")
    REFERENCES "employee_attendance_submissions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "employee_attendance_submission_days_day_fkey" FOREIGN KEY ("agency_id", "attendance_day_id")
    REFERENCES "attendance_days"("agency_id", "id") ON DELETE RESTRICT
);

CREATE INDEX "employee_attendance_submission_days_day_idx"
  ON "employee_attendance_submission_days" ("agency_id", "attendance_day_id");

CREATE TABLE "attendance_period_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_period_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "predecessor_version_id" UUID,
  "status" TEXT NOT NULL,
  "approval_route_version_id" UUID NOT NULL,
  "submitted_by_membership_id" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL,
  "reviewed_by_membership_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "review_reason" TEXT,
  "locked_by_membership_id" UUID,
  "locked_at" TIMESTAMPTZ(6),
  "reconciliation" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_period_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_period_versions_version_no_check" CHECK ("version_no" > 0),
  CONSTRAINT "attendance_period_versions_status_check" CHECK (
    "status" IN ('FOR_REVIEW', 'APPROVED', 'RETURNED', 'LOCKED')
  ),
  CONSTRAINT "attendance_period_versions_separation_check" CHECK (
    "reviewed_by_membership_id" IS NULL
    OR "locked_by_membership_id" IS NULL
    OR "reviewed_by_membership_id" <> "locked_by_membership_id"
  ),
  CONSTRAINT "attendance_period_versions_lock_check" CHECK (
    "status" <> 'LOCKED'
    OR (
      "reviewed_by_membership_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
      AND "locked_by_membership_id" IS NOT NULL
      AND "locked_at" IS NOT NULL
      AND "reconciliation" IS NOT NULL
    )
  ),
  CONSTRAINT "attendance_period_versions_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_versions_period_fkey" FOREIGN KEY ("agency_id", "attendance_period_id")
    REFERENCES "attendance_periods"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_versions_predecessor_fkey" FOREIGN KEY ("agency_id", "predecessor_version_id")
    REFERENCES "attendance_period_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_versions_route_fkey" FOREIGN KEY ("agency_id", "approval_route_version_id")
    REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_versions_submitter_fkey" FOREIGN KEY ("agency_id", "submitted_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_versions_reviewer_fkey" FOREIGN KEY ("agency_id", "reviewed_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_versions_locker_fkey" FOREIGN KEY ("agency_id", "locked_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_versions_attendance_period_id_version_no_key"
    UNIQUE ("attendance_period_id", "version_no"),
  CONSTRAINT "attendance_period_versions_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_period_versions_period_idx"
  ON "attendance_period_versions" ("agency_id", "attendance_period_id", "status");

CREATE TABLE "attendance_period_version_days" (
  "agency_id" UUID NOT NULL,
  "attendance_period_version_id" UUID NOT NULL,
  "employee_attendance_submission_id" UUID NOT NULL,
  "attendance_day_id" UUID NOT NULL,
  CONSTRAINT "attendance_period_version_days_pkey"
    PRIMARY KEY ("attendance_period_version_id", "attendance_day_id"),
  CONSTRAINT "attendance_period_version_days_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_version_days_version_fkey" FOREIGN KEY ("agency_id", "attendance_period_version_id")
    REFERENCES "attendance_period_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_version_days_submission_fkey" FOREIGN KEY ("agency_id", "employee_attendance_submission_id")
    REFERENCES "employee_attendance_submissions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_period_version_days_day_fkey" FOREIGN KEY ("agency_id", "attendance_day_id")
    REFERENCES "attendance_days"("agency_id", "id") ON DELETE RESTRICT
);

CREATE INDEX "attendance_period_version_days_day_idx"
  ON "attendance_period_version_days" ("agency_id", "attendance_day_id");

CREATE TABLE "attendance_corrections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "initiated_by_membership_id" UUID NOT NULL,
  "recorded_by_membership_id" UUID NOT NULL,
  "target_type" TEXT NOT NULL,
  "requested_action" TEXT NOT NULL,
  "target_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "requested_record" JSONB,
  "reason" TEXT NOT NULL,
  "approval_route_version_id" UUID NOT NULL,
  "impact_preview" JSONB NOT NULL,
  "submitted_at" TIMESTAMPTZ(6),
  "decided_by_membership_id" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "decision_reason" TEXT,
  "authorized_by_membership_id" UUID,
  "authorized_at" TIMESTAMPTZ(6),
  "applied_by_membership_id" UUID,
  "applied_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_corrections_target_type_check" CHECK (
    "target_type" IN ('ATTENDANCE_EVENT', 'ATTENDANCE_CONTEXT')
  ),
  CONSTRAINT "attendance_corrections_requested_action_check" CHECK (
    "requested_action" IN ('ADD', 'REPLACE', 'VOID')
  ),
  CONSTRAINT "attendance_corrections_status_check" CHECK (
    "status" IN (
      'DRAFT', 'SUBMITTED', 'NEEDS_INFORMATION', 'APPROVED', 'FOR_AUTHORIZATION',
      'REJECTED', 'CANCELLED', 'APPLIED'
    )
  ),
  CONSTRAINT "attendance_corrections_requested_fact_check" CHECK (
    ("requested_action" = 'ADD' AND "target_id" IS NULL AND "requested_record" IS NOT NULL)
    OR ("requested_action" = 'REPLACE' AND "target_id" IS NOT NULL AND "requested_record" IS NOT NULL)
    OR ("requested_action" = 'VOID' AND "target_id" IS NOT NULL AND "requested_record" IS NULL)
  ),
  CONSTRAINT "attendance_corrections_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_employee_fkey" FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_initiator_fkey" FOREIGN KEY ("agency_id", "initiated_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_recorder_fkey" FOREIGN KEY ("agency_id", "recorded_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_route_fkey" FOREIGN KEY ("agency_id", "approval_route_version_id")
    REFERENCES "approval_route_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_decider_fkey" FOREIGN KEY ("agency_id", "decided_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_authorizer_fkey" FOREIGN KEY ("agency_id", "authorized_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_applier_fkey" FOREIGN KEY ("agency_id", "applied_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_corrections_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_corrections_employee_idx"
  ON "attendance_corrections" ("agency_id", "employee_id", "status");
CREATE INDEX "attendance_corrections_status_idx"
  ON "attendance_corrections" ("agency_id", "status", "submitted_at");

CREATE TABLE "attendance_correction_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_correction_id" UUID NOT NULL,
  "document_version_id" UUID,
  "source_type" TEXT,
  "source_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_correction_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_correction_evidence_source_check" CHECK (
    ("document_version_id" IS NOT NULL AND "source_type" IS NULL AND "source_id" IS NULL)
    OR ("document_version_id" IS NULL AND "source_type" IS NOT NULL AND "source_id" IS NOT NULL)
  ),
  CONSTRAINT "attendance_correction_evidence_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_correction_evidence_correction_fkey" FOREIGN KEY ("agency_id", "attendance_correction_id")
    REFERENCES "attendance_corrections"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_correction_evidence_version_fkey" FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_correction_evidence_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_correction_evidence_correction_idx"
  ON "attendance_correction_evidence" ("agency_id", "attendance_correction_id");

CREATE TABLE "attendance_correction_effects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_correction_id" UUID NOT NULL,
  "effect_action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "original_target_id" UUID,
  "replacement_record" JSONB,
  "applied_by_membership_id" UUID NOT NULL,
  "applied_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "attendance_correction_effects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_correction_effects_action_check" CHECK (
    "effect_action" IN ('ADD', 'REPLACE', 'VOID')
  ),
  CONSTRAINT "attendance_correction_effects_target_type_check" CHECK (
    "target_type" IN ('ATTENDANCE_EVENT', 'ATTENDANCE_CONTEXT')
  ),
  CONSTRAINT "attendance_correction_effects_fact_check" CHECK (
    ("effect_action" = 'ADD' AND "original_target_id" IS NULL AND "replacement_record" IS NOT NULL)
    OR ("effect_action" = 'REPLACE' AND "original_target_id" IS NOT NULL AND "replacement_record" IS NOT NULL)
    OR ("effect_action" = 'VOID' AND "original_target_id" IS NOT NULL AND "replacement_record" IS NULL)
  ),
  CONSTRAINT "attendance_correction_effects_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_correction_effects_correction_fkey" FOREIGN KEY ("agency_id", "attendance_correction_id")
    REFERENCES "attendance_corrections"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_correction_effects_applier_fkey" FOREIGN KEY ("agency_id", "applied_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "attendance_correction_effects_correction_key" UNIQUE ("attendance_correction_id"),
  CONSTRAINT "attendance_correction_effects_agency_correction_key" UNIQUE ("agency_id", "attendance_correction_id"),
  CONSTRAINT "attendance_correction_effects_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "attendance_correction_effects_target_idx"
  ON "attendance_correction_effects" ("agency_id", "target_type", "original_target_id");

CREATE TABLE "locked_attendance_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_correction_id" UUID NOT NULL,
  "authorized_by_membership_id" UUID NOT NULL,
  "authorized_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "locked_attendance_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "locked_attendance_adjustments_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "locked_attendance_adjustments_correction_fkey" FOREIGN KEY ("agency_id", "attendance_correction_id")
    REFERENCES "attendance_corrections"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "locked_attendance_adjustments_authorizer_fkey" FOREIGN KEY ("agency_id", "authorized_by_membership_id")
    REFERENCES "agency_memberships"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "locked_attendance_adjustments_correction_key" UNIQUE ("attendance_correction_id"),
  CONSTRAINT "locked_attendance_adjustments_agency_correction_key" UNIQUE ("agency_id", "attendance_correction_id"),
  CONSTRAINT "locked_attendance_adjustments_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE TABLE "locked_attendance_adjustment_periods" (
  "agency_id" UUID NOT NULL,
  "locked_attendance_adjustment_id" UUID NOT NULL,
  "predecessor_period_version_id" UUID NOT NULL,
  "successor_period_version_id" UUID NOT NULL,
  CONSTRAINT "locked_attendance_adjustment_periods_pkey"
    PRIMARY KEY ("locked_attendance_adjustment_id", "predecessor_period_version_id"),
  CONSTRAINT "locked_attendance_adjustment_periods_successor_check" CHECK (
    "predecessor_period_version_id" <> "successor_period_version_id"
  ),
  CONSTRAINT "locked_attendance_adjustment_periods_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "locked_attendance_adjustment_periods_adjustment_fkey" FOREIGN KEY ("agency_id", "locked_attendance_adjustment_id")
    REFERENCES "locked_attendance_adjustments"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "locked_attendance_adjustment_periods_predecessor_fkey" FOREIGN KEY ("agency_id", "predecessor_period_version_id")
    REFERENCES "attendance_period_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "locked_attendance_adjustment_periods_successor_fkey" FOREIGN KEY ("agency_id", "successor_period_version_id")
    REFERENCES "attendance_period_versions"("agency_id", "id") ON DELETE RESTRICT
);

CREATE INDEX "locked_attendance_adjustment_periods_successor_idx"
  ON "locked_attendance_adjustment_periods" ("agency_id", "successor_period_version_id");

-- Employee Attendance Submission identity is fixed once recorded. The
-- submission workflow owns status movement; a correction only moves an
-- affected submission to STALE.
CREATE OR REPLACE FUNCTION guard_employee_attendance_submission_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employee Attendance Submissions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" <> OLD."agency_id"
     OR NEW."attendance_period_id" <> OLD."attendance_period_id"
     OR NEW."employee_id" <> OLD."employee_id"
     OR NEW."version_no" <> OLD."version_no"
     OR NEW."submitted_by_membership_id" <> OLD."submitted_by_membership_id"
     OR NEW."on_behalf_reason" IS DISTINCT FROM OLD."on_behalf_reason"
     OR NEW."evidence_document_version_id" IS DISTINCT FROM OLD."evidence_document_version_id"
     OR NEW."created_at" <> OLD."created_at"
  THEN
    RAISE EXCEPTION 'Employee Attendance Submission facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED', 'CANCELLED', 'STALE'))
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'RETURNED', 'STALE', 'CANCELLED'))
    OR (OLD."status" = 'RETURNED' AND NEW."status" IN ('SUBMITTED', 'STALE', 'CANCELLED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'STALE')
  ) THEN
    RAISE EXCEPTION 'Invalid Employee Attendance Submission state transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "employee_attendance_submissions_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "employee_attendance_submissions"
  FOR EACH ROW EXECUTE FUNCTION guard_employee_attendance_submission_mutation();

CREATE OR REPLACE FUNCTION guard_employee_attendance_submission_day_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Employee Attendance Submission day bindings are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "employee_attendance_submission_days_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "employee_attendance_submission_days"
  FOR EACH ROW EXECUTE FUNCTION guard_employee_attendance_submission_day_mutation();

-- Attendance Period Versions are immutable snapshots. Only review and lock
-- progression may move an unlocked version; a LOCKED version never changes.
CREATE OR REPLACE FUNCTION guard_attendance_period_version_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance Period Versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'LOCKED' THEN
    RAISE EXCEPTION 'A locked Attendance Period Version is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" <> OLD."agency_id"
     OR NEW."attendance_period_id" <> OLD."attendance_period_id"
     OR NEW."version_no" <> OLD."version_no"
     OR NEW."predecessor_version_id" IS DISTINCT FROM OLD."predecessor_version_id"
     OR NEW."approval_route_version_id" <> OLD."approval_route_version_id"
     OR NEW."submitted_by_membership_id" <> OLD."submitted_by_membership_id"
     OR NEW."submitted_at" <> OLD."submitted_at"
     OR NEW."created_at" <> OLD."created_at"
  THEN
    RAISE EXCEPTION 'Attendance Period Version snapshot facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'FOR_REVIEW' AND NEW."status" IN ('APPROVED', 'RETURNED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'LOCKED')
  ) THEN
    RAISE EXCEPTION 'Invalid Attendance Period Version state transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_period_versions_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_period_versions"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_period_version_mutation();

CREATE OR REPLACE FUNCTION guard_attendance_period_version_day_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Attendance Period Version membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_period_version_days_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_period_version_days"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_period_version_day_mutation();

-- An Attendance Correction preserves its facts and binds its impact preview
-- once submitted. ADD, REPLACE, or VOID facts and the routed authority stay
-- immutable; only an unsubmitted request may refresh its preview or route.
CREATE OR REPLACE FUNCTION guard_attendance_correction_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance Corrections are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."agency_id" <> OLD."agency_id"
     OR NEW."employee_id" <> OLD."employee_id"
     OR NEW."initiated_by_membership_id" <> OLD."initiated_by_membership_id"
     OR NEW."recorded_by_membership_id" <> OLD."recorded_by_membership_id"
     OR NEW."target_type" <> OLD."target_type"
     OR NEW."requested_action" <> OLD."requested_action"
     OR NEW."target_id" IS DISTINCT FROM OLD."target_id"
     OR NEW."reason" <> OLD."reason"
     OR NEW."created_at" <> OLD."created_at"
  THEN
    RAISE EXCEPTION 'Attendance Correction facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."requested_record" IS DISTINCT FROM OLD."requested_record"
     AND OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
  THEN
    RAISE EXCEPTION 'The requested Attendance Correction fact is bound once submitted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."approval_route_version_id" IS DISTINCT FROM OLD."approval_route_version_id"
     AND OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
  THEN
    RAISE EXCEPTION 'The Attendance Correction Approval Route Version is bound once submitted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."impact_preview" IS DISTINCT FROM OLD."impact_preview"
     AND OLD."status" NOT IN ('DRAFT', 'NEEDS_INFORMATION')
  THEN
    RAISE EXCEPTION 'The Attendance Correction Impact Preview is bound once submitted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED', 'CANCELLED'))
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN (
      'NEEDS_INFORMATION', 'APPLIED', 'FOR_AUTHORIZATION', 'REJECTED', 'CANCELLED'
    ))
    OR (OLD."status" = 'NEEDS_INFORMATION' AND NEW."status" IN ('SUBMITTED', 'CANCELLED'))
    OR (OLD."status" = 'FOR_AUTHORIZATION' AND NEW."status" = 'APPLIED')
  ) THEN
    RAISE EXCEPTION 'Invalid Attendance Correction state transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_corrections_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_corrections"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_correction_mutation();

CREATE OR REPLACE FUNCTION guard_attendance_correction_evidence_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Attendance Correction evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_correction_evidence_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_correction_evidence"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_correction_evidence_mutation();

CREATE OR REPLACE FUNCTION guard_attendance_correction_effect_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Attendance Correction Effects are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_correction_effects_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "attendance_correction_effects"
  FOR EACH ROW EXECUTE FUNCTION guard_attendance_correction_effect_mutation();

CREATE OR REPLACE FUNCTION guard_locked_attendance_adjustment_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Locked Attendance Adjustments are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "locked_attendance_adjustments_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "locked_attendance_adjustments"
  FOR EACH ROW EXECUTE FUNCTION guard_locked_attendance_adjustment_mutation();

CREATE TRIGGER "locked_attendance_adjustment_periods_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "locked_attendance_adjustment_periods"
  FOR EACH ROW EXECUTE FUNCTION guard_locked_attendance_adjustment_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "employee_attendance_submissions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "employee_attendance_submission_days" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "attendance_period_versions" TO hris_app;
GRANT SELECT, INSERT ON TABLE "attendance_period_version_days" TO hris_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "attendance_corrections" TO hris_app;
GRANT SELECT, INSERT ON TABLE "attendance_correction_evidence" TO hris_app;
GRANT SELECT, INSERT ON TABLE "attendance_correction_effects" TO hris_app;
GRANT SELECT, INSERT ON TABLE "locked_attendance_adjustments" TO hris_app;
GRANT SELECT, INSERT ON TABLE "locked_attendance_adjustment_periods" TO hris_app;

ALTER TABLE "employee_attendance_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_attendance_submissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "employee_attendance_submission_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_attendance_submission_days" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_period_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_period_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_period_version_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_period_version_days" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_corrections" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_correction_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_correction_evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_correction_effects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_correction_effects" FORCE ROW LEVEL SECURITY;
ALTER TABLE "locked_attendance_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locked_attendance_adjustments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "locked_attendance_adjustment_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locked_attendance_adjustment_periods" FORCE ROW LEVEL SECURITY;

CREATE POLICY "employee_attendance_submissions_select" ON "employee_attendance_submissions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "employee_attendance_submissions_insert" ON "employee_attendance_submissions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "employee_attendance_submissions_update" ON "employee_attendance_submissions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "employee_attendance_submission_days_select" ON "employee_attendance_submission_days"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "employee_attendance_submission_days_insert" ON "employee_attendance_submission_days"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_period_versions_select" ON "attendance_period_versions"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_period_versions_insert" ON "attendance_period_versions"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_period_versions_update" ON "attendance_period_versions"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_period_version_days_select" ON "attendance_period_version_days"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_period_version_days_insert" ON "attendance_period_version_days"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_corrections_select" ON "attendance_corrections"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_corrections_insert" ON "attendance_corrections"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_corrections_update" ON "attendance_corrections"
  FOR UPDATE USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_correction_evidence_select" ON "attendance_correction_evidence"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_correction_evidence_insert" ON "attendance_correction_evidence"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "attendance_correction_effects_select" ON "attendance_correction_effects"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "attendance_correction_effects_insert" ON "attendance_correction_effects"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "locked_attendance_adjustments_select" ON "locked_attendance_adjustments"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "locked_attendance_adjustments_insert" ON "locked_attendance_adjustments"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());
CREATE POLICY "locked_attendance_adjustment_periods_select" ON "locked_attendance_adjustment_periods"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "locked_attendance_adjustment_periods_insert" ON "locked_attendance_adjustment_periods"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  (
    'attendance.corrections.create',
    'attendance',
    'HIGH',
    'Create an evidence-backed Attendance Correction request for an own or assigned-scope Employee record'
  ),
  (
    'attendance.corrections.submit',
    'attendance',
    'HIGH',
    'Submit an Attendance Correction with reason, evidence, Approval Route Version, and impact preview'
  ),
  (
    'attendance.corrections.return',
    'attendance',
    'HIGH',
    'Return a submitted Attendance Correction for information'
  ),
  (
    'attendance.corrections.approve',
    'attendance',
    'CRITICAL',
    'Factually approve an Attendance Correction and apply it against an open period'
  ),
  (
    'attendance.corrections.reject',
    'attendance',
    'CRITICAL',
    'Reject a submitted Attendance Correction with a reason'
  ),
  (
    'attendance.corrections.authorize_locked',
    'attendance',
    'CRITICAL',
    'Authorize and apply one grouped Locked Attendance Adjustment for an approved correction inside scope'
  ),
  (
    'attendance.corrections.cancel',
    'attendance',
    'MEDIUM',
    'Cancel an Attendance Correction that is not yet decided or applied'
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.corrections.create',
  'attendance.corrections.submit',
  'attendance.corrections.return',
  'attendance.corrections.approve',
  'attendance.corrections.reject',
  'attendance.corrections.authorize_locked',
  'attendance.corrections.cancel'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.corrections.create',
  'attendance.corrections.submit',
  'attendance.corrections.cancel'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.corrections.return',
  'attendance.corrections.approve',
  'attendance.corrections.reject'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.corrections.create',
  'attendance.corrections.submit',
  'attendance.corrections.cancel'
)
WHERE r."code" = 'employee' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

-- Attendance Corrections use Approval as an app-service contract. An HR
-- Officer raises correction requests within scope, so the role receives only
-- the operational Approval create and route-read grants the contract requires.
INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'approvals.routes.read',
  'approvals.requests.create'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.attendance_corrections') IS NULL
    OR to_regclass('public.attendance_correction_evidence') IS NULL
    OR to_regclass('public.attendance_correction_effects') IS NULL
    OR to_regclass('public.locked_attendance_adjustments') IS NULL
    OR to_regclass('public.locked_attendance_adjustment_periods') IS NULL
    OR to_regclass('public.employee_attendance_submissions') IS NULL
    OR to_regclass('public.attendance_period_versions') IS NULL
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'attendance_corrections'::regclass), false)
    OR NOT COALESCE((SELECT relforcerowsecurity FROM pg_class WHERE oid = 'attendance_correction_effects'::regclass), false)
  THEN
    RAISE EXCEPTION 'Attendance Correction capability migration verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_corrections_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance Correction immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_correction_effects_mutation_trigger'
  ) THEN
    RAISE EXCEPTION 'Attendance Correction Effect immutability verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_corrections_requested_fact_check'
  ) THEN
    RAISE EXCEPTION 'Attendance Correction requested fact verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.corrections.approve'
  ) THEN
    RAISE EXCEPTION 'Attendance Correction approve permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.corrections.authorize_locked'
  ) THEN
    RAISE EXCEPTION 'Attendance Correction locked authorization permission verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator'
      AND p."code" = 'attendance.corrections.authorize_locked'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'HR Administrator locked correction authorization grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee'
      AND p."code" = 'attendance.corrections.create'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'Employee Attendance Correction create grant verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'personnel_records_officer'
      AND p."code" = 'approvals.requests.create'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'HR Officer operational Approval grant verification failed';
  END IF;
END;
$$;
