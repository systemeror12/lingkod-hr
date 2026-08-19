-- Correction plan: this nullable key is additive. If the index cannot be created, resolve duplicate
-- non-null activation keys and retry. A later forward migration may drop the key only after callers
-- stop sending it; existing audit rows remain intact.

ALTER TABLE "audit_events"
  ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "audit_events_agency_id_action_entity_id_idempotency_key_key"
  ON "audit_events" ("agency_id", "action", "entity_id", "idempotency_key");
