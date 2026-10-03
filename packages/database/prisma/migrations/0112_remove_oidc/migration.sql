-- LingkodHR owns login (ADR 0004), so the OIDC provider identity goes away:
-- the external identity links, the provider identity on users, and the
-- provider session id that back-channel logout matched sessions by.

DROP TABLE "external_identity_links";

ALTER TABLE "users"
  DROP CONSTRAINT "users_identity_key",
  DROP COLUMN "identity_provider",
  DROP COLUMN "external_subject";

-- Recreate the session policies without the app.provider_sid clause before
-- dropping the column it reads.
DROP POLICY "user_sessions_select" ON "user_sessions";
DROP POLICY "user_sessions_update" ON "user_sessions";

CREATE POLICY "user_sessions_select" ON "user_sessions"
  FOR SELECT
  USING (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  );

CREATE POLICY "user_sessions_update" ON "user_sessions"
  FOR UPDATE
  USING (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  )
  WITH CHECK (
    "agency_id" = app_agency_id()
    OR "user_id" = app_user_id()
    OR encode("session_token_hash", 'hex') = current_setting('app.session_token_hash', true)
  );

ALTER TABLE "user_sessions" DROP COLUMN "provider_sid";
