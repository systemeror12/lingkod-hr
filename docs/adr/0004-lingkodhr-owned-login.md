# ADR 0004: LingkodHR owns login

- Status: Accepted
- Date: 2026-10-02
- Supersedes: ADR-006 Managed Authentication (`docs/technical-architecture.md`)
- Scope: sign-in, credential custody, MFA, account recovery, and reauthentication

## Context

ADR-006 delegated authentication to an OpenID Connect provider so early effort
could go to HRIS work. ZITADEL Cloud was then selected, and an identity and
session operating contract was written around it. In-house login was never
evaluated against that choice.

The provider contract carried its own machinery: External Identity Links,
provider reconciliation, back-channel logout, discovery and JWKS handling,
outage fail-closed rules, a 100-DAU free tier, credentials held in another
region, and an exit path that loses data. Login also failed whenever the
provider was unavailable.

No official Philippine source sets numeric authentication values. NPC Circular
2023-06 requires the agency to enforce a Password Policy (§11), secure
authentication such as MFA for online access to sensitive personal information
(§16), and longer retention of authentication logs (§29). NIST SP 800-63B-4
and OWASP ASVS 5.0 supply numbers as guidance only.

## Decision

LingkodHR verifies passwords and TOTP codes itself and issues `UserSession`
directly. No external identity provider sits in the login path.

- LingkodHR writes every flow: sign-in, Invitation Activation, Password
  Reset, TOTP enrollment and challenge, the Sign-in Cool-down,
  reauthentication, and Factor Reset. It uses vetted primitives (Node's
  built-in Argon2id and a maintained RFC 6238 TOTP library) and never
  hand-rolls cryptography.
- A User owns one password and at most one TOTP factor across every Agency
  Membership. Memberships never carry credentials.
- The policy from the ZITADEL-era operating contract and the MFA policy scope
  carries over unchanged: 30-minute idle and 8-hour absolute sessions, no
  "remember me", a 5-minute Reauthentication Window, password plus TOTP with
  Recovery Codes or an audited Factor Reset, SMS and email codes never count
  as MFA, the MFA-Required User floor, and Agency Membership Suspension as
  distinct from a Global User Lock.
- Numeric values are Project Decisions. Agencies cannot relax them. An Agency
  meets NPC Circular 2023-06 §11 by adopting what LingkodHR enforces as its
  written Password Policy.

The values and flows are recorded in the decision tickets of
[Map: replace managed authentication with LingkodHR-owned login](https://github.com/systemeror12/lingkod-hr/issues/360)
and implemented through the LingkodHR-owned login spec linked from that map.

## Consequences

- LingkodHR is responsible for password storage, brute-force resistance,
  reset-token security, and TOTP secret custody. `DATA_ENCRYPTION_KEY` and
  `BLIND_INDEX_KEY` become required at startup in every environment.
- The External Identity Link, the provider subject on `users`, the provider
  session id on `user_sessions`, the OIDC client and callback, back-channel
  logout, the local OIDC fixture, the `OIDC_*` settings, and `SESSION_SECRET`
  are removed.
- Login no longer depends on an outside service, and credentials stay in
  LingkodHR's database.
- TOTP is not phishing-resistant, and NIST asks AAL2 verifiers to offer a
  phishing-resistant option. This gap is accepted until a separate passkey
  effort.
- `DATA_ENCRYPTION_KEY` has no rotation mechanism yet. If it is compromised,
  every User needs a Factor Reset.
- Password Reset and Invitation Activation links now establish credentials,
  so the pre-Pilot requirement for reviewed, agency-controlled email delivery
  still applies.
- Nothing is migrated. The ZITADEL instance never held real Pilot Agency
  identities.
- SSO and an agency-supplied identity provider are not part of this decision.
  If a Pilot Agency asks for one, it becomes an optional addition beside
  built-in login.
