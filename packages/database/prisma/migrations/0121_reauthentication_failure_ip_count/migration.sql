-- A failed proof inside a signed-in session records REAUTHENTICATION_FAILURE
-- with the session's Agency (#465). The per-IP sign-in limit must count those
-- too, but RLS shows platform security only the events without an Agency.
-- A function answers the count and nothing else; the table owner it runs as
-- gets the read of reauthentication failures, and the runtime role doesn't.

CREATE POLICY "security_events_owner_reauthentication_failure_select" ON "security_events"
  FOR SELECT TO CURRENT_USER
  USING (app_platform_security() AND "event_type" = 'REAUTHENTICATION_FAILURE');

CREATE OR REPLACE FUNCTION app_ip_failure_count(ip INET, since TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)
  FROM public."security_events"
  WHERE "ip_address" = ip
    AND "event_type" IN ('LOGIN_FAILURE', 'PASSWORD_RESET_FAILURE', 'REAUTHENTICATION_FAILURE')
    AND "occurred_at" >= since;
$$;

-- Rollback/correction: drop the function and the policy.
