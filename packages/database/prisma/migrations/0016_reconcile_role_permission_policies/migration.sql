ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_isolation" ON "role_permissions";
DROP POLICY IF EXISTS "role_permissions_select" ON "role_permissions";
DROP POLICY IF EXISTS "role_permissions_insert" ON "role_permissions";
DROP POLICY IF EXISTS "role_permissions_update" ON "role_permissions";
DROP POLICY IF EXISTS "role_permissions_delete" ON "role_permissions";

CREATE POLICY "role_permissions_select" ON "role_permissions"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND ("roles"."agency_id" IS NULL OR "roles"."agency_id" = app_agency_id())
    )
  );

CREATE POLICY "role_permissions_insert" ON "role_permissions"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  );

CREATE POLICY "role_permissions_update" ON "role_permissions"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  );

CREATE POLICY "role_permissions_delete" ON "role_permissions"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM "roles"
      WHERE "roles"."id" = "role_permissions"."role_id"
        AND "roles"."agency_id" = app_agency_id()
    )
  );
