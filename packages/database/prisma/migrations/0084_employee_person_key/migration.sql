-- An Employee's person_key is the stable person identity named by the Assumed
-- Appointment Contract that activated service. Reuse of a person_key is allowed
-- only through that identity contract, and movements verify it against the
-- Employee before effectuation. Legacy Employees are bound from their earliest
-- Appointment-backed Service Segment; ambiguous legacy bindings stay unbound so
-- that identity checks fail closed until the contract proves them.
--
-- Rollback/correction: drop "employees_agency_id_person_key_key" and the
-- "person_key" column. The column is new and no runtime path depends on unset
-- bindings.

ALTER TABLE "employees" ADD COLUMN "person_key" UUID;

-- Migrations run as hris_migrator, which owns these tables under FORCE ROW
-- LEVEL SECURITY. The backfill reads Appointments and Service Segments and
-- writes Employees, so the owner must bypass row security on all three. The
-- migration transaction holds ACCESS EXCLUSIVE locks until it commits, so no
-- session observes the unforced window.
ALTER TABLE "employees" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_segments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointments" NO FORCE ROW LEVEL SECURITY;

WITH activation AS (
  SELECT DISTINCT ON (segment."agency_id", segment."employee_id")
    segment."agency_id",
    segment."employee_id",
    appointment."appointee_person_key" AS "person_key"
  FROM "service_segments" segment
  JOIN "appointments" appointment
    ON appointment."agency_id" = segment."agency_id"
   AND appointment."id" = segment."appointment_id"
  WHERE segment."appointment_id" IS NOT NULL
    AND segment."segment_type" = 'PRIMARY'
  ORDER BY
    segment."agency_id",
    segment."employee_id",
    segment."effective_from" ASC,
    segment."created_at" ASC
),
unambiguous AS (
  SELECT "agency_id", "person_key"
  FROM activation
  GROUP BY "agency_id", "person_key"
  HAVING count(DISTINCT "employee_id") = 1
)
UPDATE "employees" employee
SET "person_key" = activation."person_key"
FROM activation
JOIN unambiguous
  ON unambiguous."agency_id" = activation."agency_id"
 AND unambiguous."person_key" = activation."person_key"
WHERE employee."agency_id" = activation."agency_id"
  AND employee."id" = activation."employee_id"
  AND employee."person_key" IS NULL;

ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_segments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "employees_agency_id_person_key_key"
  ON "employees" ("agency_id", "person_key");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'person_key'
  ) THEN
    RAISE EXCEPTION 'Employee person key verification failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname IN ('employees', 'service_segments', 'appointments')
      AND NOT relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Employee person key row security verification failed';
  END IF;
END;
$$;
