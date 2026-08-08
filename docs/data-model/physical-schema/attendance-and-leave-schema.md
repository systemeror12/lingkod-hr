# Attendance and Leave Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Schedules and Work Arrangements

```sql
CREATE TABLE work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  schedule_type text NOT NULL
    CHECK (schedule_type IN ('REGULAR','FLEXIBLE','SHIFT','COMPRESSED')),
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  current_version_id uuid,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE work_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  work_schedule_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  weekly_pattern jsonb NOT NULL,
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  required_minutes_per_day integer CHECK (required_minutes_per_day >= 0),
  effective_from date NOT NULL,
  effective_to date,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, work_schedule_id)
    REFERENCES work_schedules (agency_id, id),
  UNIQUE (work_schedule_id, version_no),
  UNIQUE (agency_id, id)
);
```

Use an exclusion constraint to prevent overlapping active versions.

---

## 2. Schedule Assignments

```sql
CREATE TABLE schedule_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  work_schedule_version_id uuid NOT NULL,
  work_arrangement_id uuid,
  effective_from date NOT NULL,
  effective_to date,
  assigned_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, work_schedule_version_id)
    REFERENCES work_schedule_versions (agency_id, id),
  FOREIGN KEY (agency_id, assigned_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Add a no-overlap exclusion constraint for primary schedule assignments.

---

## 3. Attendance Periods and Events

```sql
CREATE TABLE attendance_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  status text NOT NULL
    CHECK (status IN ('OPEN','FOR_REVIEW','APPROVED','LOCKED','REOPENED')),
  locked_at timestamptz,
  locked_by_membership_id uuid,
  CHECK (date_to >= date_from),
  FOREIGN KEY (agency_id, locked_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);
```

```sql
CREATE TABLE attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  event_time timestamptz NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('TIME_IN','BREAK_OUT','BREAK_IN','TIME_OUT')),
  source text NOT NULL
    CHECK (source IN ('WEB_CLOCK','MANUAL')),
  source_reference text,
  entered_by_membership_id uuid,
  reason text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    source <> 'MANUAL'
    OR (entered_by_membership_id IS NOT NULL AND reason IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, entered_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

No biometric source is included in the MVP.

Events are append-only. Incorrect events are voided and replaced.

---

## 4. Attendance Days and Exceptions

```sql
CREATE TABLE attendance_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  schedule_assignment_id uuid,
  status text NOT NULL
    CHECK (status IN ('PENDING','CALCULATED','EXCEPTION','FOR_REVIEW','APPROVED','LOCKED','ADJUSTED')),
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  undertime_minutes integer NOT NULL DEFAULT 0 CHECK (undertime_minutes >= 0),
  absence_minutes integer NOT NULL DEFAULT 0 CHECK (absence_minutes >= 0),
  official_business_minutes integer NOT NULL DEFAULT 0 CHECK (official_business_minutes >= 0),
  calculation_version integer NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
  rule_snapshot jsonb NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  calculated_at timestamptz,
  FOREIGN KEY (agency_id, attendance_period_id)
    REFERENCES attendance_periods (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, schedule_assignment_id)
    REFERENCES schedule_assignments (agency_id, id),
  UNIQUE (attendance_period_id, employee_id, work_date, calculation_version),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX attendance_days_one_current_uq
ON attendance_days (agency_id, employee_id, work_date)
WHERE is_current;
```

```sql
CREATE TABLE attendance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_day_id uuid NOT NULL,
  exception_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','BLOCKING')),
  status text NOT NULL CHECK (status IN ('OPEN','RESOLVED','WAIVED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by_membership_id uuid,
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  FOREIGN KEY (agency_id, resolved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id)
);
```

---

## 5. Corrections

```sql
CREATE TABLE attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_day_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','NEEDS_INFORMATION','APPROVED','REJECTED','CANCELLED','APPLIED')),
  requested_events jsonb NOT NULL,
  reason text NOT NULL,
  submitted_at timestamptz,
  decided_by_membership_id uuid,
  decided_at timestamptz,
  decision_reason text,
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, decided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Applied correction transaction:

- retain old attendance day;
- create replacement current version;
- mark old version `is_current = false`;
- append audit record;
- create payroll adjustment if period was locked/finalized.

---

## 6. Leave Types and Policies

```sql
CREATE TABLE leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  credit_based boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  current_policy_version_id uuid,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_type_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  eligibility_rules jsonb NOT NULL,
  accrual_rules jsonb NOT NULL,
  document_requirements jsonb NOT NULL,
  approval_route_code citext NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, leave_type_id)
    REFERENCES leave_types (agency_id, id),
  UNIQUE (leave_type_id, version_no),
  UNIQUE (agency_id, id)
);
```

---

## 7. Leave Accounts and Ledger

```sql
CREATE TABLE leave_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  opened_at date NOT NULL,
  closed_at date,
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, leave_type_id)
    REFERENCES leave_types (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX leave_accounts_one_active_uq
ON leave_accounts (agency_id, employee_id, leave_type_id)
WHERE status = 'ACTIVE';
```

```sql
CREATE TABLE leave_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_account_id uuid NOT NULL,
  entry_type text NOT NULL
    CHECK (entry_type IN (
      'OPENING','EARNED','USED','ADJUSTMENT',
      'RESTORATION','MONETIZATION','TERMINAL','REVERSAL'
    )),
  quantity_days numeric(12,4) NOT NULL,
  effective_date date NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  reverses_entry_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by_membership_id uuid,
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (reverses_entry_id)
    REFERENCES leave_ledger_entries(id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, posted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, source_type, source_id, entry_type),
  UNIQUE (agency_id, id)
);
```

Attach immutable mutation-prevention triggers.

A balance view:

```sql
CREATE VIEW leave_account_balances AS
SELECT
  agency_id,
  leave_account_id,
  SUM(quantity_days) AS balance_days
FROM leave_ledger_entries
GROUP BY agency_id, leave_account_id;
```

---

## 8. Leave Applications

```sql
CREATE TABLE leave_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  requested_days numeric(12,4) NOT NULL CHECK (requested_days > 0),
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','SUBMITTED','FOR_CERTIFICATION','FOR_RECOMMENDATION',
      'FOR_APPROVAL','APPROVED','REJECTED','NEEDS_INFORMATION',
      'CANCEL_REQUESTED','CANCELLED','POSTED'
    )),
  reason text,
  submitted_at timestamptz,
  CHECK (date_to >= date_from),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, leave_type_id)
    REFERENCES leave_types (agency_id, id),
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Prevent overlapping posted leave using a reviewed exclusion constraint where agency policy requires strict non-overlap.

---

## 9. Monetization

```sql
CREATE TABLE leave_monetization_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  leave_account_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  requested_days numeric(12,4) NOT NULL CHECK (requested_days > 0),
  approved_days numeric(12,4),
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','SUBMITTED','FOR_VALIDATION','FOR_APPROVAL',
      'APPROVED','REJECTED','POSTED_TO_PAYROLL','CANCELLED'
    )),
  payroll_input_id uuid,
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id)
);
```

Posting must atomically:

1. insert a leave ledger debit;
2. create an idempotent payroll input;
3. update request status;
4. append audit/outbox events.
