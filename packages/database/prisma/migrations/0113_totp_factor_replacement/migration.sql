-- A signed-in User replacing their TOTP factor (#380) holds the new secret on a
-- TOTP_REPLACEMENT pending row until they confirm it. The row belongs to the
-- User's session rather than to a cookie, so it has no token: it is found by
-- its User, in the User's context the owner policy already admits.

ALTER TABLE "pending_authentications" ALTER COLUMN "token_hash" DROP NOT NULL;

ALTER TABLE "pending_authentications" DROP CONSTRAINT "pending_authentications_purpose_check";
ALTER TABLE "pending_authentications" ADD CONSTRAINT "pending_authentications_purpose_check"
  CHECK ("purpose" IN ('SIGN_IN', 'ACTIVATION', 'TOTP_REPLACEMENT'));

ALTER TABLE "pending_authentications" DROP CONSTRAINT "pending_authentications_subject_check";
ALTER TABLE "pending_authentications" ADD CONSTRAINT "pending_authentications_subject_check" CHECK (
  ("purpose" = 'SIGN_IN' AND "user_id" IS NOT NULL AND "invitation_id" IS NULL)
  OR ("purpose" = 'ACTIVATION' AND "invitation_id" IS NOT NULL)
  OR ("purpose" = 'TOTP_REPLACEMENT' AND "user_id" IS NOT NULL AND "invitation_id" IS NULL)
);

-- Only a replacement goes without a token.
ALTER TABLE "pending_authentications" ADD CONSTRAINT "pending_authentications_token_check"
  CHECK (("token_hash" IS NULL) = ("purpose" = 'TOTP_REPLACEMENT'));

-- One replacement per User; starting again replaces it.
CREATE UNIQUE INDEX "pending_authentications_totp_replacement_user_uq"
  ON "pending_authentications" ("user_id")
  WHERE "purpose" = 'TOTP_REPLACEMENT';

-- Rollback/correction: delete TOTP_REPLACEMENT rows, drop the index and the
-- token check, restore the 0103 purpose and subject checks, and set
-- token_hash NOT NULL again.
