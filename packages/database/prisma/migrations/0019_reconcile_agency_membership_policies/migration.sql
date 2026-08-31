ALTER TABLE "agency_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_memberships" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_memberships_isolation" ON "agency_memberships";
DROP POLICY IF EXISTS "agency_memberships_select" ON "agency_memberships";
DROP POLICY IF EXISTS "agency_memberships_insert" ON "agency_memberships";
DROP POLICY IF EXISTS "agency_memberships_update" ON "agency_memberships";
DROP POLICY IF EXISTS "agency_memberships_delete" ON "agency_memberships";

CREATE POLICY "agency_memberships_select" ON "agency_memberships"
  FOR SELECT
  USING ("agency_id" = app_agency_id() OR "user_id" = app_user_id());

CREATE POLICY "agency_memberships_insert" ON "agency_memberships"
  FOR INSERT
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "agency_memberships_update" ON "agency_memberships"
  FOR UPDATE
  USING ("agency_id" = app_agency_id())
  WITH CHECK ("agency_id" = app_agency_id());

CREATE POLICY "agency_memberships_delete" ON "agency_memberships"
  FOR DELETE
  USING ("agency_id" = app_agency_id());
