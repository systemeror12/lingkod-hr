-- coc_expiries_due reads through this owner policy and its caller names the
-- date, so USING (true) let hris_app list every Agency's accounts with COC left
-- by naming a far-future date. Like 0104's owner policies, this exposes only
-- the rows the function needs: those whose Valid Until has passed by the Manila
-- date, whatever the session time zone.
ALTER POLICY "coc_ledger_entries_expiry_due_select" ON "coc_ledger_entries"
  USING ("valid_until" < (now() AT TIME ZONE 'Asia/Manila')::date);

-- Rollback/correction: ALTER POLICY ... USING (true) restores 0139's exposure.
