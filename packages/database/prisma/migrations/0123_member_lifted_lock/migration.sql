-- The member list pages (#468) and must learn, for a page in one read, which
-- of its Users locked by another Agency that Agency no longer has as an ACTIVE
-- member; those locks the acting Agency may lift (#364). The runtime role
-- can't see another Agency's memberships, so a function answers the User ids
-- and nothing else: never which Agency locked them, nor its memberships.

-- The function runs as the table owner, which FORCE ROW LEVEL SECURITY also
-- binds, so the owner gets the read and the runtime role doesn't. The policy
-- is scoped through "users" rather than through the acting Agency's own
-- memberships: a policy on "agency_memberships" that reads
-- "agency_memberships" fails with "infinite recursion detected in policy"
-- (42P17). It opens only the locking Agency's membership of a locked User;
-- the function itself keeps to members of the acting Agency.
CREATE POLICY "agency_memberships_owner_locking_agency_select" ON "agency_memberships"
  FOR SELECT TO CURRENT_USER
  USING (
    EXISTS (
      SELECT 1
      FROM "users" u
      WHERE u."id" = "agency_memberships"."user_id"
        AND u."locked_by_agency_id" = "agency_memberships"."agency_id"
    )
  );

-- Of the given Users, those with a membership in the acting Agency who are
-- locked by another Agency that no longer has them as an ACTIVE member.
CREATE OR REPLACE FUNCTION app_agency_member_lifted_lock_user_ids(user_ids UUID[])
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u."id"
  FROM "users" u
  WHERE u."id" = ANY(user_ids)
    AND u."locked_by_agency_id" <> app_agency_id()
    AND EXISTS (
      SELECT 1
      FROM "agency_memberships" m
      WHERE m."user_id" = u."id"
        AND m."agency_id" = app_agency_id()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "agency_memberships" m
      WHERE m."user_id" = u."id"
        AND m."agency_id" = u."locked_by_agency_id"
        AND m."status" = 'ACTIVE'
    );
$$;

-- Rollback/correction: drop the function and the policy.
