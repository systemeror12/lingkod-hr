# Overtime, COC, and CTO Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Overtime Authorities

```sql
CREATE TABLE overtime_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  requesting_unit_id uuid NOT NULL,
  authority_no citext NOT NULL,
  purpose text NOT NULL,
  date_from timestamptz NOT NULL,
  date_to timestamptz NOT NULL,
  proposed_compensation_method text NOT NULL
    CHECK (proposed_compensation_method IN ('OVERTIME_PAY','COC','TO_BE_DETERMINED')),
  funding_reference text,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','FOR_REVIEW','APPROVED','REJECTED','ACTIVE','COMPLETED','CANCELLED')),
  approved_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_to > date_from),
  FOREIGN KEY (agency_id, requesting_unit_id)
    REFERENCES organization_units (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, authority_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE overtime_authority_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  overtime_authority_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  authorized_hours numeric(12,4)
    CHECK (authorized_hours IS NULL OR authorized_hours > 0),
  task_description text,
  eligibility_snapshot jsonb NOT NULL,
  FOREIGN KEY (agency_id, overtime_authority_id)
    REFERENCES overtime_authorities (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (overtime_authority_id, employee_id),
  UNIQUE (agency_id, id)
);
```

---

## 2. Rendered Service

```sql
CREATE TABLE overtime_service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  overtime_authority_employee_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  service_date date NOT NULL,
  claimed_hours numeric(12,4) NOT NULL CHECK (claimed_hours > 0),
  actual_hours numeric(12,4) CHECK (actual_hours IS NULL OR actual_hours >= 0),
  certified_hours numeric(12,4) CHECK (certified_hours IS NULL OR certified_hours >= 0),
  accomplishment text,
  status text NOT NULL
    CHECK (status IN (
      'PENDING','RENDERED','FOR_CERTIFICATION','CERTIFIED',
      'NOT_CERTIFIED','FOR_COMPENSATION','COMPENSATED'
    )),
  certified_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, overtime_authority_employee_id)
    REFERENCES overtime_authority_employees (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (overtime_authority_employee_id, service_date),
  UNIQUE (agency_id, id)
);
```

---

## 3. Compensation Decision

```sql
CREATE TABLE overtime_compensation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  overtime_service_record_id uuid NOT NULL,
  method text NOT NULL
    CHECK (method IN ('OVERTIME_PAY','COC','NON_COMPENSABLE')),
  approved_hours numeric(12,4) NOT NULL CHECK (approved_hours >= 0),
  rate_rule_snapshot jsonb NOT NULL,
  funding_validated_by_membership_id uuid,
  decided_by_membership_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  payroll_input_id uuid,
  coc_ledger_entry_id uuid,
  status text NOT NULL DEFAULT 'EFFECTIVE'
    CHECK (status IN ('EFFECTIVE','SUPERSEDED','VOIDED')),
  FOREIGN KEY (agency_id, overtime_service_record_id)
    REFERENCES overtime_service_records (agency_id, id),
  FOREIGN KEY (agency_id, funding_validated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, decided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  CHECK (
    (method = 'OVERTIME_PAY' AND payroll_input_id IS NOT NULL AND coc_ledger_entry_id IS NULL)
    OR
    (method = 'COC' AND coc_ledger_entry_id IS NOT NULL AND payroll_input_id IS NULL)
    OR
    (method = 'NON_COMPENSABLE' AND payroll_input_id IS NULL AND coc_ledger_entry_id IS NULL)
  )
);

CREATE UNIQUE INDEX overtime_compensation_one_effective_uq
ON overtime_compensation_decisions (overtime_service_record_id)
WHERE status = 'EFFECTIVE';
```

Because payroll and COC tables may be created later in migration order, add those foreign keys after all dependent tables exist.

---

## 4. COC Ledger

```sql
CREATE TABLE coc_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  opened_at date NOT NULL,
  closed_at date,
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX coc_accounts_one_active_uq
ON coc_accounts (agency_id, employee_id)
WHERE status = 'ACTIVE';
```

```sql
CREATE TABLE coc_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  coc_account_id uuid NOT NULL,
  entry_type text NOT NULL
    CHECK (entry_type IN ('EARNED','USED','ADJUSTMENT','EXPIRATION','REVERSAL')),
  quantity_hours numeric(12,4) NOT NULL,
  effective_date date NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  reverses_entry_id uuid,
  expires_at date,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by_membership_id uuid,
  FOREIGN KEY (agency_id, coc_account_id)
    REFERENCES coc_accounts (agency_id, id),
  FOREIGN KEY (reverses_entry_id)
    REFERENCES coc_ledger_entries(id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, posted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, source_type, source_id, entry_type),
  UNIQUE (agency_id, id)
);
```

Attach immutable triggers.

Balance view:

```sql
CREATE VIEW coc_account_balances AS
SELECT
  agency_id,
  coc_account_id,
  SUM(quantity_hours) AS balance_hours
FROM coc_ledger_entries
GROUP BY agency_id, coc_account_id;
```

---

## 5. CTO Requests

```sql
CREATE TABLE cto_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  coc_account_id uuid NOT NULL,
  date_from timestamptz NOT NULL,
  date_to timestamptz NOT NULL,
  requested_hours numeric(12,4) NOT NULL CHECK (requested_hours > 0),
  approved_hours numeric(12,4),
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','FOR_RECOMMENDATION','FOR_APPROVAL','APPROVED','REJECTED','POSTED','CANCELLED')),
  posted_ledger_entry_id uuid,
  attendance_day_id uuid,
  CHECK (date_to > date_from),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, coc_account_id)
    REFERENCES coc_accounts (agency_id, id),
  FOREIGN KEY (agency_id, posted_ledger_entry_id)
    REFERENCES coc_ledger_entries (agency_id, id),
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Posting transaction validates the current COC balance with row locking and inserts the usage entry atomically.
