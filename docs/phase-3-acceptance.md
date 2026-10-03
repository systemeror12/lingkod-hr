# Phase 3 acceptance gate

The Phase 3 gate uses only local deterministic dependencies: the migrated
PostgreSQL schema, the runtime `hris_app` connection, Mailpit, the real API,
and the production web application. It never contacts an identity provider or
an external mail provider.

## Commands

From the repository root, install dependencies once:

```bash
pnpm install --frozen-lockfile
```

Run the complete protected journey. Playwright starts or reuses PostgreSQL
and Mailpit, applies migrations, seeds a synthetic Agency Administrator,
and starts the real API and web application:

```bash
pnpm test:e2e:phase3
```

Run the wider acceptance layers with the runtime database role and the
administrative fixture role:

```bash
DATABASE_E2E=true \
DATABASE_URL=postgresql://hris_app:local_app@localhost:55432/hris \
DATABASE_DIRECT_URL=postgresql://hris_migrator:local_migrator@localhost:55432/hris \
DATABASE_OPERATIONAL_URL=postgresql://hris_operator:local_operator@localhost:55432/hris \
DATABASE_MIGRATION_OWNER_URL=postgresql://hris_local:local_only@localhost:55432/hris \
DATABASE_E2E_ADMIN_URL=postgresql://hris_local:local_only@localhost:55432/hris \
pnpm validate
```

The CI workflow runs formatting, lint, typechecking, and the production build
before installing Chromium or starting Docker. It then applies migrations,
runs the repository tests with the runtime, migration, operational, and
administrative database roles, and runs the complete Chromium suite once. The
suite includes this Phase 3 journey. Failed runs retain suite-wide browser
evidence for 14 days; successful runs do not upload it.

## Evidence map

| Exit criterion                                                                                      | Evidence                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agency Provisioning boundary and atomic first invitation                                            | `apps/api/src/agency-provisioning/provision-agency.test.ts`, including the documented `pnpm ... provision:agency` command boundary                                 |
| Complete Administrator → HRMO → Organization Unit → Audit journey                                   | `apps/web/e2e/phase-3.spec.ts`                                                                                                                                     |
| API denial, permission, record scope, validation, conflict, and sanitization                        | API assertions in `apps/web/e2e/phase-3.spec.ts` plus the API controller/service tests under `apps/api/src`                                                        |
| PostgreSQL RLS, Agency-safe relationships and uniqueness, transactional audit, append-only evidence | `packages/database/src/organization-unit-isolation.test.ts`, `packages/database/src/audit-event-isolation.test.ts`, and the Organization service integration tests |
| Rail, dialogs, keyboard/focus behavior, narrow-width interaction, and token contrast                | `apps/web/e2e/phase-3.spec.ts` and the focused slice specs under `apps/web/e2e`                                                                                    |
| Visual validation                                                                                   | Playwright screenshots in the ignored `apps/web/test-results/<test-name>/` directory; CI retains the suite-wide browser evidence for 14 days after a failed run    |

Test data is synthetic, generated with a run suffix, isolated by Agency
context, and reset by the E2E setup before each browser run. No database row
editing is part of the developer procedure. The seed also creates fixed
synthetic foreign Organization Unit and Audit Event records; the critical path
requests those records through the active Agency Context and expects `404`.

## Validation record

The latest local run passed the focused browser gate (1 Chromium test), the
wider repository validation (formatting, lint, typecheck, API/database/web
tests, and production build), and the full browser suite (9 Chromium tests).
The focused and full browser runs produced the screenshots listed above under
`apps/web/test-results/`.
