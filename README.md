# Lingkod HR

AI-enabled Philippine Public-Sector HRIS for end-to-end workforce management—from plantilla and recruitment to attendance, leave, payroll, SPMS, separation, approvals, documents, and audit trails.

## Local development

### Prerequisites

- Node.js 24
- Corepack
- Docker Engine with Docker Compose v2
- Git

The repository pins pnpm 11.17.0 through `package.json`.

For a full Arch Linux walkthrough using the fish shell, see
[`docs/local-setup-arch-fish.md`](docs/local-setup-arch-fish.md).

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
| Local OIDC       | `http://127.0.0.1:4100`               |
| PostgreSQL       | `localhost:55432`                     |
| Redis            | `localhost:6379`                      |
| SeaweedFS S3 API | `http://localhost:8333`               |
| Mailpit UI       | `http://localhost:8025`               |

PostgreSQL uses host port `55432` to avoid the conventional host port `5432`,
which may already be used by another local project. Inside Docker, PostgreSQL
continues to use port `5432`.

### After pulling changes or switching machines

Use this gate after a `git pull`, branch checkout, worktree handoff, or
continuation from another machine. Activate the repository's Node version,
update dependencies, ensure infrastructure is healthy, and apply migrations:

```bash
fnm use
node --version
pnpm install --frozen-lockfile
docker compose -f infrastructure/compose.yaml up -d --wait
pnpm db:migrate
```

In a linked worktree, run `bash scripts/setup-worktree.sh` instead of these
commands; see [Parallel worktrees](#parallel-worktrees).

If `.env` does not exist, create it from `.env.example`. If it already exists,
copy only newly added keys without overwriting local values. Then check that no
old LingkodHR process owns the normal development ports before starting a new
stack:

```bash
ss -ltnp | grep -E ':(3000|3001|3002|4100)([^0-9]|$)' || true
```

Stop only identified LingkodHR processes from an older run. Leave unrelated
services alone. Start development and verify the service boundaries:

```bash
pnpm run dev
curl -fsS http://localhost:3001/api/v1/health
curl -fsS http://localhost:3002/health
curl -fsS http://127.0.0.1:4100/health
```

For protected browser or admin work, seed the local protected shell before
opening `/dashboard`:

```bash
pnpm --filter @lingkod-hr/database e2e:seed:shell
```

The seed also enables password sign-in at `/sign-in` with local-only
credentials. Every seeded User, such as `marisol.santos@example.test`, has the
passphrase `local-only seed passphrase`. Users whose roles require MFA also get
a TOTP factor with the secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`; add it to an
authenticator app to get codes. They also get the Recovery Codes `seedc-ode22`,
`seedc-ode23`, `seedc-ode24`, `seedc-ode25`, `seedc-ode26`, `seedc-ode27`,
`seedc-ode32`, `seedc-ode33`, `seedc-ode34`, and `seedc-ode35`. Each works once,
and every seed run restores all ten. The exception is
`enrollment.candidate@example.test`, which requires MFA but has no factor, so
signing in walks through authenticator setup. Each seed run removes its factor
and Recovery Codes again. The seed refuses to run in production.

The gate is complete when migrations report no pending work, each health check
responds successfully, and `/dashboard` completes local OIDC login. Diagnose
setup failures before changing application code; do not delete the local
database or migration history as a shortcut.

### Parallel worktrees

Each linked worktree gets its own `.env` and its own `hris_<worktree>`
database, so migrations, integration tests, and E2E seeds stay isolated.
Docker containers stay shared and owned by the main checkout. Set this up from
inside a new worktree:

```bash
bash scripts/setup-worktree.sh
```

In T3 Code, add that command as a project script with "Run on worktree
creation" enabled. The script is safe to rerun and refuses to run in the main
checkout.

Only one dev stack can own ports `3000`–`3002` and `4100` at a time. E2E runs
do not share ports: the script writes worktree-specific `PLAYWRIGHT_APP_PORT`,
`PLAYWRIGHT_API_PORT`, and `PLAYWRIGHT_OIDC_PORT` values to `.env`, and
`playwright.config.ts` reads them. The script picks ports no other worktree has
claimed, prints them, and `grep PLAYWRIGHT .env` shows them; rerun it in older
worktrees to add them. Two worktrees can run Playwright at the same time, but
Mailpit is still shared, and each run's global setup clears its messages. Drop a removed worktree's database with:

```bash
docker compose -f infrastructure/compose.yaml exec -T postgres \
  psql -U hris_local -d postgres -c 'DROP DATABASE "hris_<worktree>"'
```

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

Linked worktrees use their own ports instead; see
[Parallel worktrees](#parallel-worktrees).

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

#### Playwright port hotspot

Linked worktrees get their own E2E ports from `scripts/setup-worktree.sh`. If
another process still owns the ports, set these values before the Playwright
command:

```bash
PLAYWRIGHT_OIDC_PORT=4200 PLAYWRIGHT_API_PORT=3201 PLAYWRIGHT_APP_PORT=3200
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
