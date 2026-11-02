-- Phase 8 certification of Overtime Service Records (#535). 0136 already allows
-- the FOR_CERTIFICATION to CERTIFIED or NOT_CERTIFIED moves and leaves terminal
-- records unchangeable; this adds who may make them and the shape they leave.

ALTER TABLE "overtime_service_records"
  ADD CONSTRAINT "overtime_service_records_decline_reason_check"
    CHECK ("decline_reason" IS NULL OR btrim("decline_reason") <> ''),
  ADD CONSTRAINT "overtime_service_records_certifier_check"
    CHECK (
      ("status" = 'CERTIFIED' AND "certified_by_membership_id" IS NOT NULL AND "certified_at" IS NOT NULL)
      OR ("status" <> 'CERTIFIED' AND "certified_by_membership_id" IS NULL AND "certified_at" IS NULL)
    );

-- hris-controls §6.9: Supervisor `S` on `overtime.service.certify` and `.reject`,
-- as a DIRECT_REPORTS grant (ADR 0007). The HR Administrator's and Approving
-- Official's `C` (agency-configurable) are not baseline grants.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.service.certify', 'overtime', 'HIGH', 'Certify the overtime hours an Employee rendered'),
  ('overtime.service.reject', 'overtime', 'MEDIUM', 'Decline certification of an Overtime Service Record')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'DIRECT_REPORTS'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.service.certify', 'overtime.service.reject')
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
    WHERE r."agency_id" IS NULL
      AND r."code" = 'supervisor'
      AND rp."scope_policy" = 'DIRECT_REPORTS'
      AND p."code" IN ('overtime.service.certify', 'overtime.service.reject')
  ) <> 2 THEN
    RAISE EXCEPTION 'Overtime service certification grant verification failed';
  END IF;
END;
$$;
