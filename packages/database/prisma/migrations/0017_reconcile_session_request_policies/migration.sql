REVOKE UPDATE ON "user_sessions" FROM hris_app;
GRANT UPDATE ("last_seen_at", "revoked_at", "revocation_reason")
  ON "user_sessions" TO hris_app;

ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_sessions_isolation" ON "user_sessions";
DROP POLICY IF EXISTS "user_sessions_select" ON "user_sessions";
DROP POLICY IF EXISTS "user_sessions_insert" ON "user_sessions";
DROP POLICY IF EXISTS "user_sessions_update" ON "user_sessions";

CREATE POLICY "user_sessions_select" ON "user_sessions"
  FOR SELECT
  USING (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR "provider_sid" = current_setting('app.provider_sid', true)
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  );

CREATE POLICY "user_sessions_insert" ON "user_sessions"
  FOR INSERT
  WITH CHECK (
    "agency_id" = app_agency_id()
    AND "user_id" = app_user_id()
  );

CREATE POLICY "user_sessions_update" ON "user_sessions"
  FOR UPDATE
  USING (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR "provider_sid" = current_setting('app.provider_sid', true)
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  )
  WITH CHECK (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR "provider_sid" = current_setting('app.provider_sid', true)
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  );
