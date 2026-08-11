# Philippine Public-Sector HRIS
## Development Tech Stack Prerequisites

**Document status:** Development environment prerequisite guide  
**Applies to:** Philippine Public-Sector HRIS Technical Architecture v0.3  
**Primary workstation target:** Arch Linux / CachyOS x86_64  
**Architecture:** TypeScript multi-tenant modular monolith  
**Version:** 1.1  
**Last updated:** August 8, 2026  

---

# 1. Purpose

This document defines the software, host configuration, local services, accounts, and verification steps required before starting development of the Philippine Public-Sector HRIS.

The goal is to keep the developer workstation minimal and reproducible.

The host machine should contain only the tools needed to:

- edit source code;
- run Node.js and pnpm;
- run Docker and Docker Compose;
- use Git;
- build native Node dependencies when required;
- inspect JSON, HTTP, logs, and certificates.

The following application infrastructure should normally run through Docker Compose instead of being installed directly on the host:

- PostgreSQL with pgvector;
- Redis;
- S3-compatible object storage;
- local mail-testing server;
- optional OpenTelemetry collector.

---

# 2. Technical Stack Covered by This Guide

The project uses:

```text
TypeScript
Node.js LTS
pnpm
Turborepo

Next.js App Router
React
Tailwind CSS
shadcn/ui
TanStack Table
TanStack Query
React Hook Form
Zod

NestJS
REST
OpenAPI

PostgreSQL
Prisma ORM
Reviewed SQL migrations
pgvector

Redis
BullMQ

S3-compatible object storage

OpenAI Responses API
Provider-neutral AI service
Structured outputs
Controlled tool calling
Human review

Docker Compose
GitHub Actions
OpenTelemetry
Playwright
Vitest
```

Most JavaScript/TypeScript framework dependencies will be installed **inside the repository through pnpm**.

They should not be globally installed on the workstation unless there is a specific reason.

---

# 3. Recommended Development Machine

These are practical recommendations rather than hard application requirements.

## Minimum

```text
CPU        4 logical cores
RAM        16 GB
Disk       25 GB free SSD space
OS         64-bit Linux
Network    Stable broadband connection
```

## Recommended

```text
CPU        8+ logical cores
RAM        32 GB
Disk       50+ GB free SSD space
OS         Arch Linux / CachyOS x86_64
```

Additional RAM is useful when running simultaneously:

- Next.js development server;
- NestJS API;
- BullMQ worker;
- PostgreSQL;
- Redis;
- object storage;
- browser-based Playwright tests;
- IDE/editor;
- Docker builds.

---

# 4. Version Baseline

Use a stable supported release for the **LingkodHR project runtime**, while allowing the workstation itself to keep a newer Node.js version for unrelated tools and projects.

| Component | Recommended baseline |
|---|---|
| LingkodHR Node.js runtime | **24.x LTS (Krypton)** |
| Node version manager | **fnm** |
| System/default Node.js | May remain on the current/latest version |
| pnpm | **11.x**, exact version pinned in `package.json` |
| Docker Engine | Current supported Arch/CachyOS package |
| Docker Compose | Compose v2-compatible CLI/plugin |
| PostgreSQL | PostgreSQL 18 container with pgvector |
| Redis | Current stable container image |
| TypeScript | Repository-pinned |
| Next.js | Repository-pinned |
| React | Repository-pinned |
| NestJS | Repository-pinned |
| Prisma | Repository-pinned |
| Playwright | Repository-pinned |
| Vitest | Repository-pinned |

The workstation does **not** need to use Node.js 24 globally.

A newer/default Node.js may remain available for unrelated projects, CLI tools, and utilities. LingkodHR itself is pinned to Node.js 24 LTS.

At the repository root, create:

```text
.node-version
```

with:

```text
24
```

Also define the project runtime and package manager:

```json
{
  "engines": {
    "node": ">=24 <25"
  },
  "packageManager": "pnpm@11.17.0"
}
```

Expected workflow:

```text
Normal shell / other projects
        ↓
Default/current Node.js

cd lingkod-hr
        ↓
fnm reads .node-version
        ↓
Node.js 24 LTS
```

The exact pnpm patch version may be updated deliberately later. When changed, update the repository and CI together.

---

# 5. Update the Operating System First

Before installing development dependencies:

```bash
sudo pacman -Syu
```

Reboot if the update changes:

- kernel;
- systemd;
- graphics stack;
- container-related system components

and your system normally requires it.

Avoid beginning a new project setup while a partial system upgrade is pending.

---

# 6. Required Host Packages

Install the basic development toolchain:

```bash
sudo pacman -S --needed \
  base-devel \
  git \
  curl \
  wget \
  unzip \
  jq \
  openssl \
  ca-certificates \
  python
```

These provide common build and troubleshooting tools used by Node.js packages and development scripts.

Verify:

```bash
git --version
curl --version
jq --version
openssl version
python --version
```

---

# 7. Node.js Version Management with fnm

LingkodHR should use **Node.js 24 LTS**, but this should not replace the workstation's normal Node.js installation.

Use `fnm` to manage Node.js versions per project.

Install `fnm`:

```bash
sudo pacman -S --needed fnm
```

Install LingkodHR's Node.js runtime:

```bash
fnm install 24
```

If another project or CLI tool uses Node.js 26 or another current release, keep that version separately.

Example:

```bash
fnm install 24
fnm install 26
fnm default 26
```

This allows:

```text
Outside LingkodHR
Node.js 26 or another default version

Inside LingkodHR
Node.js 24 LTS
```

## 7.1 Repository Pin

Create this file at the LingkodHR repository root:

```text
.node-version
```

Content:

```text
24
```

## 7.2.a Fish Shell Setup

For Fish, `fnm` must be initialized before it can modify the active Node.js version.

Add this line to:

```text
~/.config/fish/config.fish
```

```fish
fnm env --use-on-cd --shell fish | source
```

You may append it with:

```fish
echo 'fnm env --use-on-cd --shell fish | source' >> ~/.config/fish/config.fish
```

Reload Fish:

```fish
source ~/.config/fish/config.fish
```

After changing `config.fish`, close and reopen existing integrated terminals such as the Visual Studio Code terminal.

## 7.2.b Zsh Shell Setup

For Zsh, `fnm` must be initialized before it can modify the active Node.js version.

Add this line to:

```text
~/.zshrc
```

```zsh
eval "$(fnm env --use-on-cd --shell zsh)"
```

You may append it with:

```zsh
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
```

Reload Zsh:

```zsh
source ~/.zshrc
```

After changing `.zshrc`, close and reopen existing integrated terminals such as the Visual Studio Code terminal.

## 7.3 Verify Automatic Switching

Outside the repository:

```fish
node --version
```

This may report the workstation's normal/default Node.js version.

Enter LingkodHR:

```fish
cd lingkod-hr
node --version
```

Expected:

```text
v24.x.x
```

Additional checks:

```fish
fnm current
fnm list
```

If automatic switching does not occur:

```fish
fnm use
```

If `fnm use` reports that required environment variables are missing, load the shell integration:

```fish
fnm env --use-on-cd --shell fish | source
```

## 7.4 Why This Setup

Node.js 24 LTS is a **LingkodHR project requirement**, not a workstation-wide requirement.

This setup provides:

- a stable LTS runtime for LingkodHR;
- reproducible CI and production behavior;
- freedom to use newer Node versions for other tools;
- automatic project switching through `.node-version`.

---

# 8. Corepack and pnpm

Install Corepack from the Arch repository:

```bash
sudo pacman -S --needed corepack
```

Enable package-manager shims:

```bash
corepack enable
```

Activate the initial pnpm baseline:

```bash
corepack prepare pnpm@11.17.0 --activate
```

Verify:

```bash
corepack --version
pnpm --version
```

Expected:

```text
pnpm 11.x
```

After the repository exists, the authoritative pnpm version is the root `package.json`:

```json
{
  "packageManager": "pnpm@11.17.0"
}
```

Do not routinely install pnpm globally with:

```bash
sudo npm install -g pnpm
```

Using Corepack plus a repository-pinned package manager makes the development and CI environments more reproducible. Run pnpm commands after `fnm` has activated Node.js 24 inside LingkodHR.

---

# 9. Docker Engine and Docker Compose

Install Docker:

```bash
sudo pacman -S --needed \
  docker \
  docker-compose \
  docker-buildx
```

Enable and start the Docker daemon:

```bash
sudo systemctl enable --now docker.service
```

Verify:

```bash
docker --version
docker compose version
docker buildx version
sudo docker run --rm hello-world
```

## Optional non-root Docker access

If you choose to run Docker without `sudo`:

```bash
sudo usermod -aG docker "$USER"
```

Then sign out and sign back in.

Verify:

```bash
docker run --rm hello-world
```

### Security note

Membership in the `docker` group effectively grants root-equivalent control over the machine.

Only add trusted local users to this group.

If you prefer not to grant that capability, continue using `sudo docker ...`.

---

# 10. Local Infrastructure Strategy

Do **not** install separate host instances of PostgreSQL, Redis, or an object-store server unless there is a specific development reason.

Use Docker Compose.

Recommended local topology:

```text
Developer workstation
│
├── apps/web          → host Node process
├── apps/api          → host Node process
├── apps/worker       → host Node process
│
└── Docker Compose
    ├── PostgreSQL + pgvector
    ├── Redis
    ├── S3-compatible object storage
    ├── mail testing server
    └── optional OpenTelemetry collector
```

This makes it easier to:

- reset development data;
- use the same service versions across machines;
- reproduce CI problems;
- isolate application dependencies;
- upgrade infrastructure deliberately.

---

# 11. PostgreSQL Prerequisite

PostgreSQL is the system of record.

The preferred local database is containerized PostgreSQL with pgvector.

Initial container baseline:

```text
PostgreSQL 18
pgvector extension available
```

A Compose service may initially resemble:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_DB: hris
      POSTGRES_USER: hris_local
      POSTGRES_PASSWORD: local_only
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Do not reuse development credentials in production.

Required PostgreSQL extensions for the physical schema include:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
```

`vector` is enabled only when the AI retrieval features require it.

---

# 12. Redis Prerequisite

Redis supports:

- BullMQ;
- background jobs;
- transient caching;
- job coordination.

Run Redis through Docker Compose.

Typical local port:

```text
6379
```

Redis is not an authoritative source of HR, payroll, leave, attendance, or personnel data.

PostgreSQL remains authoritative.

---

# 13. S3-Compatible Object Storage

The project uses an S3-compatible object store for:

- PDS attachments;
- appointment documents;
- vacancy records;
- leave evidence;
- DTR outputs;
- payslips;
- payroll reports;
- clearance documents;
- performance evidence;
- official forms;
- policies;
- imports and exports.

For local development, use a Dockerized S3-compatible service selected by the repository's Compose configuration.

No host installation is required.

Production object storage may use any supported managed S3-compatible provider.

The application must interact through the S3 API rather than provider-specific filesystem assumptions.

---

# 14. Local Mail Testing

Development email should not send real production email.

The Compose environment should include a local SMTP/mail-capture service.

It is used for testing:

- invitations;
- account notices;
- workflow notifications;
- report delivery;
- payroll notifications where applicable.

No workstation-wide SMTP server is required.

---

# 15. Git Configuration

Verify Git identity:

```bash
git config --global user.name
git config --global user.email
```

Set them if necessary:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Recommended:

```bash
git config --global init.defaultBranch main
git config --global pull.ff only
```

SSH authentication is recommended for Git hosting.

Verify SSH configuration before starting repository work.

---

# 16. Recommended Editor

The architecture does not require a specific editor.

Suitable options include:

- Visual Studio Code;
- Zed;
- JetBrains WebStorm/IntelliJ IDEA;
- Neovim.

Recommended editor capabilities:

- TypeScript language server;
- ESLint integration;
- Prettier integration;
- Tailwind CSS completion;
- Prisma syntax support;
- Docker/Compose support;
- Git integration;
- Markdown support;
- Mermaid preview;
- Playwright test integration where available.

Do not make editor-specific settings authoritative for application behavior.

Repository scripts and CI are authoritative.

---

# 17. Browser Requirement

Keep at least one current Chromium-based browser or Firefox available for manual testing.

Playwright will manage the automated browser binaries used by the repository.

After Playwright is added to the project, install the required browser binaries from inside the repository, for example:

```bash
pnpm exec playwright install chromium
```

Do this only after Playwright has been added as a repository dependency.

The CI environment should install browsers in a controlled reproducible manner.

---

# 18. Application Dependencies That Must NOT Be Installed Globally

The following belong in the repository:

```text
typescript
turbo
next
react
react-dom
tailwindcss
@nestjs/*
zod
@prisma/*
prisma
bullmq
ioredis
vitest
playwright
eslint
prettier
OpenTelemetry packages
OpenAI SDK
```

Do not depend on globally installed versions of:

```bash
typescript
nestjs
next
prisma
turbo
playwright
```

Use:

```bash
pnpm <script>
```

or:

```bash
pnpm exec <command>
```

This keeps local, CI, and production tooling aligned.

---

# 19. External Service Accounts

Not every external account is required on the first development day.

## Required before authentication integration

An OpenID Connect-compatible identity provider.

Required values will eventually include:

```text
OIDC_ISSUER
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
```

## Required before AI features

OpenAI API credentials:

```text
OPENAI_API_KEY
AI_DEFAULT_MODEL
AI_EMBEDDING_MODEL
AI_FEATURES_ENABLED
```

The OpenAI key is not required to implement non-AI HRIS modules.

## Required before production email

A transactional email provider:

```text
EMAIL_FROM
EMAIL_PROVIDER_API_KEY
```

Local development uses the mail-capture service instead.

## Required before production file deployment

S3-compatible production storage credentials:

```text
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
```

Local values come from Docker Compose.

---

# 20. Environment Variable Baseline

The repository should eventually provide:

```text
.env.example
```

with placeholder names only.

Baseline variables:

```text
# Runtime
NODE_ENV
APP_ENV
APP_URL
API_URL

# Database
DATABASE_URL
DATABASE_DIRECT_URL
DATABASE_MIGRATION_OWNER_URL

# Redis
REDIS_URL

# Authentication
OIDC_ISSUER
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
SESSION_SECRET

# Object storage
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY

# AI
OPENAI_API_KEY
AI_DEFAULT_MODEL
AI_EMBEDDING_MODEL
AI_FEATURES_ENABLED

# Email
EMAIL_FROM
EMAIL_PROVIDER_API_KEY

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT
ERROR_TRACKING_DSN

# Encryption
DATA_ENCRYPTION_KEY
BLIND_INDEX_KEY
```

Never commit real secrets.

Recommended repository pattern:

```text
.env.example      committed
.env              ignored
.env.local        ignored
.env.test         controlled test values only
```

---

# 21. Local Encryption Keys

Development will eventually require keys for encrypted HR data and blind indexes.

Examples:

```text
DATA_ENCRYPTION_KEY
BLIND_INDEX_KEY
SESSION_SECRET
```

Generate development-only random values rather than using memorable strings.

Example:

```bash
openssl rand -hex 32
```

Production keys must be generated, stored, and rotated using an appropriate secrets-management system.

Never copy local development keys into production.

---

# 22. Suggested Local Ports

These are recommended defaults and may be changed by the repository.

| Service | Suggested port |
|---|---:|
| Next.js web | 3000 |
| NestJS API | 3001 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| Object-storage API | 9000 |
| Object-storage console | 9001 |
| Mail testing UI | 8025 |
| SMTP testing | 1025 |
| OpenTelemetry | 4317 / 4318 |

Check for conflicts:

```bash
ss -lntup
```

Only expose the ports needed for local development.

---

# 23. Shell and PATH Verification

Before starting repository development:

```bash
command -v git
command -v fnm
command -v node
command -v npm
command -v corepack
command -v pnpm
command -v docker
```

All should return valid executable paths.

Verify versions:

```bash
git --version
fnm --version
node --version
npm --version
corepack --version
pnpm --version
docker --version
docker compose version
```

---

# 24. Recommended Installation Sequence

Follow this order on Arch/CachyOS:

```text
1. Update system
        ↓
2. Install base development packages
        ↓
3. Keep/install the workstation's preferred default Node.js
        ↓
4. Install fnm
        ↓
5. Install Node.js 24 LTS through fnm
        ↓
6. Configure Fish shell integration
        ↓
7. Create .node-version = 24 in LingkodHR
        ↓
8. Install/enable Corepack
        ↓
9. Activate pinned pnpm
        ↓
10. Install Docker + Compose + Buildx
        ↓
11. Start Docker
        ↓
12. Configure Git
        ↓
13. Verify project Node switching
        ↓
14. Install project dependencies
        ↓
15. Start Compose infrastructure
        ↓
16. Run database migrations
        ↓
17. Start web/API/worker
```

---

# 25. Condensed Arch/CachyOS Setup

Install the required workstation tools:

```bash
sudo pacman -Syu

sudo pacman -S --needed \
  base-devel \
  git \
  curl \
  wget \
  unzip \
  jq \
  openssl \
  ca-certificates \
  python \
  fnm \
  corepack \
  docker \
  docker-compose \
  docker-buildx
```

The workstation may keep its current/default Node.js for other tools.

Install LingkodHR's Node.js runtime:

```fish
fnm install 24
```

Optional example if Node.js 26 should remain your normal default:

```fish
fnm install 26
fnm default 26
```

Configure Fish automatic switching:

```fish
echo 'fnm env --use-on-cd --shell fish | source' >> ~/.config/fish/config.fish
source ~/.config/fish/config.fish
```

At the LingkodHR repository root:

```fish
echo '24' > .node-version
```

Re-enter the repository and verify:

```fish
cd ..
cd lingkod-hr

fnm current
node --version
```

Expected inside LingkodHR:

```text
v24.x.x
```

Enable the pinned package manager:

```fish
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

Start Docker:

```bash
sudo systemctl enable --now docker.service
```

Final verification:

```fish
fnm --version
node --version
pnpm --version
git --version
docker --version
docker compose version
sudo docker run --rm hello-world
```

Expected LingkodHR Node major:

```text
24
```

Expected pnpm major:

```text
11
```

---

# 26. Repository Bootstrap Expectations

Once the prerequisite checks pass, development can begin by creating:

```text
apps/
├── web/
├── api/
└── worker/

packages/
├── database/
├── contracts/
├── permissions/
├── auth/
├── public-sector-hr/
├── payroll-core/
├── ai-core/
├── ui/
├── observability/
├── test-utils/
└── config/
```

Infrastructure:

```text
infrastructure/
├── docker/
├── compose.yaml
└── scripts/
```

Documentation:

```text
docs/
├── technical-architecture.md
├── data-model/
├── workflows/
└── adr/
```

---

# 27. First Repository Commands

Once the project scaffold exists:

```bash
pnpm install
```

Then:

```bash
docker compose up -d
```

Check infrastructure:

```bash
docker compose ps
```

Run repository checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Start development:

```bash
pnpm dev
```

The exact scripts are defined during repository scaffolding.

---

# 28. What Should Be Running Before the First Vertical Slice

Before implementing the first user journey, confirm:

```text
[Host]
fnm
Node.js 24 LTS active inside LingkodHR
pnpm
Git
Docker

[Docker]
PostgreSQL + required extensions
Redis
S3-compatible storage
Local mail testing

[Repository]
Next.js app starts
NestJS API starts
Worker starts
Prisma connects
Environment validation works
Health endpoint works
```

---

# 29. Development Security Requirements

Before handling real HR information:

- never use production employee data in normal development;
- use generated or anonymized test data;
- never commit `.env` files containing credentials;
- never commit private keys;
- never place real government IDs in fixtures;
- never place real bank details in tests;
- never expose local PostgreSQL or Redis to the public network;
- never use production S3 buckets from local development;
- never use production OIDC credentials locally;
- rotate any secret accidentally committed;
- treat Docker group membership as privileged access;
- keep the system and dependencies updated.

---

# 30. Database Safety Requirements

Development migrations must be reproducible.

Do not manually change the development database and assume the change is part of the project.

Schema changes must become:

```text
Prisma schema change
and/or
reviewed SQL migration
```

Reviewed SQL is expected for:

- Row-Level Security;
- exclusion constraints;
- partial unique indexes;
- immutable-record triggers;
- advanced PostgreSQL functions;
- partitioning where eventually required.

A fresh database must be able to reach the expected schema by running project migrations.

---

# 31. Required Pre-Development Verification Checklist

## Operating system

- [ ] System is fully updated.
- [ ] No partial package upgrade is pending.
- [ ] At least 25 GB free disk space is available.
- [ ] Recommended memory is available for Docker and browser tests.

## Core tools

- [ ] `git` works.
- [ ] `curl` works.
- [ ] `jq` works.
- [ ] `openssl` works.
- [ ] native build toolchain is installed.

## Node ecosystem

- [ ] `fnm` is installed.
- [ ] Fish initializes `fnm` with `--use-on-cd`.
- [ ] LingkodHR contains `.node-version` with `24`.
- [ ] Node.js 24 LTS is installed through `fnm`.
- [ ] `node --version` reports `v24.x.x` inside LingkodHR.
- [ ] The workstation may use another default Node version outside LingkodHR.
- [ ] npm is available under the active project runtime.
- [ ] Corepack is installed.
- [ ] pnpm is available.
- [ ] pnpm version matches the repository's `packageManager` field.

## Containers

- [ ] Docker daemon starts.
- [ ] `docker run --rm hello-world` succeeds.
- [ ] `docker compose version` succeeds.
- [ ] Buildx is available.

## Git

- [ ] User name is configured.
- [ ] User email is configured.
- [ ] Git-host authentication works.

## Repository readiness

- [ ] Required ports are available.
- [ ] `.env.example` exists once the repository is scaffolded.
- [ ] Real secrets are excluded from Git.
- [ ] Docker Compose infrastructure starts.
- [ ] PostgreSQL is reachable.
- [ ] Redis is reachable.
- [ ] Object storage is reachable.
- [ ] Mail testing is reachable.

---

# 32. Prerequisite Definition of Done

The development workstation is considered ready when this sequence succeeds:

```text
System updated
→ fnm project switching verified
→ Node.js 24 LTS verified inside LingkodHR
→ pnpm verified
→ Docker verified
→ Repository dependencies install
→ Docker Compose services become healthy
→ Database migration succeeds
→ Web/API/worker start
→ Health endpoint succeeds
→ Test command executes
```

At that point, implementation can move to:

```text
Identity
→ Agency
→ AgencyMembership
→ Roles and permissions
→ Authentication
→ RLS
→ First protected vertical slice
```

---

# 33. Maintenance Policy

The prerequisite document should be reviewed when any of the following changes:

- Node.js LTS major version;
- fnm setup or shell integration;
- pnpm major version;
- PostgreSQL major version;
- Docker/Compose strategy;
- authentication provider;
- object-storage implementation;
- CI/CD platform;
- local development operating-system assumptions.

Do not upgrade foundational tooling solely because a newer major version exists.

Upgrade when:

- the existing version approaches end of support;
- a required framework requires the newer version;
- a material security issue requires it;
- the upgrade has been tested against the repository.

---

# 34. Current Project Runtime Notes

At the time this document was updated:

- LingkodHR is pinned to Node.js 24 LTS.
- Node.js 24 is a **project runtime requirement**, not a workstation-wide requirement.
- The workstation may keep a newer/current Node.js version for unrelated CLI tools and other projects.
- `fnm` manages Node.js versions per project.
- LingkodHR uses a root `.node-version` file containing `24`.
- Fish should initialize `fnm` with:

```fish
fnm env --use-on-cd --shell fish | source
```

- Existing Visual Studio Code integrated terminals should be reopened after changing `config.fish`.
- The repository's `.node-version`, `engines.node`, lockfile, and `packageManager` field become the authoritative project runtime/tooling contract after development begins.

---

# 35. Change Log

| Version | Date | Description |
|---|---|---|
| 1.0 | August 7, 2026 | Initial development prerequisites for the Philippine Public-Sector HRIS technology stack |
| 1.1 | August 8, 2026 | Replaced the workstation-wide Node.js 24 requirement with `fnm`-managed per-project Node.js 24 LTS; added Fish automatic switching, `.node-version`, multi-Node workflow, and updated installation/verification steps |
