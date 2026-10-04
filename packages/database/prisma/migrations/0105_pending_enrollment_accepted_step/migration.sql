-- The TOTP step that confirmed a pending enrollment. The enrolled factor starts
-- with it as last_accepted_step, so the confirming code can't be replayed at
-- the next sign-in.
ALTER TABLE "pending_authentications" ADD COLUMN "enrollment_accepted_step" BIGINT;

-- Rollback/correction: drop the column.
