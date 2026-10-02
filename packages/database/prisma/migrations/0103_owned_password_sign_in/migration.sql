-- LingkodHR-owned sign-in (ADR 0004): passwords, TOTP factors, Recovery Codes,
-- and pending sign-in or activation state. These rows belong to the User, not
-- to an Agency, so they carry no agency_id. Like user_sessions, they are
-- visible through the owning User's context, and pending state is also
-- visible through the hash of its cookie token before a session exists.

-- Owned Users have no provider identity. The columns are dropped when OIDC is
-- removed.
ALTER TABLE "users"
  ALTER COLUMN "identity_provider" DROP NOT NULL,
  ALTER COLUMN "external_subject" DROP NOT NULL;

CREATE TABLE "user_passwords" (
  "user_id" UUID NOT NULL,
  "password_hash" TEXT NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "second_factor_failures" INTEGER NOT NULL DEFAULT 0 CHECK ("second_factor_failures" >= 0),
  "reset_required_at" TIMESTAMPTZ(6),
  CONSTRAINT "user_passwords_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_passwords_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- Replacing a factor deletes the row and inserts a new one, so only the
-- replay guard is ever updated.
CREATE TABLE "user_totp_factors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "secret_envelope" BYTEA NOT NULL,
  "last_accepted_step" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_totp_factors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_totp_factors_user_key" UNIQUE ("user_id"),
  CONSTRAINT "user_totp_factors_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "user_recovery_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_recovery_codes_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "user_recovery_codes_user_idx" ON "user_recovery_codes" ("user_id");

-- One row per User for sign-in and per invitation for activation; starting
-- over replaces it, and the final step deletes it in the same transaction
-- that writes the session.
CREATE TABLE "pending_authentications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" BYTEA NOT NULL,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('SIGN_IN', 'ACTIVATION')),
  "user_id" UUID,
  "invitation_id" UUID,
  "requested_membership_id" UUID,
  "stage" TEXT NOT NULL,
  "verified_methods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "display_name" TEXT,
  "password_hash" TEXT,
  "enrollment_secret_envelope" BYTEA,
  "recovery_code_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pending_authentications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pending_authentications_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "pending_authentications_period_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "pending_authentications_subject_check" CHECK (
    ("purpose" = 'SIGN_IN' AND "user_id" IS NOT NULL AND "invitation_id" IS NULL)
    OR ("purpose" = 'ACTIVATION' AND "invitation_id" IS NOT NULL)
  ),
  CONSTRAINT "pending_authentications_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "pending_authentications_invitation_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "pending_authentications_sign_in_user_uq"
  ON "pending_authentications" ("user_id")
  WHERE "purpose" = 'SIGN_IN';

CREATE UNIQUE INDEX "pending_authentications_activation_invitation_uq"
  ON "pending_authentications" ("invitation_id")
  WHERE "purpose" = 'ACTIVATION';

-- The keyed email hash lets sign-in limits count attempts by email without
-- storing the raw email.
ALTER TABLE "security_events" ADD COLUMN "email_hash" BYTEA;

CREATE INDEX "security_events_email_type_time_idx"
  ON "security_events" ("email_hash", "event_type", "occurred_at");

CREATE INDEX "security_events_ip_type_time_idx"
  ON "security_events" ("ip_address", "event_type", "occurred_at");

-- Default privileges give hris_app SELECT, INSERT, and UPDATE. Factors and
-- codes are replaced by deleting rows; only the replay guard is updated.
GRANT DELETE ON TABLE "user_totp_factors", "user_recovery_codes", "pending_authentications"
  TO hris_app;
REVOKE UPDATE ON "user_totp_factors", "user_recovery_codes" FROM hris_app;
GRANT UPDATE ("last_accepted_step") ON "user_totp_factors" TO hris_app;

ALTER TABLE "user_passwords" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_passwords" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_totp_factors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_totp_factors" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_recovery_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_recovery_codes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pending_authentications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_authentications" FORCE ROW LEVEL SECURITY;

CREATE POLICY "user_passwords_owner" ON "user_passwords"
  USING ("user_id" = app_user_id())
  WITH CHECK ("user_id" = app_user_id());

CREATE POLICY "user_totp_factors_owner" ON "user_totp_factors"
  USING ("user_id" = app_user_id())
  WITH CHECK ("user_id" = app_user_id());

CREATE POLICY "user_recovery_codes_owner" ON "user_recovery_codes"
  USING ("user_id" = app_user_id())
  WITH CHECK ("user_id" = app_user_id());

CREATE POLICY "pending_authentications_owner" ON "pending_authentications"
  USING (
    "user_id" = app_user_id()
    OR encode("token_hash", 'hex') = current_setting('app.pending_token_hash', true)
  )
  WITH CHECK (
    "user_id" = app_user_id()
    OR encode("token_hash", 'hex') = current_setting('app.pending_token_hash', true)
  );

-- Rollback/correction: drop the four tables, the security_events column and
-- its indexes, and restore NOT NULL on the provider columns once no owned
-- User exists.
