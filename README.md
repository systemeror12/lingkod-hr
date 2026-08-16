# Lingkod HR

AI-enabled Philippine Public-Sector HRIS for end-to-end workforce management—from plantilla and recruitment to attendance, leave, payroll, SPMS, separation, approvals, documents, and audit trails.

## Local development

### Prerequisites

- Node.js 24
- Corepack
- Docker Engine with Docker Compose v2
- Git

The repository pins pnpm 11.17.0 through `package.json`.

Verify the required tools:

```bash
node --version
corepack --version
docker --version
docker compose version
git --version
```

### First-time setup

Run all commands from the repository root.

1. Enable Corepack and install dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

2. Create the local environment file:

```bash
cp .env.example .env
```

Keep `.env` local; it is ignored by Git and contains development-only values.
Review it before starting if the default ports conflict with other projects.

Do not manually run `source .env`. Project commands load the root `.env`
directly, so the same commands work in Fish, Bash, and Zsh.

3. Start the local infrastructure:

```bash
docker compose -f infrastructure/compose.yaml up -d --wait
```

4. Prepare the database roles and apply migrations:

```bash
pnpm db:migrate
```

5. Start the web, API, and worker processes:

```bash
pnpm run dev
```

To provision an Agency, use the documented non-HTTP operational command in
[`docs/agency-provisioning.md`](docs/agency-provisioning.md). Agency creation
is not exposed through the web or API runtime.

### Local services

| Service          | Local address                         |
| ---------------- | ------------------------------------- |
| Web              | `http://localhost:3000`               |
| API health       | `http://localhost:3001/api/v1/health` |
| Worker health    | `http://localhost:3002/health`        |
| PostgreSQL       | `localhost:55432`                     |
| Redis            | `localhost:6379`                      |
| SeaweedFS S3 API | `http://localhost:8333`               |
| Mailpit UI       | `http://localhost:8025`               |

PostgreSQL uses host port `55432` to avoid the conventional host port `5432`,
which may already be used by another local project. Inside Docker, PostgreSQL
continues to use port `5432`.

### After pulling changes

Update dependencies, ensure infrastructure is healthy, and apply new migrations:

```bash
pnpm install --frozen-lockfile
docker compose -f infrastructure/compose.yaml up -d --wait
pnpm db:migrate
```

Then start development with `pnpm run dev`.

### Validation

Run the full repository validation suite with:

```bash
pnpm validate
```

## Playwright E2E testing

Browser tests live in `apps/web/e2e` and use
[`apps/web/playwright.config.ts`](apps/web/playwright.config.ts). Run the
interactive commands from `apps/web` so Playwright loads that configuration.

### Run tests

From the repository root, run the complete web E2E suite with:

```bash
pnpm --filter @lingkod-hr/web test:e2e
```

Run the complete Phase 3 acceptance journey, including its local dependency
setup, with:

```bash
pnpm test:e2e:phase3
```

See [`docs/phase-3-acceptance.md`](docs/phase-3-acceptance.md) for the wider
API, PostgreSQL, CI, and manual-smoke evidence map.

For focused runs, work from `apps/web`:

```bash
cd apps/web

# List discovered tests without opening a browser
pnpm exec playwright test --list --project=chromium

# Run the full Chromium suite
pnpm exec playwright test --project=chromium

# Run one spec or one test by name
pnpm exec playwright test e2e/audit.spec.ts --project=chromium
pnpm exec playwright test --grep "keyboard-safe detail dialog" --project=chromium
```

The E2E configuration prepares PostgreSQL, applies migrations, seeds the
protected shell, and starts or reuses these dedicated services:

| Service | Port |
| --- | ---: |
| E2E web server | `3100` |
| E2E API | `3101` |
| Local OIDC | `4100` |

The normal development web server uses port `3000`; it is separate from the
E2E web server.

### Interactive testing

Playwright UI Mode provides the test list, browser preview, actions, and
traces:

```bash
cd apps/web
pnpm exec playwright test --ui --project=chromium --ui-host=127.0.0.1 --ui-port=0
```

The UI port is dynamic. UI Mode can appear to load indefinitely while the
database setup and E2E servers are starting. Wait for the migration/seed
output in the terminal, then refresh the UI. Use `--list` first if you need
to confirm test discovery.

For a single test with the Playwright Inspector:

```bash
cd apps/web
PWDEBUG=1 pnpm exec playwright test e2e/audit.spec.ts --project=chromium
```

For a visible browser without the UI dashboard:

```bash
cd apps/web
pnpm exec playwright test e2e/audit.spec.ts --headed --project=chromium
```

To inspect the running application without the E2E test runner, use Playwright
directly. This does not run database setup or create the E2E services:

```bash
cd apps/web
pnpm exec playwright open -b chromium http://localhost:3000
pnpm exec playwright codegen --target=playwright-test http://localhost:3000
```

### Stale E2E web server

If UI Mode spins forever, check the E2E web health endpoint:

```bash
curl -fsS --max-time 5 http://localhost:3100/health
```

If it does not respond, stop the stale E2E web process and start UI Mode
again:

```bash
fuser -k 3100/tcp
```

Only use that cleanup command for the dedicated E2E port. Do not use it on
port `3000`, which belongs to the normal development server.

Failed runs keep traces and screenshots under `apps/web/test-results`. Open a
trace with:

```bash
cd apps/web
pnpm exec playwright show-trace test-results/<failed-test>/trace.zip
```

### Troubleshooting

Check infrastructure health:

```bash
docker compose -f infrastructure/compose.yaml ps
```

Inspect PostgreSQL logs:

```bash
docker compose -f infrastructure/compose.yaml logs postgres
```

If `pnpm db:migrate` reports that a database URL is missing, confirm that `.env`
exists and contains `DATABASE_URL`, `DATABASE_DIRECT_URL`,
`DATABASE_OPERATIONAL_URL`, and `DATABASE_MIGRATION_OWNER_URL`. Copy any newly
added keys from `.env.example` without overwriting existing local secrets.

If port `55432` is unavailable, choose another host port in `.env` and update
`POSTGRES_PORT` plus all three database URLs to the same port.

Stop the local infrastructure with:

```bash
docker compose -f infrastructure/compose.yaml down
```
