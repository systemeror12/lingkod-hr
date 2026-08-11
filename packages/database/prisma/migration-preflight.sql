-- Existing databases may still be owned by the previous migration role.
-- migrate:prepare runs this with DATABASE_MIGRATION_OWNER_URL before Prisma
-- connects as hris_migrator; it can also be run directly by that owner.
-- Rollback/correction: an authorized owner can reverse the handoff with
-- `ALTER TABLE ... OWNER TO ...`; this script does not guess the old owner.
-- Verification: SELECT relname, pg_get_userbyid(relowner) FROM pg_class
-- WHERE oid IN ('public.agencies'::regclass, 'public._prisma_migrations'::regclass);
-- Performance: catalog lookups and ACL changes only; no row scans or rewrites.
DO $$
DECLARE
  agency_owner TEXT;
  migration_owner TEXT;
BEGIN
  IF to_regclass('public.agencies') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hris_migrator') THEN
    RAISE EXCEPTION 'hris_migrator must be provisioned before migrating an existing database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hris_app') THEN
    RAISE EXCEPTION 'hris_app must be provisioned before migrating an existing database';
  END IF;

  SELECT pg_get_userbyid(relowner)
  INTO agency_owner
  FROM pg_class
  WHERE oid = 'public.agencies'::regclass;

  IF agency_owner <> 'hris_migrator' THEN
    EXECUTE format('GRANT hris_migrator TO %I', current_user);
    EXECUTE 'ALTER TABLE public.agencies OWNER TO hris_migrator';
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.agencies TO hris_app';

  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    SELECT pg_get_userbyid(relowner)
    INTO migration_owner
    FROM pg_class
    WHERE oid = 'public._prisma_migrations'::regclass;
    IF migration_owner <> 'hris_migrator' THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public._prisma_migrations TO hris_migrator';
    END IF;
  END IF;
END
$$;
