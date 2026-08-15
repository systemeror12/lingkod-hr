CREATE OR REPLACE FUNCTION app_operational_provisioning()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT current_setting('app.operational_provisioning', true) = 'true'
$$;

ALTER TABLE "invitations"
  ALTER COLUMN "invited_by_membership_id" DROP NOT NULL;

ALTER TABLE "membership_roles"
  ALTER COLUMN "assigned_by_membership_id" DROP NOT NULL;

DROP POLICY "agencies_isolation" ON "agencies";

CREATE POLICY "agencies_runtime_select" ON "agencies"
  FOR SELECT
  USING (
    "id" = app_agency_id()
    OR (current_user = 'hris_operator' AND app_operational_provisioning())
  );

CREATE POLICY "agencies_runtime_update" ON "agencies"
  FOR UPDATE
  USING ("id" = app_agency_id())
  WITH CHECK ("id" = app_agency_id());

CREATE POLICY "agencies_operational_insert" ON "agencies"
  FOR INSERT
  WITH CHECK (
    current_user = 'hris_operator'
    AND app_operational_provisioning()
  );

GRANT SELECT, INSERT ON "agencies" TO hris_operator;
GRANT SELECT, INSERT, UPDATE ON "invitations" TO hris_operator;
GRANT SELECT ON "users" TO hris_operator;
GRANT SELECT ON "agency_memberships" TO hris_operator;
GRANT SELECT ON "roles" TO hris_operator;
GRANT SELECT, INSERT ON "security_events" TO hris_operator;
GRANT SELECT, INSERT ON "audit_events" TO hris_operator;

-- Rollback/correction: restore the previous isolation policy and revoke the
-- operator grants only through a reviewed forward migration; dropping this
-- boundary after dependent deployments would reopen Agency provisioning risk.
-- Verification: SELECT policyname FROM pg_policies WHERE tablename = 'agencies';
-- Performance: the policy adds a current-user/GUC branch to Agency INSERT
-- checks and leaves ordinary Agency-scoped query predicates indexed by the PK.
