-- A Password Reset proved with a Recovery Code owes the remaining-codes prompt
-- at the User's next sign-in (#367, #466). The reset that spends the code sets
-- it; the sign-in that opens the next session clears it. The column belongs to
-- the User's password row, so the user_passwords owner policy covers it.

ALTER TABLE "user_passwords" ADD COLUMN "recovery_code_prompt_owed_at" TIMESTAMPTZ(6);

-- Rollback/correction: drop the column.
