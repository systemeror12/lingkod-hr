# ADR 0001: Use a privileged operational boundary for Agency provisioning

- Status: Accepted
- Date: 2026-08-14
- Scope: Agency Provisioning and first-administrator invitation

## Context

An Agency must be created before it has an Agency Context or an authenticated
Agency Administrator. The ordinary `hris_app` database role is intentionally
limited to an existing Agency Context, so using it for provisioning would
require a bypass that could also be reached by an ordinary web/API request.

The first administrator must receive the same secure, single-use invitation
as later Agency invitations, but there is no membership that can populate the
inviter or role-assigner foreign keys.

## Decision

Provisioning uses a separate `hris_operator` login and a non-HTTP command. The
command sets a transaction-local operational provisioning context, and
PostgreSQL RLS permits Agency insertion only when both the database role and
the context are correct. The role receives only the explicit table privileges
needed to create the Agency, issue its invitation, and append evidence.

System-issued invitations therefore allow null inviter and role-assigner
membership references. The invitation remains single-use, expiry-bound, and
restricted to `agency_administrator`.

Authoritative Agency and invitation writes commit before the provider-neutral
mail adapter is called. If delivery fails, a compensating operational
transaction cancels the pending invitation, suspends the new Agency, and
records sanitized security and audit evidence. This keeps external SMTP work
outside the database transaction while ensuring a failed command leaves no
usable provisioning state.

This is a narrow Phase 3 exception to the general asynchronous email/outbox
rule. It exists because the one-shot command and the existing Agency
invitation mutation must return an explicit nonzero delivery failure. Both
paths dispatch only after commit and compensate failed invitations; general
asynchronous workflows should use the worker/outbox path when that
infrastructure is introduced.

## Consequences

- Web/API runtime credentials cannot create arbitrary Agencies, even with a
  forged context setting.
- The operator credential is deployment-only and must not be available to the
  web, API, or worker runtime.
- A delivery failure is visible as a failed command and a suspended Agency;
  recovery is an explicit operational action rather than an implicit retry.
- The provider-neutral mail seam can use Mailpit locally and be replaced by a
  production adapter later.
