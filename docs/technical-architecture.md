# Philippine Public-Sector HRIS
## Technical Stack and Architecture Specification

**Document status:** Draft v0.3  
**Project type:** Solo-developer modular SaaS / deployable HRIS platform  
**Architecture:** Multi-tenant modular monolith  
**Product scope:** Philippine Public-Sector HRIS  
**Last updated:** August 7, 2026  

---

# 1. Project Overview

The project is a cloud-based Philippine Public-Sector Human Resource Information System with controlled AI capabilities.

The platform is designed specifically for civilian Philippine public-sector HR operations, with the initial implementation profile centered on a National Government Agency and extensibility for compatible public-sector agency profiles.

Its major domains are:

- agency and user management;
- organization structure and plantilla;
- qualification standards;
- recruitment and merit selection;
- appointments and assumption to duty;
- PDS, employee master, service records, and personnel actions;
- attendance and DTR;
- leave credits and applications;
- overtime, COC, and CTO;
- government payroll;
- SPMS;
- separation and clearance;
- approvals;
- documents;
- reporting;
- audit;
- controlled AI assistance.

The product begins as a **modular monolith**, not microservices. The web, API, and worker run as separate processes while remaining in one repository and sharing one coordinated domain model.

---

# 2. Project Goals

The architecture should:

1. Be manageable by one developer.
2. Support an MVP without excessive infrastructure.
3. Preserve personnel, payroll, entitlement, document, and audit integrity.
4. Isolate multiple organizations or agencies securely.
5. Provide granular permissions and record scopes.
6. Maintain complete historical and audit records.
7. Support effective-dated policies and records.
8. Keep authoritative business outcomes deterministic and testable.
9. Allow controlled AI without unrestricted database access.
10. Permit future service extraction only when operational scale justifies it.
11. Minimize languages and infrastructure products.
12. Keep hosting and maintenance predictable.
13. Keep private- and public-sector rules explicitly separated.
13. Allow agency rules, forms, and rates to be versioned rather than permanently hard-coded.

---

# 3. Initial Non-Goals

The current implementation will not include:

- Kubernetes;
- independently deployed microservices;
- event sourcing for every module;
- arbitrary user-authored workflow scripting;
- autonomous AI approval of authoritative transactions;
- military or uniformed-service HR rules;
- judiciary-specific personnel rules;
- elective or barangay-specific personnel rules;
- all special-law benefits in the first public-sector release;
- biometric-device integration in the public-sector HRIS MVP;
- biometric attendance-file imports in the public-sector HRIS MVP;
- full administrative-case management;
- full L&D management;
- full PRAISE/rewards management;
- complete retirement-benefit calculation;
- applicant self-service in the first HRIS MVP.

---

# 4. Architecture Summary

```text
Users
  │
  ▼
Next.js Web Application
  │
  │ HTTPS / REST
  ▼
NestJS API
  │
  ├── PostgreSQL
  ├── Redis
  ├── S3-Compatible File Storage
  ├── OpenAI API
  └── Email / External Integrations
           │
           ▼
      BullMQ Worker Process
```

## Web process

Responsible for UI, navigation, forms, dashboards, tables, session-aware routing, printable views, protected downloads, and human-review interfaces.

## API process

Responsible for authentication verification, tenant/agency context, authorization, validation, business rules, workflow transitions, database transactions, audit events, AI tool definitions, and API responses.

## Worker process

Responsible for document processing, email delivery, PDF generation, imports/exports, scheduled reports, AI work, webhooks, maintenance, and other retryable long-running jobs.

---

# 5. Approved Technology Stack

| Area | Technology |
|---|---|
| Runtime | Node.js active LTS |
| Language | TypeScript |
| Package manager | pnpm |
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js App Router + React |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Tables | TanStack Table |
| Forms | React Hook Form |
| Validation | Zod |
| Server state | TanStack Query |
| Backend | NestJS |
| API | REST + OpenAPI |
| Database | PostgreSQL |
| ORM | Prisma |
| Vector search | pgvector |
| Queue/cache | Redis + BullMQ |
| Files | S3-compatible object storage |
| AI | OpenAI Responses API behind provider-neutral interface |
| Local infra | Docker Compose |
| CI/CD | GitHub Actions |
| Observability | OpenTelemetry |
| Unit/integration testing | Vitest |
| E2E testing | Playwright |

TypeScript is used throughout the web, API, worker, and shared packages.

Dependency versions are pinned through the lockfile. Major upgrades are intentional and tested.

---

# 6. Frontend Rules

- Server Components should be used for page shells and initial loading where practical.
- Client Components should be used for interactive forms, tables, and dialogs.
- Business rules must not exist exclusively in the frontend.
- Every mutation is revalidated by the API.
- Forms should share Zod schemas with the API where practical.
- Large HRIS lists use server-side pagination, filtering, and sorting.
- Destructive actions require explicit confirmation.
- Sensitive HR and payroll fields are hidden unless authorized.
- Finalized records render read-only unless a formal correction flow exists.
- Public-sector forms and printable outputs use versioned templates.

---

# 7. API Rules

- Base path: `/api/v1`
- JSON is the default request/response format.
- Breaking contracts require an API version change.
- Retryable commands accept idempotency keys.
- Errors use a consistent envelope.
- Database models are never returned directly.
- API responses use explicit DTOs.
- Every request receives a correlation ID.
- Authorization is checked in the API.
- Agency scope is derived from authenticated membership.
- Domain commands validate current state before transition.
- Cross-module writes go through the owning module's application service.
- OpenAPI output is validated in CI.

Example:

```json
{
  "error": {
    "code": "PAYROLL_PERIOD_ALREADY_FINALIZED",
    "message": "A finalized payroll period cannot be edited directly.",
    "requestId": "req_123456"
  }
}
```

---

# 8. Repository Structure

```text
erp-ai/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
│
├── packages/
│   ├── database/
│   ├── contracts/
│   ├── permissions/
│   ├── auth/
│   ├── public-sector-hr/
│   ├── payroll-core/
│   ├── accounting-core/
│   ├── ai-core/
│   ├── ui/
│   ├── observability/
│   ├── test-utils/
│   └── config/
│
├── infrastructure/
│   ├── docker/
│   ├── compose.yaml
│   └── scripts/
│
├── docs/
│   ├── technical-architecture.md
│   ├── database-conventions.md
│   ├── permissions.md
│   ├── ai-safety.md
│   ├── data-model/
│   ├── workflows/
│   └── adr/
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

Shared packages must have a clear owner and must not become general dumping grounds.

---

# 9. Public-Sector Tenant and Agency Terminology

The top-level isolation boundary is an `Agency`.

```text
Tenant concept          = Agency
Membership concept      = AgencyMembership
Database tenant key     = agency_id
```

The architecture may use the generic word `tenant` when discussing multi-tenancy infrastructure, but public-sector domain models, APIs, database tables, and documentation should use `Agency` terminology wherever practical.

The initial target is a civilian National Government Agency, with future extensibility for compatible public-sector profiles such as LGU, SUC, or GOCC with original charter, provided their rules are explicitly configured and supported.

---

# 10. Public-Sector HRIS Modules

```text
identity
agencies
memberships
roles
permissions

organization
plantilla
qualification-standards

recruitment
selection
appointments
personnel
pds
service-records

attendance
leave
overtime
coc
cto

payroll
performance
separation
clearance

approvals
documents
notifications
reporting
audit
integrations
ai
```

## Module boundary rule

A module may not directly modify another module's tables without using that module's application service or documented internal contract.

Examples:

- recruitment may request appointment creation but may not insert appointment rows;
- appointment may request personnel activation but may not directly alter payroll;
- leave may create approved payroll inputs but may not edit finalized payroll lines;
- separation may request membership deactivation but may not bypass identity controls.

---

# 11. Database Architecture

PostgreSQL is the primary system of record.

Prisma is used for standard type-safe database operations and normal migrations.

Reviewed SQL migrations are allowed for:

- Row-Level Security;
- exclusion constraints;
- partial unique indexes;
- database functions;
- immutable-record triggers;
- materialized views;
- partitioning;
- advanced reporting;
- pgvector;
- performance-critical queries.

Primary keys use UUID.

For agency-owned records, the normal audit shape is:

```text
id
agency_id
created_at
created_by_membership_id
updated_at
updated_by_membership_id
row_version
```

Rules:

- use `timestamptz` for event timestamps;
- store timestamps in UTC;
- use `date` for legal/calendar dates;
- use `numeric`, not floating point, for money;
- use foreign-key, uniqueness, and check constraints;
- use JSONB only for genuinely flexible or versioned structures;
- preserve issued, certified, posted, and finalized records;
- use optimistic locking for mutable records;
- use idempotency/source references for retryable commands and imports.

Suggested monetary precision:

```text
amount numeric(19,4)
rate numeric(19,8)
```

---

# 12. Multi-Tenancy and Agency Isolation

Initial deployment model:

```text
One PostgreSQL database
One shared schema
agency_id on public-sector agency-owned records
Application authorization
PostgreSQL Row-Level Security
```

Requirements:

- the frontend never supplies the trusted agency ID;
- agency context comes from authenticated membership;
- repository queries run with trusted agency context;
- high-risk tables include direct `agency_id`;
- cross-agency foreign keys are blocked where practical;
- jobs include agency context;
- uploaded files belong to an agency;
- vector search is agency- and permission-filtered;
- cache keys include agency ID;
- audit events include agency ID;
- automated tests attempt cross-agency access.

Example request context:

```ts
interface RequestContext {
  requestId: string;
  userId: string;
  agencyId: string;
  membershipId: string;
  permissions: string[];
}
```

RLS is defense in depth, not a replacement for application authorization.

---

# 12. Authentication and Authorization

Authentication is delegated to a managed OpenID Connect-compatible provider.

The application stores:

- external user ID;
- email;
- application profile;
- agency memberships;
- role assignments;
- permissions;
- session/revocation metadata where required.

Authorization is permission-based and deny-by-default.

Permission convention:

```text
<domain>.<resource>.<action>
```

Examples:

```text
organization.units.read
plantilla.positions.create
recruitment.applications.screen
appointment.records.issue
personnel.pds.read
attendance.records.correct
leave.applications.approve
payroll.periods.prepare
payroll.periods.certify
payroll.periods.approve
payroll.periods.finalize
performance.ratings.finalize
settings.permissions.manage
audit.events.read
ai.features.use
```

Checks may consider:

- agency membership;
- permission;
- own/direct-report/assigned-office/agency scope;
- document status;
- workflow state;
- delegation;
- sensitive-field classification;
- segregation of duties.

---

# 12. Segregation of Duties

High-risk workflows keep important responsibilities separate where configured.

Examples:

```text
Payroll Preparer
≠ HR Certifying Officer
≠ Payroll Approver
≠ Cashier / Disbursing Officer
```

```text
Recruitment Screener
≠ Final Appointing Authority
```

```text
AI Draft Generator
≠ Human Business Approver
```

Actual human decisions are preserved in approval and audit history.

---

# 12. Effective-Dated Records

Public-sector HRIS depends heavily on effective dating.

Examples:

- agency profile;
- organization-unit versions;
- position versions;
- qualification-standard versions;
- service segments;
- personnel actions;
- work schedules;
- schedule assignments;
- leave policies;
- salary schedules;
- pay-component rules;
- delegated authority.

Standard structure:

```text
effective_from
effective_to
status
version_no
```

Historical versions remain available. Current state is a projection over history rather than a replacement for it.

PostgreSQL exclusion constraints may prevent invalid overlapping effective periods.

---

# 12. Immutable Ledgers and Finalized Records

The platform does not use event sourcing for every domain.

However, specific authoritative data is append-only or immutable:

```text
leave_ledger_entries
coc_ledger_entries
approval_decisions
audit_events
issued document versions
finalized payroll lines
finalized performance ratings
```

Rules:

- posted entries cannot be edited;
- corrections use reversals, adjustments, or replacement versions;
- finalized payroll is not silently recalculated;
- historical certified/issued states remain available;
- source references support idempotency.

---

# 12. Public-Sector Payroll Integrity

Payroll is an authoritative subsystem.

Required controls:

- effective-dated salary schedules;
- traceable salary grade and step;
- versioned rules;
- idempotent payroll inputs;
- frozen rule snapshots;
- reproducible calculations;
- detailed payroll lines;
- employee and period reconciliation;
- blocking exceptions;
- separate preparation, certification, approval, and disbursement;
- immutable finalized results;
- linked correction transactions.

Finalization:

```text
Validate payroll state
→ Validate rule snapshot
→ Validate employee results
→ Resolve blocking exceptions
→ Verify reconciliation
→ Finalize results
→ Finalize payroll period
→ Create audit/outbox records
```

AI cannot determine or write authoritative payroll results.

---

# 12. Attendance, Leave, Overtime, COC, and CTO Integrity

## Attendance

MVP attendance sources:

```text
WEB_CLOCK
MANUAL
```

Raw events are immutable. Corrections create replacement events or controlled adjustments. Locked periods are never directly edited.

## Leave

Leave uses an immutable ledger with entry types such as:

```text
OPENING
EARNED
USED
ADJUSTMENT
RESTORATION
MONETIZATION
TERMINAL
REVERSAL
```

## Overtime

Keep distinct:

```text
requested hours
authorized hours
rendered hours
validated hours
certified hours
compensated hours
```

## COC and CTO

COC uses an immutable ledger. CTO consumption requires sufficient available COC and creates an attendance effect through domain services.

---

# 12. Background Jobs and Transactional Outbox

Redis and BullMQ handle asynchronous work.

Initial queues:

```text
emails
document-processing
imports
exports
pdf-generation
ai-processing
report-generation
webhooks
maintenance
```

Every job includes agency/tenant context, stable type, versioned payload, idempotency behavior, retry policy, and observable failure handling.

Use a transactional outbox:

```text
Domain transaction
→ Write authoritative state
→ Write outbox event
→ Commit
→ Worker performs external effect
```

Do not call email, file, or AI providers inside authoritative database transactions.

---

# 12. File and Document Storage

S3-compatible object storage is used for:

- PDS and personnel documents;
- appointment documents;
- vacancy records;
- leave evidence;
- DTR outputs;
- payroll reports and payslips;
- clearance documents;
- SPMS evidence;
- official forms;
- policies;
- imports and exports.

The database stores metadata, not file bytes.

Requirements:

- opaque storage keys;
- short-lived signed URLs;
- agency and permission checks;
- file type/size validation;
- server-side upload verification;
- document classification;
- version history;
- retention metadata;
- no public access to confidential documents.

---

# 12. Approval Architecture

Approvals are shared workflow infrastructure.

The approval engine stores:

- route version;
- subject reference;
- approval steps;
- assigned approvers;
- decisions;
- delegation;
- completion state.

The approval engine does not own the final domain effect.

Example:

```text
Approval request says APPROVED
        ↓
Owning domain revalidates business rules
        ↓
Owning domain performs authoritative transaction
```

This applies to leave, payroll, appointments, personnel actions, and other controlled workflows.

---

# 12. AI Architecture

The first provider uses the OpenAI Responses API behind an internal provider-neutral interface.

AI may:

- summarize records;
- review PDS completeness;
- summarize applicant documents;
- assist qualification screening;
- draft personnel actions;
- explain payroll exceptions;
- draft reports;
- search approved policies;
- identify possible duplicate records;
- create approval summaries;
- draft professional messages;
- classify and extract documents.

AI may not autonomously:

- select an applicant;
- issue an appointment;
- approve leave;
- certify attendance;
- change leave or COC balances;
- finalize payroll;
- change salary grades or steps;
- release payroll payments;
- effectuate personnel actions;
- finalize performance ratings;
- change permissions;
- override validation;
- delete authoritative records;
- bypass segregation of duties.

Tool pattern:

```text
User request
→ AI interpretation
→ Approved tool request
→ API agency/permission check
→ API record-scope check
→ Domain validation
→ Minimum necessary tool result
→ AI draft/explanation
→ Human review
→ Normal domain workflow
```

Forbidden generic tools include:

```text
execute_sql
update_any_record
delete_any_record
approve_anything
finalize_any_payroll
change_any_salary
```

All structured AI output is schema-validated.

The system minimizes personal data, records prompt/model versions, supports agency-level AI disablement, tracks usage/cost, and records human acceptance/edit/rejection.

---

# 12. Vector Search

Initial vector search uses pgvector in PostgreSQL.

Potential public-sector uses:

- agency HR policies;
- staffing manuals;
- payroll references;
- leave guidance;
- SPMS guidance;
- internal procedures;
- help documentation.

Queries must apply agency, document-permission, classification, and record-scope filtering before content reaches an AI prompt.

A dedicated vector database is not introduced until PostgreSQL is proven insufficient.

---

# 12. Audit Logging

Business audit records and operational logs remain separate.

A business audit event should contain:

```text
id
agency_id
actor_membership_id
actor_type
action
entity_type
entity_id
previous_status
new_status
reason
request_id
occurred_at
sanitized metadata
```

Audit events are required for:

- security events;
- role/permission changes;
- approvals/rejections;
- appointment actions;
- personnel actions;
- attendance corrections;
- leave/COC posting and reversal;
- payroll certification/finalization/adjustments;
- final performance ratings;
- separation effectuation;
- imports/exports;
- access to highly sensitive records where required;
- AI-assisted actions;
- configuration changes.

Audit records are append-only for normal application roles.

---

# 12. Observability

OpenTelemetry is used for traces and metrics.

Every request should record:

- request ID;
- agency ID;
- route;
- user/membership where appropriate;
- response status;
- duration;
- database timing;
- queue activity;
- external API timing.

AI telemetry includes:

- feature;
- prompt version;
- provider;
- model;
- latency;
- token usage;
- estimated cost;
- tool calls;
- result status;
- human acceptance/edit/rejection.

Sensitive prompt content must not be placed in normal logs.

---

# 12. Local Development

Docker Compose provides:

```text
PostgreSQL with pgvector
Redis
S3-compatible object storage
Mail testing server
Optional OpenTelemetry collector
```

Example:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_DB: erp
      POSTGRES_USER: erp_local
      POSTGRES_PASSWORD: local_only
    ports:
      - "55432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

Local credentials are never reused in production.

---

# 12. Deployment Strategy

Initial production deployment favors managed infrastructure:

```text
Web application        Managed Node.js hosting
API                    Managed container or Node.js hosting
Worker                 Managed container worker
PostgreSQL             Managed PostgreSQL
Redis                  Managed Redis
Files                  Managed S3-compatible storage
Email                  Transactional email provider
Monitoring             Managed telemetry/error platform
```

Environments:

```text
development
staging
production
```

Each environment uses separate databases, buckets, Redis, credentials, encryption keys, and authentication applications.

Kubernetes is not required initially.

---

# 12. CI/CD

GitHub Actions performs:

```text
Install dependencies
→ Check formatting
→ Lint
→ Type-check
→ Unit tests
→ Integration tests
→ RLS/constraint tests
→ Build
→ Validate migrations
→ Deploy
→ Smoke tests
```

Production migrations must be reviewed, tested, and include rollback or corrective planning. Direct schema changes in production are prohibited.

---

# 12. Testing Strategy

## Unit tests

Required for:

- permissions;
- workflow transitions;
- effective-date calculations;
- attendance;
- leave;
- COC;
- payroll calculations;
- contribution/tax rule interfaces;
- rounding;
- reconciliation;
- AI output validation.

## Integration tests

Required for:

- transactions;
- RLS;
- cross-agency isolation;
- agency-safe foreign keys;
- position incumbency;
- service overlap;
- attendance locking;
- ledger immutability;
- payroll finalization;
- file permissions;
- worker retries;
- approval/domain integration.

## End-to-end tests

First critical path:

```text
Create agency
→ Invite HR administrator
→ Accept invitation
→ Login
→ Assign role
→ Create organization unit
→ Verify audit event
→ Verify another agency cannot access it
```

Later critical paths cover recruitment, appointment, assumption, personnel, attendance, leave, overtime, payroll, SPMS, and separation.

## AI tests

Maintain fixed evaluation datasets containing normal, incomplete, conflicting, malformed, unrelated, and prompt-injection cases.

---

# 12. Security Baseline

Required controls:

- deny-by-default authorization;
- API permission checks;
- tenant filtering at application and database layers;
- RLS;
- agency-safe foreign keys where practical;
- rate limiting;
- secure cookies;
- CSRF protection where applicable;
- content security policy;
- input validation;
- secure upload validation;
- encryption in transit;
- managed secrets;
- sensitive-field encryption;
- dependency scanning;
- audit logging;
- backup testing;
- account abuse protection;
- MFA support through identity provider;
- signed file URLs;
- session revocation;
- segregation-of-duties checks;
- secure exports;
- AI redaction and human review.

Production secrets are never stored in the repository.

---

# 12. Environment Variables

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

Processes validate required configuration on startup and fail fast when production values are missing.

---

# 12. Public-Sector HRIS Implementation Phases

## Phase 1 — Repository and Infrastructure

- monorepo;
- Docker development environment;
- PostgreSQL;
- Redis;
- object storage;
- config validation;
- CI;
- health checks;
- observability.

## Phase 2 — Identity and Agency Isolation

- users;
- agencies;
- memberships;
- invitations;
- roles;
- permissions;
- sessions;
- RLS;
- audit foundation.

## Phase 3 — First Vertical Slice

```text
Create agency
→ Invite HR administrator
→ Accept invitation
→ Login
→ Assign role
→ Protected dashboard
→ Create organization unit
→ View audit event
```

## Phase 4 — Organization and Plantilla

- organization hierarchy;
- qualification standards;
- plantilla positions;
- position history;
- staffing authorities.

## Phase 5 — Personnel Core

- employee master;
- PDS;
- protected identifiers;
- service segments;
- personnel actions;
- incumbencies;
- service records.

## Phase 6 — Recruitment and Appointment

- request to fill;
- vacancy publication;
- applicant/application;
- screening;
- assessment;
- interview;
- HRMPSB deliberation;
- selection;
- appointment;
- oath;
- assumption to duty.

## Phase 7 — Attendance and Leave

- schedules;
- attendance;
- exceptions;
- corrections;
- DTR;
- leave policies;
- leave accounts;
- leave ledger;
- applications;
- monetization.

## Phase 8 — Overtime, COC, and CTO

- authority;
- employee coverage;
- rendered service;
- certification;
- compensation decision;
- COC ledger;
- CTO.

## Phase 9 — Government Payroll

- salary schedules;
- pay components;
- compensation assignments;
- payroll inputs;
- payroll periods;
- calculations;
- contributions;
- tax;
- deductions;
- exceptions;
- certification;
- approval;
- finalization;
- payslips;
- remittance/payment outputs.

## Phase 10 — SPMS and Separation

- performance cycles;
- commitments;
- accomplishments;
- reviews;
- ratings;
- separation;
- clearance;
- service/access closure.

## Phase 11 — AI-Assisted Features

- PDS completeness review;
- applicant-document summarization;
- qualification-screening assistance;
- personnel-action drafting;
- payroll-exception explanation;
- policy search;
- HR report narrative drafting.

## Phase 12 — Hardening and Pilot

- backup/restore drills;
- performance tests;
- security review;
- AI evaluation;
- master-data validation;
- payroll parallel run;
- report comparison;
- pilot agency;
- controlled rollout.

---

# 12. Public-Sector HRIS MVP Boundary

The MVP is complete when an agency can:

1. Initialize an agency workspace.
2. Add users with agency-specific roles and permissions.
3. Maintain organization units.
4. Maintain qualification standards.
5. Maintain plantilla positions.
6. Maintain employee and PDS records.
7. Preserve service history and personnel actions.
8. Run recruitment and merit-selection workflows.
9. Issue and track appointments.
10. Record oath and assumption to duty.
11. Maintain attendance and DTR.
12. Manage leave credits and applications.
13. Manage overtime, COC, and CTO.
14. Calculate controlled government payroll.
15. Produce payroll results and payslips.
16. Manage SPMS commitments and ratings.
17. Process separation and clearance.
18. Generate key reports and documents.
19. Maintain a complete audit trail.
20. Use approved AI assistance with human review.

The MVP does not guarantee regulatory accreditation and does not eliminate agency-specific policy review.

---

# 12. Definition of Done

A feature is complete only when it has:

- business requirements;
- permission definitions;
- workflow states;
- input validation;
- agency isolation;
- database migration;
- database constraints;
- transactional rules;
- audit events;
- error handling;
- unit tests;
- integration tests;
- critical E2E coverage where appropriate;
- documentation;
- observability;
- loading and empty states;
- accessibility review;
- migration/rollback considerations;
- sensitive-data review.

Ledger/finalized features additionally require:

- immutability tests;
- correction/reversal flow;
- reconciliation tests.

AI features additionally require:

- structured output schema;
- prompt version;
- evaluation cases;
- cost tracking;
- redaction review;
- failure fallback;
- human-review behavior;
- source/reference tracking.

---

# 12. Architecture Decisions

## ADR-001 — Modular Monolith

**Decision:** Keep business modules in one codebase and database.

**Reason:** Lower deployment, debugging, and transaction complexity for a solo developer.

## ADR-002 — REST

**Decision:** Use versioned REST APIs with OpenAPI.

**Reason:** HRIS commands and resources map naturally to REST with lower tooling overhead.

## ADR-003 — PostgreSQL System of Record

**Decision:** Store authoritative personnel, payroll, tenant, workflow, audit, and financial data in PostgreSQL.

**Reason:** Strong transactions, constraints, history, and relational reporting are required.

## ADR-004 — AI Outside Authoritative Rules

**Decision:** AI interprets and proposes; deterministic application code validates and writes authoritative outcomes.

**Reason:** HR, payroll, appointment, selection, and financial results must remain reproducible and auditable.

## ADR-005 — pgvector Before Dedicated Vector Database

**Decision:** Use pgvector first.

**Reason:** Avoid another production database until PostgreSQL is insufficient.

## ADR-006 — Managed Authentication

**Decision:** Delegate authentication to an OIDC-compatible provider.

**Reason:** Initial effort should focus on HRIS rather than identity infrastructure.

## ADR-007 — Agency as Public-Sector Tenant Boundary

**Decision:** Use `Agency` and `agency_id` as the public-sector domain tenant boundary.

**Reason:** It matches government HR terminology while retaining a multi-tenant platform architecture.

## ADR-008 — Effective-Dated History

**Decision:** Version organization, position, service, policy, schedule, salary, and related records.

**Reason:** Historical decisions must be explainable using the rules and structure that applied at the time.

## ADR-009 — Immutable Ledgers

**Decision:** Leave, COC, audit, approvals, and finalized payroll use append-only or immutable records.

**Reason:** Corrections must preserve prior truth.

## ADR-010 — Public-Sector Rules Remain Explicit and Effective-Dated

**Decision:** Public-sector HR, payroll, leave, appointment, staffing, and performance rules are implemented explicitly and versioned by effective date or agency profile where appropriate.

**Reason:** Government rules, forms, rates, and agency policies change over time and must remain historically reproducible.

---

# 12. Final Stack

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

The stack remains stable until an actual operational requirement justifies another framework, database, language, or infrastructure platform.

---

# 12. Current Development Entry Point

Planning/design artifacts now establish:

```text
BRD
→ workflows
→ controls and permissions
→ conceptual ERD
→ logical ERDs
→ physical schema
→ development sequence
```

Implementation begins with:

```text
Repository scaffold
→ Local infrastructure
→ Identity and agency migration
→ Authentication
→ RLS
→ Permission guards
→ First protected vertical slice
```

The first meaningful milestone is:

> An authorized user can enter an agency, access a protected dashboard, create an organization unit, and see the action recorded in the audit trail while another agency is unable to access that record.

---

# 12. Change Log

| Version | Date | Description |
|---|---|---|
| 0.1 | August 2, 2026 | Initial general AI-enabled ERP architecture |
| 0.2 | August 7, 2026 | Reframed architecture around the Philippine Public-Sector HRIS implementation |
| 0.3 | August 7, 2026 | Narrowed the architecture to an exclusive Philippine Public-Sector HRIS scope and aligned terminology, modules, and architecture decisions accordingly |
