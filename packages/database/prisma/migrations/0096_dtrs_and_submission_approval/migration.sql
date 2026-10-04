-- Phase 7 Daily Time Records. A locked Attendance Period Version retains one
-- immutable Finalized Daily Time Record per covered Employee. The record owns
-- the exact day/source manifest of the Printable System View; unfinalized
-- previews are derived and never stored here.
--
-- Submitting an Employee Attendance Submission is the only workflow that marks
-- its exact bound Attendance Day versions APPROVED, so the Attendance Day
-- guard admits that one status change while every calculation fact stays
-- immutable.

CREATE TABLE "dtr_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "attendance_period_version_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "predecessor_dtr_document_id" UUID,
  "classification" TEXT NOT NULL,
  "output_type" TEXT NOT NULL,
  "document_version_id" UUID NOT NULL,
  "authoritative_template_reference" JSONB,
  "source_manifest" JSONB NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "dtr_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dtr_documents_classification_check" CHECK (
    "classification" IN ('ORIGINAL', 'CORRECTED')
  ),
  CONSTRAINT "dtr_documents_output_type_check" CHECK (
    "output_type" IN ('PRINTABLE_SYSTEM_VIEW', 'EXACT_VERSIONED_FORM')
  ),
  CONSTRAINT "dtr_documents_template_check" CHECK (
    "output_type" <> 'EXACT_VERSIONED_FORM'
    OR "authoritative_template_reference" IS NOT NULL
  ),
  CONSTRAINT "dtr_documents_predecessor_check" CHECK (
    ("classification" = 'ORIGINAL' AND "predecessor_dtr_document_id" IS NULL)
    OR ("classification" = 'CORRECTED' AND "predecessor_dtr_document_id" IS NOT NULL)
  ),
  CONSTRAINT "dtr_documents_agency_fkey" FOREIGN KEY ("agency_id")
    REFERENCES "agencies"("id") ON DELETE RESTRICT,
  CONSTRAINT "dtr_documents_version_fkey" FOREIGN KEY ("agency_id", "attendance_period_version_id")
    REFERENCES "attendance_period_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "dtr_documents_employee_fkey" FOREIGN KEY ("agency_id", "employee_id")
    REFERENCES "employees"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "dtr_documents_predecessor_fkey" FOREIGN KEY ("agency_id", "predecessor_dtr_document_id")
    REFERENCES "dtr_documents"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "dtr_documents_document_version_fkey" FOREIGN KEY ("agency_id", "document_version_id")
    REFERENCES "document_versions"("agency_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "dtr_documents_attendance_period_version_id_employee_id_key"
    UNIQUE ("attendance_period_version_id", "employee_id"),
  CONSTRAINT "dtr_documents_agency_id_key" UNIQUE ("agency_id", "id")
);

CREATE INDEX "dtr_documents_employee_idx"
  ON "dtr_documents" ("agency_id", "employee_id");
CREATE INDEX "dtr_documents_version_idx"
  ON "dtr_documents" ("agency_id", "attendance_period_version_id");

CREATE OR REPLACE FUNCTION guard_dtr_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Finalized Daily Time Records are retained and immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "dtr_documents_mutation_trigger"
  BEFORE UPDATE OR DELETE ON "dtr_documents"
  FOR EACH ROW EXECUTE FUNCTION guard_dtr_document_mutation();

-- Approval marks only the exact submitted Attendance Day versions APPROVED.
-- Recalculation still creates a successor version instead of editing facts.
CREATE OR REPLACE FUNCTION guard_attendance_day_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance Day versions are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - 'is_current') = (to_jsonb(OLD) - 'is_current') THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('CALCULATED', 'EXCEPTION')
     AND NEW."status" = 'APPROVED'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Attendance Day versions are immutable'
    USING ERRCODE = '55000';
END;
$$;

GRANT SELECT, INSERT ON TABLE "dtr_documents" TO hris_app;

ALTER TABLE "dtr_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dtr_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY "dtr_documents_select" ON "dtr_documents"
  FOR SELECT USING ("agency_id" = app_agency_id());
CREATE POLICY "dtr_documents_insert" ON "dtr_documents"
  FOR INSERT WITH CHECK ("agency_id" = app_agency_id());

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  (
    'attendance.submissions.create',
    'attendance',
    'MEDIUM',
    'Create an Employee Attendance Submission binding the exact current Attendance Day versions of one Attendance Period'
  ),
  (
    'attendance.submissions.create_on_behalf',
    'attendance',
    'HIGH',
    'Create an Employee Attendance Submission on behalf of an Employee with a reason and immutable evidence'
  ),
  (
    'attendance.submissions.submit',
    'attendance',
    'HIGH',
    'Submit an exact Attendance Day version set for HR review'
  ),
  (
    'attendance.submissions.return',
    'attendance',
    'HIGH',
    'Return a submitted Employee Attendance Submission with a reason'
  ),
  (
    'attendance.submissions.approve',
    'attendance',
    'CRITICAL',
    'Approve an Employee Attendance Submission and mark its exact bound Attendance Day versions APPROVED'
  ),
  (
    'attendance.submissions.cancel',
    'attendance',
    'MEDIUM',
    'Cancel an Employee Attendance Submission that is not yet approved'
  ),
  (
    'attendance.reports.read',
    'attendance',
    'MEDIUM',
    'Read and print finalized Daily Time Records and attendance report output within scope'
  ),
  (
    'attendance.dtr.generate',
    'attendance',
    'HIGH',
    'Materialize the retained Finalized Daily Time Records of a locked Attendance Period Version'
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.submissions.submit',
  'attendance.submissions.create_on_behalf',
  'attendance.submissions.return',
  'attendance.submissions.approve',
  'attendance.submissions.cancel',
  'attendance.reports.read',
  'attendance.dtr.generate'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.submissions.create',
  'attendance.submissions.submit',
  'attendance.submissions.cancel'
)
WHERE r."code" = 'hrmo_administrator' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'ASSIGNED_OFFICE'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.submissions.return',
  'attendance.submissions.approve',
  'attendance.reports.read'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.submissions.create',
  'attendance.submissions.submit',
  'attendance.submissions.cancel'
)
WHERE r."code" = 'personnel_records_officer' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'OWN'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'attendance.submissions.create',
  'attendance.submissions.submit',
  'attendance.submissions.cancel',
  'attendance.reports.read'
)
WHERE r."code" = 'employee' AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('attendance.reports.read')
WHERE r."code" IN ('payroll_preparer', 'internal_auditor') AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.submissions.approve'
  ) OR NOT EXISTS (
    SELECT 1 FROM "permissions" WHERE "code" = 'attendance.reports.read'
  ) THEN
    RAISE EXCEPTION 'Attendance submission permissions were not seeded';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'hrmo_administrator'
      AND r."agency_id" IS NULL
      AND p."code" = 'attendance.dtr.generate'
      AND rp."scope_policy" = 'AGENCY'
  ) THEN
    RAISE EXCEPTION 'The HR Administrator Finalized DTR grant is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee'
      AND r."agency_id" IS NULL
      AND p."code" = 'attendance.reports.read'
      AND rp."scope_policy" = 'OWN'
  ) THEN
    RAISE EXCEPTION 'The Employee own Finalized DTR grant is missing';
  END IF;
END;
$$;
