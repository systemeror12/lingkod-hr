-- The member list needs only whether each member has a factor (#381). The
-- policy from 0114 let any Agency Context read its members' whole factor rows,
-- secret envelopes included. Replace it with a function that answers User ids
-- and nothing else; the runtime role again sees only its own factor.

DROP POLICY "user_totp_factors_agency_member_select" ON "user_totp_factors";

-- The function runs as the table owner, which FORCE ROW LEVEL SECURITY also
-- binds, so the owner gets the Agency-member read and the runtime role doesn't.
CREATE POLICY "user_totp_factors_owner_agency_member_select" ON "user_totp_factors"
  FOR SELECT TO CURRENT_USER
  USING (
    EXISTS (
      SELECT 1
      FROM "agency_memberships" m
      WHERE m."user_id" = "user_totp_factors"."user_id"
        AND m."agency_id" = app_agency_id()
    )
  );

CREATE OR REPLACE FUNCTION app_agency_member_factor_user_ids()
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f."user_id"
  FROM "user_totp_factors" f
  JOIN "agency_memberships" m ON m."user_id" = f."user_id"
  WHERE m."agency_id" = app_agency_id();
$$;

-- Rollback/correction: drop the function and the policy.
