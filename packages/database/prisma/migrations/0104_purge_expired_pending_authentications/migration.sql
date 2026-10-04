-- Expired pending sign-ins and activations are purged on each insert, so no
-- worker is needed. The runtime role sees only its own rows, so the purge runs
-- as the table owner, whose policies expose expired rows and nothing else.

CREATE POLICY "pending_authentications_expired_select" ON "pending_authentications"
  FOR SELECT TO CURRENT_USER
  USING ("expires_at" <= now());

CREATE POLICY "pending_authentications_expired_delete" ON "pending_authentications"
  FOR DELETE TO CURRENT_USER
  USING ("expires_at" <= now());

CREATE OR REPLACE FUNCTION purge_expired_pending_authentications()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM "pending_authentications" WHERE "expires_at" <= now();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_pending_authentications() FROM PUBLIC;

CREATE TRIGGER "pending_authentications_purge_expired_trigger"
  AFTER INSERT ON "pending_authentications"
  FOR EACH STATEMENT EXECUTE FUNCTION purge_expired_pending_authentications();

-- Rollback/correction: drop the trigger, the function, and both policies.
