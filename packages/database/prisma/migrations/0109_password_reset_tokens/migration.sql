-- Password reset links (#367). Only the SHA-256 hash of each link's token is
-- stored. A row is never deleted while its User exists: a used, superseded, or
-- expired token still tells a failed reset why it failed. Like
-- pending_authentications, a row carries no agency_id and is visible through
-- the owning User's context or through the hash of its token.

CREATE TABLE "password_reset_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" BYTEA NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "superseded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "password_reset_tokens_period_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "password_reset_tokens_ended_once_check"
    CHECK ("consumed_at" IS NULL OR "superseded_at" IS NULL),
  CONSTRAINT "password_reset_tokens_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- One outstanding token per User; a new request supersedes the older one.
CREATE UNIQUE INDEX "password_reset_tokens_outstanding_user_uq"
  ON "password_reset_tokens" ("user_id")
  WHERE "consumed_at" IS NULL AND "superseded_at" IS NULL;

-- Default privileges give hris_app SELECT, INSERT, and UPDATE. A token only
-- ever ends, so only the ending columns are updated.
REVOKE UPDATE ON "password_reset_tokens" FROM hris_app;
GRANT UPDATE ("consumed_at", "superseded_at") ON "password_reset_tokens" TO hris_app;

ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "password_reset_tokens_owner" ON "password_reset_tokens"
  USING (
    "user_id" = app_user_id()
    OR encode("token_hash", 'hex') = current_setting('app.password_reset_token_hash', true)
  )
  WITH CHECK (
    "user_id" = app_user_id()
    OR encode("token_hash", 'hex') = current_setting('app.password_reset_token_hash', true)
  );

-- A password change from any route voids the User's outstanding reset link.
-- A change moves changed_at; rehashing the same password does not. Password
-- writes run in the User's context, which the policy above admits.
CREATE FUNCTION supersede_password_reset_tokens()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SET search_path = public
AS $$
BEGIN
  UPDATE "password_reset_tokens"
  SET "superseded_at" = now()
  WHERE "user_id" = NEW."user_id"
    AND "consumed_at" IS NULL
    AND "superseded_at" IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "user_passwords_supersede_reset_tokens_trigger"
  AFTER UPDATE OF "changed_at" ON "user_passwords"
  FOR EACH ROW
  WHEN (OLD."changed_at" IS DISTINCT FROM NEW."changed_at")
  EXECUTE FUNCTION supersede_password_reset_tokens();

-- Rollback/correction: drop the trigger, the function, and the table.
