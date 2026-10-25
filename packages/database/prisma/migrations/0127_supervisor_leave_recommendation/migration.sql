-- hris-controls §6.8 gives the Supervisor `S` on `leave.applications.recommend`
-- and `leave.applications.return`, and WF-008 routes a Leave Application to
-- supervisor recommendation. Approval Routes now resolve a `SUBJECT_SUPERVISOR`
-- step to the applicant's Supervisor (ADR 0007), and the assigned Supervisor
-- decides on these DIRECT_REPORTS grants only while the applicant is their
-- direct report. Agency LEAVE routes keep their configured step until the
-- Agency adopts the new assignment kind.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p
  ON p."code" IN ('leave.applications.recommend', 'leave.applications.return')
WHERE r."code" = 'supervisor'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."code" = 'supervisor' AND r."agency_id" IS NULL
      AND p."code" IN ('leave.applications.recommend', 'leave.applications.return')
      AND rp."scope_policy" = 'DIRECT_REPORTS'
  ) <> 2 THEN
    RAISE EXCEPTION 'Supervisor Leave recommendation grant verification failed';
  END IF;
END;
$$;
