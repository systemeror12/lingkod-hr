-- When the code that confirmed a pending enrollment was accepted. The session
-- opened at acknowledgment takes it as its auth_time, since that code is the
-- latest factor verification (#365), however long the User takes to save the
-- Recovery Codes. The table's row policies cover the new column as they are.
ALTER TABLE "pending_authentications" ADD COLUMN "enrollment_confirmed_at" TIMESTAMPTZ(6);

-- Rollback/correction: drop the column.
