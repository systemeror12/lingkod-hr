-- Global User Lock (#364, #382). A Security Administrator locks a User in an
-- Agency where the User has an ACTIVE Agency Membership, and the lock records
-- that Agency. LOCKED is a User status only, and a User has no DEACTIVATED
-- status (#390).

ALTER TABLE "users"
  ADD COLUMN "locked_at" TIMESTAMPTZ(6),
  ADD COLUMN "locked_by_agency_id" UUID,
  ADD CONSTRAINT "users_locked_by_agency_fkey"
    FOREIGN KEY ("locked_by_agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT;

ALTER TABLE "users" DROP CONSTRAINT "users_global_status_check";
ALTER TABLE "users" ADD CONSTRAINT "users_global_status_check" CHECK (
  ("global_status" = 'ACTIVE' AND "locked_at" IS NULL AND "locked_by_agency_id" IS NULL)
  OR ("global_status" = 'LOCKED' AND "locked_at" IS NOT NULL AND "locked_by_agency_id" IS NOT NULL)
);

ALTER TABLE "agency_memberships" DROP CONSTRAINT "agency_memberships_status_check";
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_status_check"
  CHECK ("status" IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'));

DROP INDEX "agency_memberships_active_user_uq";
CREATE UNIQUE INDEX "agency_memberships_active_user_uq"
  ON "agency_memberships" ("agency_id", "user_id")
  WHERE "status" IN ('INVITED', 'ACTIVE', 'SUSPENDED');

-- Rollback/correction: restore the 0003 status checks and index, then drop the
-- foreign key and both columns once no User is LOCKED.
