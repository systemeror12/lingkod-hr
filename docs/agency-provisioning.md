# Agency Provisioning

Agency creation is an operational command, not an HTTP API. Run it with the
privileged `hris_operator` database URL after local infrastructure and database
migrations are ready:

```bash
pnpm --filter @lingkod-hr/api provision:agency -- \
  --code DOST \
  --name "Department of Science and Technology" \
  --agency-type NGA \
  --administrator-email admin@example.test
```

The command accepts only the Agency code, name, supported Agency type, and the
first Agency Administrator email. It creates an `ACTIVE` Agency and one
single-use, seven-day invitation for the `agency_administrator` role in one
database transaction. It does not create a User or identity-provider
credentials.

`DATABASE_OPERATIONAL_URL` must use the `hris_operator` role. Ordinary web/API
runtime connections use `DATABASE_URL` with `hris_app`; PostgreSQL denies that
role's Agency-creation path even if a request supplies a forged Agency context.

The invitation is delivered through the provider-neutral mail seam after the
authoritative transaction commits. Local development uses SMTP on Mailpit
(`localhost:1025`), and the activation link is available in the Mailpit
message. The command output intentionally omits the activation token and
link. Provisioning and invitation audit/security metadata contains correlation
and business context only; it never contains the raw token, credentials, or
secrets.

If SMTP delivery fails after the transaction commits, the command cancels the
pending invitation and suspends the new Agency in a compensating transaction,
then exits nonzero. The failed attempt therefore leaves no usable Agency or
invitation state. No partial Agency or invitation write is committed when
persistence fails.
