-- The Sign-in Cool-down ladder (#364), one row per keyed email hash. It carries
-- state between failures and is updated under a row lock, so it isn't derived
-- from Security Events. Unknown and real emails get rows alike, so a row says
-- nothing about whether an account exists. A row whose last failure is more
-- than 24 hours old counts as reset; a full sign-in deletes it.
CREATE TABLE "sign_in_throttles" (
  "email_hash" BYTEA NOT NULL,
  "failure_count" INTEGER NOT NULL DEFAULT 0 CHECK ("failure_count" >= 0),
  "cooldown_level" INTEGER NOT NULL DEFAULT 0 CHECK ("cooldown_level" >= 0),
  "cooldown_until" TIMESTAMPTZ(6),
  "last_failure_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sign_in_throttles_pkey" PRIMARY KEY ("email_hash")
);

-- Default privileges give hris_app SELECT, INSERT, and UPDATE.
GRANT DELETE ON TABLE "sign_in_throttles" TO hris_app;

-- Sign-in runs before any User or Agency context exists, so only the
-- platform-security capability reaches these rows.
ALTER TABLE "sign_in_throttles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sign_in_throttles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "sign_in_throttles_platform_security" ON "sign_in_throttles"
  USING (app_platform_security())
  WITH CHECK (app_platform_security());

-- Rollback/correction: drop the table.
