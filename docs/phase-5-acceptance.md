# Phase 5 acceptance gate

The Phase 5 gate runs one representative protected personnel journey through
the real API and web application with PostgreSQL RLS and the local OIDC
fixture. Its records, identities, documents, and foreign-Agency controls are
synthetic and deterministically reset after the run.

## Commands

Run the focused gate from the repository root:

```bash
pnpm test:e2e:phase5
```

Run all repository and browser checks:

```bash
pnpm validate
pnpm --filter @lingkod-hr/web test:e2e
```

CI runs all three commands and retains `apps/web/test-results` and
`apps/web/playwright-report` as the `phase-5-browser-evidence` artifact.

## Evidence map

| Exit criterion                                                                 | Automated evidence                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected Employee creation, membership link, and effective Personnel Baseline | `apps/web/e2e/phase-5.spec.ts` verifies PREBOARDING to ACTIVE, active service and incumbency records, and the occupied Plantilla position.                                                                                  |
| Revised 2026 PDS lifecycle and shared Document boundary                        | The gate uses a finalized seeded Document and verifies create, submit, employee certification, HR verification, rendering, and historical output retrieval.                                                                 |
| Government identifier masking and deliberate reveal                            | The gate verifies masked routine API and UI reads, the accessible reveal dialog, audited reason, narrow viewport behavior, and removal of plaintext after close. Trace capture is disabled for this plaintext-bearing test. |
| Personnel Action and immutable Service Record                                  | The gate prepares, submits, endorses, approves, and effectuates a step increment, then verifies the generated snapshot and equivalent printable and structured views.                                                       |
| Permission and Agency isolation                                                | The gate uses an Employee-only identity for same-Agency denials and verifies foreign Employee and protected-identifier absence through the web, API reads and changes, relationship controls, and runtime RLS.              |
| Complete, sanitized transition evidence                                        | The final audit assertion is limited to IDs created by the journey, requires each material transition, and rejects the protected plaintext.                                                                                 |

The fixture seed establishes roles and finalized evidence before the journey;
the browser test does not edit workflow status or role-assignment tables.
