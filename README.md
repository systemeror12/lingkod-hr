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
