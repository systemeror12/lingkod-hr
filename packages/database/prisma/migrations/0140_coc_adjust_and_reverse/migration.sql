-- Phase 8 COC adjustment and reversal (#540, ADR 0008, ADR 0009, hris-controls
-- §5.18). An adjustment is a negative entry; a reversal exactly negates one
-- negative entry. Both need a reason and an exact supporting Document Version.

ALTER TABLE "coc_ledger_entries"
  ADD CONSTRAINT "coc_ledger_entries_correction_check"
  CHECK (
    "source_type" NOT IN ('COC_ADJUSTMENT', 'COC_REVERSAL')
    OR (
      "reason" IS NOT NULL
      AND btrim("reason") <> ''
      AND "supporting_document_version_id" IS NOT NULL
      AND "posted_by_membership_id" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "coc_ledger_entries_adjustment_negative_check"
  CHECK ("source_type" <> 'COC_ADJUSTMENT' OR "minutes" < 0);

-- A reversal can restore COC after its expiry posted, so one account and Valid
-- Until can need several expiries. The first keeps the plain Valid Until as its
-- posting key, and each later one adds its ordinal: `2025-12-31`, `2025-12-31#2`.
-- Entries are never deleted, so the ordinal never repeats. A retry or concurrent
-- run still posts once: the account lock serializes them, the second finds
-- nothing remaining, and the unique key backs that up.
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
  v_prior_expiries BIGINT;
  v_posting_key TEXT := to_char(p_valid_until, 'YYYY-MM-DD');
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

  SELECT COUNT(*) INTO v_prior_expiries
  FROM "coc_ledger_entries"
  WHERE "agency_id" = p_agency_id
    AND "coc_account_id" = p_coc_account_id
    AND "source_type" = 'COC_EXPIRY'
    AND "source_id" = p_coc_account_id
    AND "valid_until" = p_valid_until;
  IF v_prior_expiries > 0 THEN
    v_posting_key := v_posting_key || '#' || (v_prior_expiries + 1);
  END IF;

  INSERT INTO "coc_ledger_entries" (
    "agency_id", "coc_account_id", "minutes", "effective_date", "valid_until",
    "source_type", "source_id", "source_posting_key", "rule_code"
  )
  VALUES (
    p_agency_id, p_coc_account_id, -v_remaining, p_valid_until + 1, p_valid_until,
    'COC_EXPIRY', p_coc_account_id, v_posting_key, v_rule_code
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

-- As for the overtime permissions, the HR Administrator's baseline grant goes to
-- both administrator roles. No Leave Administrator role is seeded yet.
ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('overtime.coc.adjust', 'overtime', 'HIGH', 'Post a negative COC adjustment with a reason and supporting Document Version'),
  ('overtime.coc.reverse', 'overtime', 'HIGH', 'Reverse a negative COC Ledger Entry with a reason and supporting Document Version')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('overtime.coc.adjust', 'overtime.coc.reverse')
WHERE r."code" IN ('agency_administrator', 'hrmo_administrator')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "role_permissions" rp
    JOIN "roles" r ON r."id" = rp."role_id"
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE r."agency_id" IS NULL
      AND r."code" IN ('agency_administrator', 'hrmo_administrator')
      AND p."code" IN ('overtime.coc.adjust', 'overtime.coc.reverse')
      AND rp."scope_policy" = 'AGENCY'
  ) <> 4 THEN
    RAISE EXCEPTION 'COC correction grant verification failed';
  END IF;
END;
$$;
