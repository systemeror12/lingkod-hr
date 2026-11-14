# Philippine Public-Sector HRIS

## Technical Stack and Architecture Specification

**Document status:** Draft v0.5
**Project type:** Solo-developer modular SaaS / deployable HRIS platform  
**Architecture:** Multi-tenant modular monolith  
**Product scope:** Philippine Public-Sector HRIS  
**Last updated:** September 4, 2026

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
14. Allow agency rules, forms, and rates to be versioned rather than permanently hard-coded.

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

| Area                     | Technology                                             |
| ------------------------ | ------------------------------------------------------ |
| Runtime                  | Node.js active LTS                                     |
| Language                 | TypeScript                                             |
| Package manager          | pnpm                                                   |
| Monorepo                 | pnpm workspaces + Turborepo                            |
| Frontend                 | Next.js App Router + React                             |
| Styling                  | Tailwind CSS                                           |
| Components               | shadcn/ui                                              |
| Tables                   | TanStack Table                                         |
| Forms                    | React Hook Form                                        |
| Validation               | Zod                                                    |
| Server state             | TanStack Query                                         |
| Backend                  | NestJS                                                 |
| API                      | REST + OpenAPI                                         |
| Database                 | PostgreSQL                                             |
| ORM                      | Prisma                                                 |
| Vector search            | pgvector                                               |
| Queue/cache              | Redis + BullMQ                                         |
| Files                    | S3-compatible object storage                           |
| AI                       | OpenAI Responses API behind provider-neutral interface |
| Local infra              | Docker Compose                                         |
| CI/CD                    | GitHub Actions                                         |
| Observability            | OpenTelemetry                                          |
| Unit/integration testing | Vitest                                                 |
| E2E testing              | Playwright                                             |

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
- The PDS editor module owns API-to-form mapping, payload serialization, repeatable-row ordering,
  and post-save reconciliation; PDS rendering consumes that interface.

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
- Request identity is adapted to database context once. Domain modules declare named database
  capabilities, while the database package alone maps those capabilities to PostgreSQL settings.
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

The Documents module owns the universal External Evidence linking rules: Agency scope, exact
Document Version resolution, classification sensitivity, and status/finalization eligibility.
Consuming modules retain their workflow permissions, purpose requirements, and domain-specific
error language.

Examples:

- recruitment may request appointment creation but may not insert appointment rows;
- appointment may request personnel activation but may not directly alter payroll;
- attendance may publish immutable non-monetary facts and adjustment deltas but may not select payroll treatment or edit payroll results;
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

LingkodHR owns login ([ADR 0004](adr/0004-lingkodhr-owned-login.md)). The API verifies passwords and TOTP codes itself and issues `UserSession` directly. No external identity provider or OIDC service sits in the login path.

Credential flows use vetted primitives and never hand-rolled cryptography: Argon2id from `node:crypto` for passwords and Recovery Codes, and a maintained RFC 6238 library for TOTP.

The application stores:

- email;
- application profile;
- one password hash and at most one TOTP factor per User, never per Agency Membership;
- Recovery Code hashes;
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
- work arrangements;
- holiday calendars;
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

Attendance calculation resolves, for one Work Date, qualifying active Appointed Personnel service and exactly one effective Schedule Assignment, Work Schedule Version, Work Arrangement Version, and scoped Holiday Calendar Version. Missing, overlapping, unauthorized, or ambiguous inputs fail closed as an Attendance Exception. The ordinary seeded schedule is never an implicit assignment fallback.

Work Schedule Versions are immutable, authority-bearing definitions containing seven fixed, flexible, or rest Day Rules. Duty and break intervals may cross midnight; the Work Date is the local start date in the version's time zone. A flexible day anchors on the first qualifying worked or Attendance Context minute within its authorized start window, subject to its earliest/latest bounds and required minutes. Raw timestamps keep their seconds, and calculation counts Fully Covered Minutes: a timed Attendance Event or Attendance Context interval covers only the whole minutes it spans completely, so a partial minute at either end stays uncovered. This is a LingkodHR calculation convention (ADR 0005), not a national rule. Event Collection Windows associate events with Work Dates but never act as grace periods or rounding rules.

Work Arrangement Versions define authorized operating mode or place separately from duty time. Holiday Calendars have stable scoped identities and effective-dated versions so annual proclamations and later issuances do not require changing every employee assignment. Holiday classification alone does not erase expected duty; the applicable authority-backed schedule rule supplies the effect.

Raw events are immutable and use `TIME_IN`, `BREAK_OUT`, `BREAK_IN`, and `TIME_OUT`. AM In, AM Out, PM In, and PM Out are ordinary daytime DTR projection slots. Corrections add, replace, or void events or Attendance Context through retained correction records; locked periods are never directly edited.

Attendance Context is an immutable, evidence-backed whole-Work-Date or timed fact entered by an authorized HR Administrator for official business, official travel, training, or approved non-leave absence. It records prior authorization without adding a second Attendance approval workflow. Posted leave reaches Attendance only through Attendance-owned immutable posted-leave inputs that Leave Posting creates through the Attendance application service; Attendance never reads the Leave Ledger.

Each calculation creates an immutable Attendance Day version and non-overlapping Attendance Day Segments. Segments retain source references, expected or outside-schedule relation, coverage or deficit classification, and holiday classification. Summary totals never count overlapping coverage or deficit minutes twice. Outside-schedule and statutory-night-window minutes are factual handoffs only, not compensation authorization.

Attendance lifecycle state belongs to the record whose meaning changes. Attendance Day versions use only `PENDING`, `CALCULATED`, `EXCEPTION`, and `APPROVED`. Employee Attendance Submissions bind one Employee's exact day versions for HR Officer review. Immutable Attendance Period Versions own `FOR_REVIEW`, `APPROVED`, `RETURNED`, and `LOCKED`; the Attendance Period is `OPEN` until its first lock and `FINALIZED` thereafter.

An HR Administrator has the full Attendance permission set and inherits HR Officer access. An HR Officer inherits Employee access and may review, return, and approve attendance within assigned scope. An Employee may submit their own attendance. The HR Officer who approves an Attendance Period Version and the HR Administrator who locks it must be different Agency Memberships.

Lock is the attendance certification and publication transaction. It revalidates the complete applicable Employee and Work Date population, approved current day versions and submissions, unresolved exceptions and corrections, source bindings, routed authority, actor separation, and DTR and payroll-fact reconciliation. It then atomically records the lock, creates immutable Finalized Daily Time Records and an idempotent Attendance Payroll Publication, and appends audit and outbox records. A failure leaves the version `APPROVED` with no partial publication.

Attendance Payroll Facts are exact nonnegative minute quantities by Employee, Work Date, and attendance classification. They retain the source Attendance Day version and holiday classification but contain no rate, money, deduction decision, or target payroll period. Posted leave remains provenance in Attendance while Leave owns its payroll effect. Outside-schedule and statutory-night-window minutes remain separate candidate-hours handoffs to Phase 8.

An Attendance Correction stores an immutable impact preview over every affected Work Date and period. Open-period approval and application are atomic. A locked-period correction requires HR Officer approval and separate HR Administrator authorization, then creates retained correction effects, successor day versions, a grouped Locked Attendance Adjustment, and a complete successor Attendance Period Version. Locking the successor creates new corrected DTRs and an idempotent delta publication; original locked versions and outputs never reopen, change, or disappear.

## Leave

Leave separates policy evaluation, requests, commitments, and posted credits:

```text
Leave Type
  -> immutable effective-dated Leave Policy Versions
  -> fixed evaluator kind and typed parameters

Leave Application
  -> effective-dated Leave Calculation Segments
  -> explainable Leave Eligibility Assessment
  -> immutable Leave Credit Certification where credits apply

Leave Account
  -> active Leave Credit Commitments
  -> immutable signed Leave Ledger Entries
```

A Leave Policy Version is one reproducible agency-scoped bundle. It binds the
applicable national rules, evidence-backed Agency configuration, authority
references, entitlement and calendar bases, optional charged Leave Type,
evidence requirements, and typed evaluator parameters. The Leave domain does
not execute administrator-authored formulas. Missing, ambiguous, or conflicting
required facts return `INDETERMINATE` and block authoritative progression.

Each requested date uses the policy, schedule, and holiday versions effective
on that date. Requests crossing a version boundary remain one application but
produce separate immutable Leave Calculation Segments. The source-prescribed
unit is preserved; calendar-day statutory leave is not silently converted to a
working-day credit debit.

The posted balance is the sum of signed Leave Ledger Entries for an account,
effective date, and ledger knowledge cutoff. An entry stores a unique source
posting key and policy provenance. Its source record owns the business meaning,
such as accrual, leave use, transfer, monetization, forfeiture, or correction, so
the ledger does not duplicate that meaning in an entry-type enum. Reversals
reference and exactly negate their original entry. Posted entries cannot be
edited.

Pending or approved-but-unposted effects use Leave Credit Commitments outside
the ledger. An immutable Leave Credit Certification freezes its effective
balance date, ledger cutoff, posted balance, active commitments, application
quantity, resulting availability, and exact eligibility assessment. Later
backdated facts may alter a new reconstruction but never rewrite the historical
certification.

A Leave Application is a stable case whose submitted facts live in immutable
Leave Application Versions. Each version binds one Leave Submission Attestation,
exact form and supporting Document Versions, an accepted Leave Eligibility
Assessment, and an effective Approval Route Version. A material resubmission or
authorized reroute creates a successor version. Shared Approval Routes own task
progression and immutable Approval Decisions; Leave owns certification,
recommendation, allocation, commitment, posting, withdrawal, and cancellation
rules.

HR certification creates the Leave Credit Commitments under the affected
account locks. A partial approval may replace a certified commitment only with
a linked, smaller successor. Other replacement requires recertification.
Commitments remain active through valid review without a system-invented expiry,
are released by withdrawal, rejection, material return, invalidation, or
supersession, and are consumed by posting.

Balance-sensitive posting locks the Leave Account, recomputes availability,
enforces unique source effect keys, and invokes Attendance and Payroll through
their application services inside one transaction. It writes the required
ledger entries, posted-leave inputs, Payroll Inputs, application status, Audit
Events, and outbox records, then consumes the commitments. Any authoritative
failure rolls back the full Leave Posting and leaves the application approved
for a recorded retry. External delivery remains asynchronous after commit.

Leave also charges tardiness and undertime. It consumes the outbox event of
each Attendance Period Lock and Locked Attendance Adjustment, reads the
publication through Attendance's application service, and creates one immutable
Attendance Deficit Charge per `TARDINESS` or `UNDERTIME` Attendance Payroll
Fact. The charge converts minutes through MC41 Table II, posts the covered part
to the vacation Leave Account, and obtains a Payroll Input for the Unpaid
Deficit Remainder in the same transaction. Attendance never calls Leave, and
Payroll never derives the charge itself
([ADR 0012](adr/0012-charge-each-attendance-deficit-fact-once.md)).

Leave Cancellation is a separate authorized record over an approved or posted
application. Applying it is another atomic Leave-owned command. Whole
cancellation creates exact linked reversals; partial cancellation fully reverses
affected original entries and creates replacements for the retained effect.
Attendance and Payroll own their correction records. Unlocked attendance may be
recalculated, while locked attendance and consumed or finalized payroll receive
linked adjustment handoffs. Leave stores their identifiers and states but never
modifies another module's tables directly.

An approved cancellation whose effect command fails remains approved with the
original posting effective. The application projects `CANCELLED` only after all
required reversals or owner handoffs have committed. A downstream adjustment may
remain pending after its owner accepted the handoff, and the Leave workspace
must expose that status rather than claiming completion.

Mandatory or forced leave is an explainable, policy-derived assessment over an
Employee's applicable facts and vacation Leave Account. It uses the ordinary
Leave Application and ledger path. An alert or assessment is not itself an
approval or posting authority.

Leave Monetization follows the same history and balance boundaries without
pretending to be an ordinary Leave Application. A stable Leave Monetization
Request owns immutable submitted versions and per-account allocations. An HR
credit certification creates Leave Credit Commitments under every affected
account lock; a separate Budget-owned funding determination and the bound
Approval Route supply the remaining authority. Approval does not post.

Monetization Posting is an atomic Leave-owned orchestration over Leave and
Payroll application services. Leave supplies approved account quantities,
source and effect identities, authority and policy versions, funding and
approval lineage, valuation date, fixed calculator kind and factor, and the
required salary semantics. Payroll alone resolves the authoritative salary,
calculates and rounds the amount, and stores the immutable Monetization Earning
Input. It returns `ACCEPTED`, matching `ALREADY_ACCEPTED`, `REJECTED`, or
`RETRYABLE_FAILURE`. Leave writes negative source-owned ledger entries and
consumes commitments only with an accepted Payroll result in the same
transaction.

Missing monetization valuation-date, allocation, salary-component, rounding,
funding, or authority facts fail closed as indeterminate. The product provides
no default for gaps left by national sources. The unresolved solo-parent
forfeiture and cash-conversion conflict creates no automatic earning.

Monetization Adjustment is a separate authorized source. Pending Payroll Inputs
may be cancelled or replaced; consumed inputs receive a linked Payroll
adjustment, and finalized results remain immutable. Leave restores credits only
after Payroll accepts the correction handoff. A failed or rejected handoff
leaves the original posting effective and the adjustment available for recorded
retry or correction.

Separation initiates terminal-leave input preservation only after its effective
date and the required Leave postings through the last service date. Leave
records a `READY` or `INDETERMINATE` Terminal Leave Input Assessment. A ready
result freezes a Terminal Leave Input Snapshot containing exact separation and
service references, account balances at the effective separation date, the
ledger-knowledge cutoff, policy and authority versions, clearance evidence, and
the owning module's verified highest-monthly-salary source reference.

Leave returns the stable snapshot reference to Separation and retains acceptance,
duplicate, rejection, or retryable handoff results. Corrected sources create
reasoned successors. A snapshot never closes an account, creates a ledger or
Payroll effect, calculates a terminal benefit, or authorizes payment. Full
terminal-leave calculation and payment remain outside MVP.

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

One `coc` module owns COC Accounts, the COC Ledger, and CTO Requests, as Leave owns its accounts, ledger, and applications. Overtime calls it once, when a Certificate of COC Earned is approved.

- COC Ledger Entries are signed minutes with a typed source, posting key, and `valid_until`, and corrections are linked reversals or negative adjustments. The ratios, caps, validity, CTO blocks, and five-day limit are national rules in code (ADR 0009).
- A use draws from the earliest-expiring COC still valid on its Work Date. Forfeiture posts one entry per `valid_until`. Expiry posts the COC remaining for a `valid_until` as one entry, and restored COC expires as a new entry.
- CTO approval locks the account, posts the usage, and creates Attendance CTO inputs in one transaction. Cancellation reverses the cancelled dates and supersedes their inputs, or hands a locked date to a Locked Attendance Adjustment.

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

The Phase 3 invitation workflows are a documented exception to the
asynchronous email path: the non-HTTP Agency Provisioning command and the
existing Agency invitation mutation may dispatch their provider-neutral mail
adapter after the authoritative transaction commits because their contracts
must report delivery failure. They must compensate the committed invitation
state on failure and must never call the provider while the database
transaction is open. General asynchronous workflows continue to use the
outbox/worker path as that infrastructure is introduced.

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
      - '55432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:alpine
    ports:
      - '6379:6379'

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
→ Build
→ Start local infrastructure
→ Validate migrations
→ Unit tests
→ Integration tests
→ RLS/constraint tests
→ Browser acceptance tests
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
- account abuse protection, including the Sign-in Cool-down and a per-IP limit shared by sign-in and Password Reset;
- Argon2id password hashing;
- TOTP MFA owned by LingkodHR, with Recovery Codes and an audited Factor Reset;
- TOTP secrets encrypted at rest;
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
DATABASE_OPERATIONAL_URL

# Redis
REDIS_URL

# Email
EMAIL_FROM
EMAIL_HOST
EMAIL_PORT
EMAIL_SECURE

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

Login needs no identity-provider or OIDC settings. `DATA_ENCRYPTION_KEY` and `BLIND_INDEX_KEY` are required at startup in every environment: `DATA_ENCRYPTION_KEY` encrypts TOTP secrets and other protected values, and `BLIND_INDEX_KEY` keys the email hash used by the Sign-in Cool-down and Security Events.

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
- leave credit commitments;
- applications;
- monetization requests, funding, postings, and adjustments;
- terminal-leave input assessments and snapshots.

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

**Status:** Superseded by [ADR 0004: LingkodHR owns login](adr/0004-lingkodhr-owned-login.md).

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

| Version | Date              | Description                                                                                                                                            |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1     | August 2, 2026    | Initial general AI-enabled ERP architecture                                                                                                            |
| 0.2     | August 7, 2026    | Reframed architecture around the Philippine Public-Sector HRIS implementation                                                                          |
| 0.3     | August 7, 2026    | Narrowed the architecture to an exclusive Philippine Public-Sector HRIS scope and aligned terminology, modules, and architecture decisions accordingly |
| 0.4     | September 4, 2026 | Clarified ownership of database capabilities, External Evidence linking, and the PDS editor model                                                      |
| 0.5     | October 2, 2026   | Replaced managed authentication with LingkodHR-owned login (ADR 0004)                                                                                  |
