ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_isolation" ON "roles";
DROP POLICY IF EXISTS "roles_select" ON "roles";
DROP POLICY IF EXISTS "roles_insert" ON "roles";
DROP POLICY IF EXISTS "roles_update" ON "roles";
DROP POLICY IF EXISTS "roles_delete" ON "roles";

CREATE POLICY "roles_select" ON "roles"
  FOR SELECT
  USING ("agency_id" IS NULL OR "agency_id" = app_agency_id());

CREATE POLICY "roles_insert" ON "roles"
  FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "roles_update" ON "roles"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "roles_delete" ON "roles"
  FOR DELETE
  USING ("agency_id" = app_agency_id());
