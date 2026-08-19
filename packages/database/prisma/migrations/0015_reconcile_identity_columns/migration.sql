ALTER TABLE "audit_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" DISABLE TRIGGER USER;

ALTER TABLE "audit_events"
  ADD COLUMN IF NOT EXISTS "actor_type" TEXT;

UPDATE "audit_events"
SET "actor_type" = CASE
  WHEN "actor_user_id" IS NOT NULL OR "actor_membership_id" IS NOT NULL THEN 'USER'
  ELSE 'SYSTEM'
END
WHERE "actor_type" IS NULL;

ALTER TABLE "audit_events"
  ALTER COLUMN "actor_type" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'audit_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%actor_type%'
  ) THEN
    ALTER TABLE "audit_events"
      ADD CONSTRAINT "audit_events_actor_type_check"
      CHECK ("actor_type" IN ('USER', 'SYSTEM', 'INTEGRATION'));
  END IF;
END;
$$;

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE TRIGGER USER;

ALTER TABLE "user_sessions"
  ADD COLUMN IF NOT EXISTS "authentication_methods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
