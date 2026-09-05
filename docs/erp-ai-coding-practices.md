# AI-Enabled ERP Coding Practices

**Status:** Approved baseline  
**Project:** Solo-developer, multi-tenant ERP with AI features  
**Architecture:** Modular monolith  
**Updated:** August 2, 2026  

---

## 1. Rule Categories

Each rule in this document belongs to one of these categories:

| Label | Meaning |
|---|---|
| **Framework Standard** | Consistent with the intended use of the technology |
| **Security Requirement** | Required to protect tenants, credentials, and sensitive data |
| **ERP Integrity Rule** | Required for accounting, inventory, approvals, and audit correctness |
| **Project Convention** | A deliberate standard for this project |

---

## 2. Core Principles

1. **PostgreSQL is the system of record.**
2. **AI may propose actions, but normal ERP services execute them.**
3. **Prefer explicit modules and workflows over highly dynamic behavior.**
4. **Use a modular monolith until a real scaling need justifies separation.**
5. **Validate all untrusted data at runtime.**
6. **Deny access by default.**
7. **Treat posted financial records as immutable.**
8. **Every tenant-owned operation must carry trusted tenant context.**
9. **Use transactions for money-changing and stock-changing workflows.**
10. **Test critical rules against a real PostgreSQL instance.**

---

## 3. Repository Structure

```text
erp-ai/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── permissions/
│   ├── accounting-core/
│   ├── inventory-core/
│   ├── ai-core/
│   ├── ui/
│   ├── observability/
│   ├── test-utils/
│   └── config/
├── infrastructure/
│   ├── compose.yaml
│   └── scripts/
└── docs/
    ├── technical-architecture.md
    ├── coding-practices.md
    ├── database-conventions.md
    ├── permissions.md
    ├── ai-safety.md
    └── adr/
```

### Dependency direction

**Project Convention**

```text
apps → packages
```

Packages must not import applications. Domain packages such as `accounting-core` and `inventory-core` must not depend on Next.js or React.

---

# 4. TypeScript

## Standards

- Enable strict mode.
- Prefer `unknown` over `any` for untrusted input.
- Use discriminated unions for workflow results.
- Prefer literal unions over TypeScript enums for shared contracts.
- Keep functions focused and explicit.
- Avoid unclear boolean arguments.
- Export public package APIs through `index.ts`.

Recommended compiler options:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Naming

| Item | Convention | Example |
|---|---|---|
| Files | kebab-case | `post-invoice.service.ts` |
| Classes | PascalCase | `PostInvoiceService` |
| Functions | camelCase | `calculateInvoiceTotal` |
| Constants | UPPER_SNAKE_CASE | `MAX_IMPORT_ROWS` |
| API fields | camelCase | `tenantId` |
| Database fields | snake_case | `tenant_id` |
| Permissions | dot notation | `sales.invoices.post` |
| Queue names | kebab-case | `document-processing` |

---

# 5. pnpm and Turborepo

- Use pnpm only; do not mix package managers.
- Commit `pnpm-lock.yaml`.
- Use `workspace:*` for internal packages.
- Pin the package manager version in `package.json`.
- Define `build`, `lint`, `typecheck`, `test`, and `test:e2e` tasks.
- Avoid adding dependencies for trivial utilities.
- Remove unused packages regularly.

---

# 6. Next.js App Router

## Server and Client Components

**Framework Standard**

Use Server Components by default for:

- layouts;
- route pages;
- initial data loading;
- permission-aware navigation;
- server-only configuration.

Use Client Components only for:

- event handlers;
- local UI state;
- browser APIs;
- dialogs;
- interactive tables;
- complex forms.

Keep `"use client"` boundaries narrow.

## Backend boundary

**Project Convention**

NestJS is the authoritative business API.

- React components must not access Prisma.
- Client Components must never access PostgreSQL directly.
- Next.js Server Actions may act as UI adapters, but must not become a second business layer.
- Authoritative validation must run in the API.

## UI states

Every data screen must handle:

- loading;
- empty data;
- validation failure;
- permission denied;
- server failure;
- stale updates;
- not found.

Never expose secrets using `NEXT_PUBLIC_*`.

---

# 7. React

- Keep business rules out of components.
- Use local state for transient UI state.
- Use URL parameters for shareable filters.
- Use TanStack Query for server state.
- Prefer composition over universal configuration-heavy components.
- Use semantic HTML and keyboard-accessible controls.
- Do not use hidden buttons as authorization.

---

# 8. Tailwind CSS and shadcn/ui

- Reuse design tokens.
- Avoid repeated arbitrary CSS values.
- Extract repeated layouts into components.
- Keep shadcn/ui components as project-owned source.
- Preserve accessibility when modifying components.
- Centralize shared ERP variants.
- Never depend on CSS visibility for security.

---

# 9. TanStack Table

Large ERP tables must use server-side:

- pagination;
- sorting;
- filtering;
- search.

Examples include invoices, journal entries, payments, inventory movements, and audit events.

Bulk actions must be revalidated on the server for every selected record. Invalid records should return detailed partial-failure results.

---

# 10. TanStack Query

Use structured query keys:

```ts
export const invoiceKeys = {
  all: ["invoices"] as const,
  lists: () => [...invoiceKeys.all, "list"] as const,
  list: (filters: InvoiceFilters) =>
    [...invoiceKeys.lists(), filters] as const,
  detail: (id: string) =>
    [...invoiceKeys.all, "detail", id] as const,
};
```

After mutations:

- invalidate only affected data;
- show server validation messages;
- use optimistic updates only when rollback is reliable;
- never assume success before server confirmation.

---

# 11. React Hook Form

Use React Hook Form with Zod.

```ts
const form = useForm<CreateInvoiceInput>({
  resolver: zodResolver(createInvoiceSchema),
  defaultValues: {
    currencyCode: "PHP",
    lines: [],
  },
});
```

Forms must:

- prevent duplicate submission;
- display field-level errors;
- preserve data after recoverable failures;
- confirm destructive actions;
- warn about unsaved changes where appropriate;
- handle money without floating-point assumptions.

---

# 12. Zod

## Boundary validation

**Security Requirement**

Validate:

- API request bodies;
- route and query parameters;
- environment variables;
- queue payloads;
- webhook payloads;
- CSV and spreadsheet rows;
- imported JSON;
- AI structured output;
- third-party API responses where practical.

```ts
export const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  invoiceDate: z.string().date(),
  currencyCode: z.string().length(3),
  lines: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.coerce.number().positive(),
      unitPrice: z.coerce.number().nonnegative(),
    }),
  ).min(1),
});

export type CreateInvoiceInput =
  z.infer<typeof createInvoiceSchema>;
```

Use Zod for structure and basic constraints. Keep business rules in services.

Zod should answer:

- Is the value present?
- Is it the expected type?
- Is the number positive?
- Is the identifier valid?

Application services should answer:

- Does the record belong to the tenant?
- Is the accounting period open?
- Can this user approve the amount?
- Is the workflow state valid?

Always validate AI output even when structured output is requested.

---

# 13. NestJS

## Domain organization

```text
modules/
├── customers/
├── suppliers/
├── products/
├── sales/
├── purchasing/
├── inventory/
├── accounting/
├── payments/
├── approvals/
├── audit/
└── ai/
```

## Responsibilities

- **Controllers:** HTTP transport only.
- **Guards:** authentication and authorization.
- **Pipes:** validation and transformation.
- **Interceptors:** cross-cutting behavior.
- **Exception filters:** consistent API errors.
- **Application services:** use-case coordination.
- **Domain services:** reusable business rules.
- **Repositories/query services:** persistence.

Example controller:

```ts
@Controller("invoices")
export class InvoiceController {
  constructor(
    private readonly postInvoice: PostInvoiceService,
  ) {}

  @Post(":id/post")
  @RequirePermission("sales.invoices.post")
  post(
    @CurrentContext() context: RequestContext,
    @Param("id") invoiceId: string,
  ) {
    return this.postInvoice.execute(context, invoiceId);
  }
}
```

Do not create a separate class for every trivial read. Simple module-local CRUD may use a module-owned query service.

## Request context

```ts
interface RequestContext {
  requestId: string;
  userId: string;
  tenantId: string;
  membershipId: string;
  permissions: string[];
}
```

The server must derive `tenantId` from authenticated membership, not from trusted client input.

---

# 14. REST and OpenAPI

Use `/api/v1`.

Normal resources:

```text
GET    /api/v1/customers
POST   /api/v1/customers
GET    /api/v1/customers/:id
PATCH  /api/v1/customers/:id
```

Workflow commands:

```text
POST /api/v1/invoices/:id/approve
POST /api/v1/invoices/:id/post
POST /api/v1/invoices/:id/void
```

Use explicit command endpoints for important state transitions.

Requirements:

- stable error codes;
- pagination on list endpoints;
- idempotency for retryable operations;
- OpenAPI request and response schemas;
- documented authentication and error responses;
- no direct return of database models.

---

# 15. PostgreSQL

## Core rules

**ERP Integrity Rule**

- Use UUID primary keys.
- Use `timestamptz` and store UTC.
- Use `numeric`, never floating point, for money.
- Use foreign keys, unique constraints, and check constraints.
- Keep core ERP records relational.
- Use JSONB only for flexible metadata.
- Treat posted accounting records as immutable.
- Keep transactions short.
- Do not call external APIs inside database transactions.

Recommended money fields:

```sql
amount numeric(19,4)
currency_code char(3)
exchange_rate numeric(19,8)
base_amount numeric(19,4)
```

## Multi-tenancy

Use:

- `tenant_id` on tenant-owned records;
- application authorization;
- PostgreSQL Row-Level Security as defense in depth;
- a runtime role without table ownership or `BYPASSRLS`;
- cross-tenant integration tests.

## Indexing

Create indexes based on actual query patterns. Multi-tenant indexes often begin with `tenant_id`.

```sql
CREATE INDEX idx_invoice_tenant_status_date
ON sales_invoices (
  tenant_id,
  status,
  invoice_date
);
```

## Concurrency

Use transactions, row locks, advisory locks, or optimistic versioning where required for:

- document numbering;
- inventory reservation;
- payment allocation;
- period closing;
- approval transitions.

---

# 16. Prisma

Prisma is a productivity tool, not the authority over database design.

Use Prisma for:

- routine CRUD;
- relations;
- transactions;
- generated types;
- migrations.

Use reviewed raw SQL for:

- Row-Level Security;
- complex accounting reports;
- materialized views;
- recursive queries;
- PostgreSQL functions;
- advanced indexes;
- specialized pgvector queries.

## Access rules

Database access must remain inside the owning NestJS module.

Not allowed:

- Prisma in React components;
- Prisma in controllers;
- Prisma in unrelated modules.

Use repositories for complex, reusable, or domain-sensitive persistence. Do not create empty wrappers around every trivial query.

## Query rules

- Always scope tenant-owned queries by tenant.
- Select only required fields.
- Avoid unbounded `findMany`.
- Use stable ordering and pagination.
- Avoid N+1 queries.
- Preserve decimal precision.

## Migrations

- Commit migration files.
- Review generated SQL.
- Never use `prisma db push` in production.
- Test migrations on realistic data.
- Use expand-and-contract changes.
- Document rollback or correction steps.

---

# 17. pgvector

- Filter every vector query by tenant and permission.
- Similarity does not grant access.
- Store useful chunk metadata such as document type, section, page, and version.
- Retrieve a limited number of chunks.
- Cite the source document in AI answers.
- Treat retrieved document text as untrusted input.
- Do not allow document content to override application instructions.

---

# 18. Redis

Redis may be used for:

- BullMQ;
- short-lived caching;
- rate limiting;
- temporary coordination.

Redis is not the authoritative store for accounting, payment, or inventory records.

Cache keys must include tenant context:

```text
tenant:{tenantId}:customer:{customerId}
```

Use explicit expiration and simple invalidation. Do not introduce caching before measurement justifies it.

---

# 19. BullMQ

Add BullMQ when asynchronous workflows appear, such as:

- AI document extraction;
- large imports;
- PDF generation;
- email delivery;
- report generation;
- external synchronization;
- webhook processing.

## Job payloads

Validate every job with Zod.

```ts
const documentJobSchema = z.object({
  version: z.literal(1),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
});
```

## Idempotency

**ERP Integrity Rule**

Assume a job may run more than once.

Use:

- stable idempotency keys;
- database uniqueness constraints;
- processed-job records;
- source-document references;
- transactional completion markers.

Do not rely only on the BullMQ job ID.

## Retries

Retry temporary failures:

- timeouts;
- rate limits;
- temporary external outages.

Do not repeatedly retry permanent failures:

- invalid payloads;
- missing tenant;
- rejected business rules;
- unsupported file types.

Workers must be stateless, observable, tenant-aware, and safe to shut down gracefully.

---

# 20. S3-Compatible Object Storage

- Store file bytes in object storage.
- Store metadata in PostgreSQL.
- Keep objects private by default.
- Use generated object keys rather than user filenames.
- Validate type, size, checksum, and upload completion.
- Check tenant permission before issuing a short-lived signed URL.

Recommended key:

```text
tenant/{tenantId}/documents/{documentId}/original
```

---

# 21. OpenAI Integration

## Centralized access

All model calls must pass through `ai-core` or the NestJS AI module.

```text
Business module
    ↓
AI application service
    ↓
Provider interface
    ↓
OpenAI SDK
```

## Structured output

- Use strict schemas.
- Validate final output with Zod.
- Version prompts, tools, and schemas.
- Record model name, latency, token usage, cost, and outcome.
- Minimize the data sent to the provider.
- Never send passwords, secrets, tokens, or unrelated records.

## Tool design

Allowed examples:

```text
search_customers
get_unpaid_invoices
draft_purchase_order
summarize_sales
propose_journal_entry
```

Forbidden examples:

```text
execute_sql
update_any_record
delete_any_record
approve_any_payment
post_any_journal
change_permissions
```

Every tool call must independently validate:

- user;
- tenant;
- permission;
- record visibility;
- input schema;
- business rules;
- approval requirements.

Human review is mandatory before sensitive writes.

---

# 22. Docker Compose

Use Docker Compose for local infrastructure:

- PostgreSQL with pgvector;
- Redis;
- S3-compatible storage;
- test email server;
- optional OpenTelemetry collector.

Practices:

- pin meaningful image versions;
- define health checks;
- do not use local credentials in production;
- do not treat local Compose as the complete production architecture.

---

# 23. GitHub Actions

Required CI steps:

```text
Install
  ↓
Format check
  ↓
Lint
  ↓
Type check
  ↓
Build
  ↓
Start local infrastructure
  ↓
Migration validation
  ↓
Unit tests
  ↓
Integration tests
  ↓
Browser acceptance tests
```

Production deployments must use:

- protected environments;
- restricted secrets;
- controlled migrations;
- deployment records;
- smoke tests;
- rollback or corrective plans.

---

# 24. OpenTelemetry and Logging

Every request and job should carry a request or correlation ID.

Trace:

- HTTP requests;
- database operations where useful;
- queue production and processing;
- AI calls;
- object storage;
- external integrations.

Use structured JSON logs.

Never log:

- passwords;
- access tokens;
- API keys;
- session cookies;
- database URLs;
- complete sensitive documents;
- unrestricted AI prompts containing private data.

Business audit records are separate from operational logs.

---

# 25. Vitest

Unit-test observable behavior rather than private implementation details.

Critical unit-test targets:

- invoice totals;
- tax calculations;
- journal balancing;
- rounding;
- approval limits;
- inventory movement rules;
- permission policies;
- AI output validation.

Use Vitest projects for monorepo applications and packages.

---

# 26. PostgreSQL Integration Tests

Use a real PostgreSQL instance for:

- Prisma queries;
- migrations;
- transactions;
- constraints;
- Row-Level Security;
- raw SQL;
- accounting posting;
- tenant isolation.

Required isolation tests:

- Tenant A can read its own records.
- Tenant A cannot read or modify Tenant B records.
- workers cannot process data across tenants;
- vector retrieval cannot cross tenants.

Test rollback by forcing an error midway through a posting operation and confirming no partial writes remain.

---

# 27. Playwright

Test user-visible behavior using accessible locators:

```ts
page.getByRole("button", {
  name: "Post invoice",
});
```

Practices:

- use `getByRole`, `getByLabel`, and `getByText`;
- avoid fragile CSS and XPath selectors;
- use web-first assertions;
- avoid arbitrary sleep statements;
- keep tests independent;
- create deterministic fixtures.

Critical workflows include organization setup, permissions, customers, products, invoice posting, payments, journal viewing, document upload, AI review, and tenant isolation.

---

# 28. Authentication and Authorization

Use a managed OIDC-compatible identity provider.

Security requirements:

- secure and HTTP-only cookies where applicable;
- multifactor authentication support;
- session revocation;
- login event auditing;
- rate limiting and abuse controls.

Authorization rules:

- deny by default;
- check every API operation;
- check record-level access;
- derive tenant from authenticated membership;
- support branch and warehouse scope;
- enforce approval limits;
- support separation of duties.

Hiding a button is not authorization.

---

# 29. Accounting Rules

**ERP Integrity Rule**

- Every posted journal entry must balance.
- Draft entries may be edited.
- Posted entries may not be edited or deleted.
- Corrections use reversals or adjustments.
- Closed periods reject normal posting.
- Source documents link to generated journal entries.
- Duplicate posting is prevented with idempotency.
- Posting logic is deterministic and tested without AI.

---

# 30. Inventory Rules

Inventory is transaction-based.

Every movement records:

- tenant;
- product;
- warehouse;
- quantity;
- unit of measure;
- movement type;
- source document;
- date;
- actor;
- cost information when applicable.

Do not overwrite stock directly. Use adjustment transactions.

Choose and document whether negative stock is allowed, warned, or blocked.

---

# 31. Audit Logging

Audit events should contain:

```text
id
tenant_id
actor_user_id
action
entity_type
entity_id
before
after
reason
request_id
ip_address
user_agent
created_at
```

Required audit events include:

- permission changes;
- approvals and rejections;
- invoice posting and voiding;
- payment actions;
- journal reversals;
- inventory adjustments;
- imports and exports;
- sensitive record access;
- AI-assisted actions;
- configuration changes.

Audit records must be append-only for normal application roles.

---

# 32. Environment Variables

Validate environment variables with Zod at startup.

The process must fail immediately if required production values are missing.

Development, staging, and production must use separate:

- databases;
- Redis instances;
- storage buckets;
- identity applications;
- AI credentials;
- email credentials;
- encryption and session secrets.

---

# 33. Git and ADRs

Use short-lived branches and focused commits.

Good commit messages:

```text
Add invoice posting transaction
Enforce tenant scope on customer queries
Validate AI extraction payload
Add idempotency to payment webhook
```

Create an Architecture Decision Record when changing:

- tenancy model;
- database-access strategy;
- authentication provider;
- queue technology;
- AI provider;
- permission model;
- deployment model;
- accounting posting design.

---

# 34. Definition of Done

A normal feature requires:

- clear use case;
- permission definition;
- runtime validation;
- tenant isolation;
- migration where necessary;
- transaction behavior;
- audit events;
- error handling;
- unit tests;
- integration tests;
- appropriate UI states;
- observability;
- documentation.

An AI feature also requires:

- strict output schema;
- prompt and tool version;
- evaluation cases;
- cost tracking;
- sensitive-data review;
- failure fallback;
- human review.

A background job also requires:

- versioned payload schema;
- idempotency strategy;
- retry policy;
- permanent-failure handling;
- observability;
- graceful shutdown.

---

# 35. Approved Stack

```text
Language and workspace
- TypeScript
- Node.js LTS
- pnpm
- Turborepo

Frontend
- Next.js App Router
- React
- Tailwind CSS
- shadcn/ui
- TanStack Table
- TanStack Query
- React Hook Form
- Zod

Backend
- NestJS
- REST
- OpenAPI

Database
- PostgreSQL
- Prisma ORM
- reviewed raw SQL
- pgvector

Background processing
- Redis
- BullMQ

Files
- S3-compatible object storage

AI
- OpenAI Responses API
- provider-neutral AI layer
- structured output
- controlled tool calling
- human review

Development and operations
- Docker Compose
- GitHub Actions
- OpenTelemetry
- structured logging

Testing
- Vitest
- PostgreSQL integration tests
- Playwright
```

This document is the approved coding baseline. Exceptions are allowed only when documented and justified by a clear engineering or business need.
