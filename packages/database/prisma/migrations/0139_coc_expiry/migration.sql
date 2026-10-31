-- Phase 8 COC expiry (#322, ADR 0009, hris-controls §5.18). One negative COC
-- Ledger Entry per COC Account and Valid Until, effective the day after it,
-- posted by System with no membership. The source is the account and the
-- posting key is the Valid Until, so a repeated or late run posts the same entry.
--
-- The command lives here so the worker and the API share one definition: the
-- worker cannot import the API's COC module. It runs as the caller, so forced
-- RLS still confines it to the Agency in context.

CREATE OR REPLACE FUNCTION post_coc_expiry(
  p_agency_id UUID,
  p_coc_account_id UUID,
  p_valid_until DATE,
  p_as_of DATE
)
RETURNS UUID
LANGUAGE PLPGSQL
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC(12,1);
  v_entry_id UUID;
  v_rule_code CONSTANT TEXT := 'JC2A_2005_COC_VALIDITY';
BEGIN
  PERFORM 1 FROM "coc_accounts"
  WHERE "agency_id" = p_agency_id AND "id" = p_coc_account_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The COC Account does not belong to the Agency in context'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_valid_until >= p_as_of THEN
    RETURN NULL;
  END IF;

  -- Read under the lock. Counts every entry for the Valid Until, whatever its
  -- effective date, so an earlier run's expiry leaves nothing to expire.
  SELECT COALESCE(SUM("minutes"), 0) INTO v_remaining
  FROM "coc_ledger_entries"
  WHERE "agency_id" = p_agency_id
    AND "coc_account_id" = p_coc_account_id
    AND "valid_until" = p_valid_until;
  IF v_remaining <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO "coc_ledger_entries" (
    "agency_id", "coc_account_id", "minutes", "effective_date", "valid_until",
    "source_type", "source_id", "source_posting_key", "rule_code"
  )
  VALUES (
    p_agency_id, p_coc_account_id, -v_remaining, p_valid_until + 1, p_valid_until,
    'COC_EXPIRY', p_coc_account_id, to_char(p_valid_until, 'YYYY-MM-DD'), v_rule_code
  )
  ON CONFLICT ON CONSTRAINT "coc_ledger_entries_source_key" DO NOTHING
  RETURNING "id" INTO v_entry_id;
  IF v_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO "audit_events" (
    "agency_id", "actor_type", "action", "entity_type", "entity_id", "metadata"
  )
  VALUES (
    p_agency_id, 'SYSTEM', 'COC_EXPIRED', 'CocLedgerEntry', v_entry_id,
    jsonb_build_object(
      'cocAccountId', p_coc_account_id,
      'validUntil', to_char(p_valid_until, 'YYYY-MM-DD'),
      'minutes', -v_remaining,
      'ruleCode', v_rule_code
    )
  );
  RETURN v_entry_id;
END;
$$;

-- coc_expiries_due returns other Agencies' rows to hris_app, whatever the
-- caller's Agency Context, a deliberate exception to Agency isolation. It is
-- SECURITY DEFINER, reading through the owner's policy below, so the worker
-- can find due expiries in every Agency. It returns only identifiers and
-- dates, no HTTP input reaches it, and each posting runs under its own
-- Agency's context.
CREATE POLICY "coc_ledger_entries_expiry_due_select" ON "coc_ledger_entries"
  FOR SELECT TO CURRENT_USER
  USING (true);

CREATE OR REPLACE FUNCTION coc_expiries_due(p_as_of DATE)
RETURNS TABLE ("agency_id" UUID, "coc_account_id" UUID, "valid_until" DATE)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e."agency_id", e."coc_account_id", e."valid_until"
  FROM "coc_ledger_entries" e
  WHERE e."valid_until" < p_as_of
  GROUP BY e."agency_id", e."coc_account_id", e."valid_until"
  HAVING SUM(e."minutes") > 0
$$;

REVOKE ALL ON FUNCTION coc_expiries_due(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION coc_expiries_due(DATE) TO hris_app;
REVOKE ALL ON FUNCTION post_coc_expiry(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_coc_expiry(UUID, UUID, DATE, DATE) TO hris_app;

-- Rollback/correction: drop both functions and the policy. Posted entries stay.
