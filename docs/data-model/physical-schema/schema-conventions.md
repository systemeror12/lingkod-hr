# Physical Schema Conventions

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Purpose

This document defines the conventions used by every physical-schema document in this bundle.

The design prioritizes:

- agency isolation;
- historical accuracy;
- auditability;
- immutable ledgers;
- public-sector workflow controls;
- Prisma compatibility;
- reviewed PostgreSQL-specific migrations for constraints that are difficult to express through an ORM.

---

## 2. Required PostgreSQL Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
```

Optional later:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Use `vector` only for approved AI retrieval features. It is not required for core HRIS transactions.

---

## 3. Identifier Strategy

Use UUID primary keys.

```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid()
```

The application may later adopt time-ordered UUID generation, but the database contract remains `uuid`.

Do not expose sequential internal identifiers as security boundaries.

Business identifiers remain separate:

```text
agency code
employee number
plantilla item number
appointment reference
payroll period code
document number
```

---

## 4. Standard Data Types

| Concept | PostgreSQL type | Notes |
|---|---|---|
| Primary/foreign key | `uuid` | Required for all entity relationships |
| Money | `numeric(19,4)` | Avoid floating point |
| Leave/COC units | `numeric(12,4)` | Supports fractions |
| Percent/rate | `numeric(12,8)` | Preserve calculation precision |
| Calendar date | `date` | No timezone |
| Event timestamp | `timestamptz` | Stored in UTC |
| Local time-of-day | `time` | Used only with schedule timezone |
| Email | `citext` | Case-insensitive comparison |
| Status | constrained `text` | Prefer check constraints over many PostgreSQL enums |
| Flexible metadata | `jsonb` | Only when structure is genuinely versioned or variable |
| Large text | `text` | Notes and descriptions |
| Encrypted sensitive value | `bytea` | Application-managed envelope encryption |
| Search-safe hash | `bytea` or `text` | Never use as reversible storage |
| IP address | `inet` | Security logs |
| Date range | `daterange` | Useful for exclusion constraints |
| Timestamp range | `tstzrange` | Time-bound authority/session logic |

Use constrained `text` rather than database enum types for most workflow statuses so deployments can add values through controlled migrations without replacing enum types.

Example:

```sql
status text NOT NULL
  CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE'))
```

---

## 5. Standard Audit Columns

Mutable business tables should normally include:

```sql
created_at timestamptz NOT NULL DEFAULT now(),
created_by_membership_id uuid,
updated_at timestamptz NOT NULL DEFAULT now(),
updated_by_membership_id uuid,
row_version integer NOT NULL DEFAULT 1
```

`row_version` supports optimistic concurrency.

Append-only tables do not need `updated_at`.

Examples:

- ledger entries;
- audit events;
- approval decisions;
- finalized payroll lines;
- issued document versions.

---

## 6. Agency Ownership

Every high-risk or high-volume operational table includes:

```sql
agency_id uuid NOT NULL
```

Even where agency ownership could be inferred through a parent, direct `agency_id` is retained to simplify:

- Row-Level Security;
- defensive foreign keys;
- query filtering;
- partitioning;
- audit review.

Use composite agency-safe foreign keys where cross-agency mistakes would be severe.

Example:

```sql
UNIQUE (agency_id, id)
```

Then:

```sql
FOREIGN KEY (agency_id, employee_id)
  REFERENCES employees (agency_id, id)
```

This prevents cross-agency references at the database level.

---

## 7. Row-Level Security Pattern

All agency-owned operational tables should enable RLS.

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
```

Application transaction setup:

```sql
SELECT set_config('app.agency_id', :agency_id::text, true);
SELECT set_config('app.membership_id', :membership_id::text, true);
```

Baseline tenant policy:

```sql
CREATE POLICY employees_agency_isolation
ON employees
USING (
  agency_id = current_setting('app.agency_id', true)::uuid
)
WITH CHECK (
  agency_id = current_setting('app.agency_id', true)::uuid
);
```

RLS provides defense in depth. The API must still perform permission and record-scope checks.

Background jobs must explicitly set trusted agency context before querying tenant data.

---

## 8. Effective-Dated Records

Use:

```sql
effective_from date NOT NULL,
effective_to date,
CHECK (effective_to IS NULL OR effective_to >= effective_from)
```

Prevent overlapping effective periods using `btree_gist`.

Example:

```sql
ALTER TABLE position_versions
ADD CONSTRAINT position_versions_no_overlap
EXCLUDE USING gist (
  agency_id WITH =,
  position_id WITH =,
  daterange(
    effective_from,
    COALESCE(effective_to + 1, 'infinity'::date),
    '[)'
  ) WITH &&
)
WHERE (status <> 'VOIDED');
```

Use reviewed SQL migrations for exclusion constraints.

---

## 9. Soft Deletion and Historical Preservation

Do not add a generic `deleted_at` to every table.

Use domain states instead:

```text
INACTIVE
CANCELLED
VOIDED
SUPERSEDED
ARCHIVED
ABOLISHED
DEACTIVATED
```

Hard deletion is normally permitted only for:

- unsubmitted drafts with no dependents;
- temporary import staging rows;
- expired technical tokens after retention;
- failed uploads not linked to records.

Official and financial records are never hard-deleted through ordinary application functions.

---

## 10. Immutable Record Enforcement

Append-only tables include:

- `leave_ledger_entries`;
- `coc_ledger_entries`;
- `approval_decisions`;
- `audit_events`;
- finalized `payroll_lines`;
- issued `document_versions`.

Recommended database trigger:

```sql
CREATE FUNCTION prevent_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Record is immutable';
END;
$$;
```

Attach it to immutable tables for `UPDATE` and `DELETE`.

For tables that become immutable after a parent is finalized, use a parent-state-aware trigger.

---

## 11. Monetary Calculations

Store:

```sql
numeric(19,4)
```

Perform rule calculations using higher internal precision where needed.

Round only at defined policy boundaries.

Never use:

```text
real
double precision
JavaScript floating-point values as authoritative payroll amounts
```

The API should serialize money as decimal strings.

---

## 12. JSONB Usage

Appropriate uses:

- versioned policy configuration;
- rule snapshots;
- sanitized audit metadata;
- AI structured outputs;
- provider-specific delivery metadata.

Avoid JSONB for stable relational concepts such as:

- employees;
- positions;
- salary grades;
- leave balances;
- payroll lines;
- memberships;
- approval decisions.

Add JSON schema validation in application code and selected database checks where practical.

---

## 13. Sensitive Data

Examples:

- government identifiers;
- bank account numbers;
- medical documents;
- confidential PDS fields;
- SALN-related metadata;
- security metadata.

Store reversible sensitive values as encrypted `bytea`.

Store a display-safe masked value separately:

```sql
encrypted_value bytea NOT NULL,
masked_value text NOT NULL
```

Search by exact sensitive value only through a keyed blind index when required.

Never log plaintext sensitive values.

---

## 14. Indexing Rules

Every foreign key used for joins should normally have an index.

Common patterns:

```sql
CREATE INDEX ON employees (agency_id, status);
CREATE INDEX ON attendance_days (agency_id, employee_id, work_date);
CREATE INDEX ON payroll_lines (agency_id, payroll_employee_id);
```

Partial indexes:

```sql
CREATE UNIQUE INDEX one_active_membership_per_user_agency
ON agency_memberships (agency_id, user_id)
WHERE status IN ('INVITED', 'ACTIVE', 'LOCKED', 'SUSPENDED');
```

Use GIN indexes only for proven JSONB or text-search queries.

---

## 15. Foreign-Key Delete Rules

| Relationship | Default |
|---|---|
| Agency to operational records | `RESTRICT` |
| Parent transaction to immutable details | `RESTRICT` |
| Draft-only child rows | `CASCADE` only where safe |
| Reference/configuration record in use | `RESTRICT` |
| Optional current-version pointer | `SET NULL` during controlled replacement |
| Temporary technical records | `CASCADE` where appropriate |

Avoid broad cascading deletion in HR, appointment, payroll, leave, or audit domains.

---

## 16. Partitioning Candidates

Do not partition prematurely.

Candidates when data volume justifies it:

- `audit_events` by month or quarter;
- `attendance_events` by month;
- `attendance_days` by year;
- `notification_deliveries` by month;
- `ai_requests` by month;
- `payroll_lines` by payroll year for very large deployments.

Partitioning must preserve agency-aware indexes and retention rules.

---

## 17. Prisma Boundary

Prisma models should represent normal tables and relations.

Use reviewed SQL migrations for:

- exclusion constraints;
- partial unique indexes;
- Row-Level Security;
- immutable-record triggers;
- advanced check constraints;
- partitioning;
- database functions;
- composite agency-safe foreign keys where generated migrations are insufficient.

Every reviewed SQL migration should include:

- forward migration;
- rollback or documented irreversibility;
- verification query;
- performance impact note.

---

## 18. Naming Conventions

Database objects:

```text
snake_case
plural table names
singular column names
```

Examples:

```text
agency_memberships
payroll_periods
effective_from
created_by_membership_id
```

Constraints:

```text
<table>_<purpose>_<type>
```

Examples:

```text
employees_agency_employee_number_uq
position_versions_no_overlap_excl
payroll_lines_amount_nonnegative_ck
```

Indexes:

```text
<table>_<columns>_idx
```

---

## 19. Transaction Boundaries

Use database transactions for:

- position occupancy;
- assumption to duty;
- personnel action effectuation;
- leave posting;
- COC posting;
- payroll finalization;
- separation effectuation;
- approval decision plus domain-state transition.

Do not call external services inside database transactions.

Use an outbox or background-job record for:

- email;
- PDF generation;
- AI provider calls;
- external exports;
- notifications.

A controlled one-shot operational command may instead call its provider after
the authoritative transaction commits when the command contract requires a
synchronous delivery failure. It must use a compensating state transition on
failure and must never call the provider inside the database transaction.

---

## 20. Required Verification

Before approving a physical table:

- [ ] Every agency-owned record has agency isolation.
- [ ] Foreign keys cannot cross agencies.
- [ ] Status values are constrained.
- [ ] Effective dates cannot overlap where prohibited.
- [ ] Immutable records cannot be edited.
- [ ] Sensitive values are encrypted or masked.
- [ ] Required foreign-key indexes exist.
- [ ] Deletion behavior is explicit.
- [ ] Business identifiers are unique in the correct scope.
- [ ] Migration can be tested on an empty and populated database.
