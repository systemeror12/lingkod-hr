-- Existing databases may still be owned by the previous migration role.
-- migrate:prepare runs this with DATABASE_MIGRATION_OWNER_URL before Prisma
-- connects as hris_migrator; it can also be run directly by that owner.
-- Rollback/correction: an authorized owner can reverse the handoff with
-- `ALTER TABLE ... OWNER TO ...`; this script does not guess the old owner.
-- Verification: SELECT relname, pg_get_userbyid(relowner) FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p');
-- Performance: catalog lookups and ACL changes only; no row scans or rewrites.
DO $$
DECLARE
  table_record RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hris_migrator') THEN
    RAISE EXCEPTION 'hris_migrator must be provisioned before migrating an existing database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hris_app') THEN
    RAISE EXCEPTION 'hris_app must be provisioned before migrating an existing database';
  END IF;

  EXECUTE format('GRANT hris_migrator TO %I', current_user);
  FOR table_record IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND pg_get_userbyid(c.relowner) IS DISTINCT FROM 'hris_migrator'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I OWNER TO %I',
      table_record.schema_name,
      table_record.table_name,
      'hris_migrator'
    );
  END LOOP;

  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public._prisma_migrations TO hris_migrator';
  END IF;

  IF to_regclass('public.agencies') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.agencies TO hris_app';
  END IF;
END
$$;
