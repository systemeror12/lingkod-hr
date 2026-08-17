# Phase 3 non-production manual smoke

This procedure is for a configured non-production ZITADEL environment only.
It is not a CI gate and must not use production credentials or production
records.

Before starting, confirm that the non-production application has its approved
callback URL, logout URL, test Agency, Mailpit or approved non-production mail
route, and MFA policy configured. Do not paste credentials, recovery codes, or
invitation tokens into tickets or screenshots.

1. Open the non-production web application and start login.
2. Complete the configured ZITADEL login with a synthetic test identity.
3. Verify the callback returns to the non-production application and opens the
   authorized Work queue for the expected Agency.
4. Complete MFA when the identity or the requested permission requires it.
   Record only that the required factor was challenged and accepted; do not
   record the factor secret or recovery material.
5. Log out from LingkodHR, confirm the local session is revoked, and verify a
   protected route requires authentication again.
6. As an Agency Administrator, send one HRMO Administrator invitation.
7. Retrieve the message through the configured non-production mail boundary,
   open the single-use activation link, complete ZITADEL authentication and
   MFA when required, and confirm the HRMO Work queue opens.
8. Confirm the HRMO surface does not expose Users & Access or Invite user.
9. Remove the synthetic invitation and test records using the approved
   non-production cleanup procedure.

Record the date, environment, identity-provider tenant, callback result, MFA
evidence, logout result, invitation acceptance result, and any safe screenshot
paths. Never record passwords, tokens, cookies, or personal test data.
