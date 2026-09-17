-- Contract alignment for Leave Types and Leave Policy Versions against the
-- accepted logical ERD and physical schema: require the Approval Route code,
-- admit SCHEDULED_TIME as a calendar basis, scope authority uniqueness by
-- citation so one instrument may supply several provisions, and grant the
-- Employee baseline role read access to the government leave catalogue. The
-- extra Agency-name uniqueness 0085 carried is removed because the contract
-- only makes the Leave Type code unique.
--
-- Correction / rollback: no table or column changes are involved. Roll back by
-- dropping the Employee read grant, restoring the 0085 calendar-basis and
-- authority constraints, and dropping the approval-route NOT NULL.

ALTER TABLE "leave_types" DROP CONSTRAINT "leave_types_agency_name_key";

ALTER TABLE "leave_policy_versions"
  DROP CONSTRAINT "leave_policy_versions_calendar_basis_check";
ALTER TABLE "leave_policy_versions"
  ADD CONSTRAINT "leave_policy_versions_calendar_basis_check"
  CHECK (
    "calendar_basis" IN ('WORKING_DAY', 'CALENDAR_DAY', 'SCHEDULED_TIME', 'SOURCE_DEFINED')
  );

ALTER TABLE "leave_policy_versions" DISABLE TRIGGER "leave_policy_versions_mutation_trigger";
ALTER TABLE "leave_policy_versions" DISABLE ROW LEVEL SECURITY;
UPDATE "leave_policy_versions"
  SET "approval_route_code" = 'UNROUTED'
  WHERE "approval_route_code" IS NULL;
ALTER TABLE "leave_policy_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policy_versions" ENABLE TRIGGER "leave_policy_versions_mutation_trigger";
ALTER TABLE "leave_policy_versions"
  ALTER COLUMN "approval_route_code" SET NOT NULL;

ALTER TABLE "leave_policy_authorities"
  DROP CONSTRAINT "leave_policy_authorities_version_document_key";
ALTER TABLE "leave_policy_authorities"
  ADD CONSTRAINT "leave_policy_authorities_version_document_citation_key"
  UNIQUE ("leave_policy_version_id", "document_version_id", "citation");

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" = 'leave.types.read'
WHERE r."code" = 'employee'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_types_agency_name_key'
  ) THEN
    RAISE EXCEPTION 'Leave Type name uniqueness rollback failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_policy_authorities_version_document_citation_key'
  ) THEN
    RAISE EXCEPTION 'Leave Policy authority citation uniqueness verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_policy_versions_calendar_basis_check'
      AND pg_get_constraintdef(oid) LIKE '%SCHEDULED_TIME%'
  ) THEN
    RAISE EXCEPTION 'Leave Policy calendar basis verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'leave_policy_versions'::regclass
      AND attname = 'approval_route_code'
      AND attnotnull
  ) THEN
    RAISE EXCEPTION 'Leave Policy approval route verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'employee' AND p."code" = 'leave.types.read'
  ) THEN
    RAISE EXCEPTION 'Employee Leave Type read grant verification failed';
  END IF;
END;
$$;
