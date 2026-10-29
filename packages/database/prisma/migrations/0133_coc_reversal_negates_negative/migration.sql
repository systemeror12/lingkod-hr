-- A COC reversal may only negate a negative entry (overtime-coc-cto-schema.md
-- §4, hris-controls §5.18). New credit comes only from a Certificate of COC
-- Earned, so reversing a positive entry, such as a certificate's, is refused;
-- its COC is corrected by an adjustment instead.

CREATE OR REPLACE FUNCTION guard_coc_ledger_entry_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  original "coc_ledger_entries"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'COC Ledger Entries are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COC Ledger Entries are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."reverses_entry_id" IS NOT NULL THEN
    SELECT * INTO original
    FROM "coc_ledger_entries"
    WHERE "agency_id" = NEW."agency_id" AND "id" = NEW."reverses_entry_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A reversal must reference an existing COC Ledger Entry'
        USING ERRCODE = '55000';
    END IF;
    IF original."minutes" > 0 THEN
      RAISE EXCEPTION 'A reversal may only negate a negative COC Ledger Entry'
        USING ERRCODE = '55000';
    END IF;
    IF original."coc_account_id" <> NEW."coc_account_id"
      OR original."valid_until" <> NEW."valid_until" THEN
      RAISE EXCEPTION 'A reversal must use the same COC Account and Valid Until as its original'
        USING ERRCODE = '55000';
    END IF;
    IF original."minutes" <> -NEW."minutes" THEN
      RAISE EXCEPTION 'A reversal must exactly negate its original entry'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
