-- A pending activation is also visible through its invitation's link. A
-- first-time invitee has no User yet, so restarting Invitation Activation
-- finds the earlier pending activation this way to replace it.
CREATE POLICY "pending_authentications_invitation" ON "pending_authentications"
  USING (
    "purpose" = 'ACTIVATION'
    AND "invitation_id" IN (
      SELECT "id" FROM "invitations"
      WHERE encode("token_hash", 'hex') = current_setting('app.invitation_token_hash', true)
    )
  )
  WITH CHECK (
    "purpose" = 'ACTIVATION'
    AND "invitation_id" IN (
      SELECT "id" FROM "invitations"
      WHERE encode("token_hash", 'hex') = current_setting('app.invitation_token_hash', true)
    )
  );

-- Rollback/correction: drop the policy.
