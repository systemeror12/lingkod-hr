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
  work_date_from date NOT NULL,
  work_date_to date NOT NULL,
  compensation_method text NOT NULL
    CHECK (compensation_method IN ('COC','OVERTIME_PAY')),
  funding_reference text,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','FOR_REVIEW','APPROVED','REJECTED','CANCELLED')),
  approved_by_membership_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_date_to >= work_date_from),
  CHECK (compensation_method = 'COC' OR funding_reference IS NOT NULL),
  CHECK (status <> 'APPROVED' OR (approved_by_membership_id IS NOT NULL AND approved_at IS NOT NULL)),
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
  authorized_hours numeric(12,4) NOT NULL CHECK (authorized_hours > 0),
  task_description text,
  eligibility_snapshot jsonb,
  FOREIGN KEY (agency_id, overtime_authority_id)
    REFERENCES overtime_authorities (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (overtime_authority_id, employee_id),
  UNIQUE (agency_id, id)
);
```

`compensation_method` is proposed in the draft and fixed when the Approving Official approves. Approval refuses `OVERTIME_PAY` until #347. An authority is in effect or ended by its Work Dates; neither is a stored status. `authorized_hours` is the Employee's total across the authority. `eligibility_snapshot` is written once at approval and holds the system-derived facts and the reviewer's attestations listed in `hris-controls.md` §5.16. Approved authorities and their covered Employees are immutable.

---

## 2. Overtime Service Records

```sql
CREATE TABLE overtime_service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  overtime_authority_employee_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  claimed_hours numeric(12,4) NOT NULL CHECK (claimed_hours > 0),
  accomplishment text NOT NULL,
  actual_hours numeric(12,4) CHECK (actual_hours IS NULL OR actual_hours >= 0),
  source_attendance_day_id uuid,
  day_classification text,
  certified_hours numeric(12,4) CHECK (certified_hours IS NULL OR certified_hours >= 0),
  decline_reason text,
  status text NOT NULL
    CHECK (status IN ('RENDERED','FOR_CERTIFICATION','CERTIFIED','NOT_CERTIFIED')),
  recorded_by_membership_id uuid NOT NULL,
  certified_by_membership_id uuid,
  certified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'RENDERED'
         OR (actual_hours IS NOT NULL AND source_attendance_day_id IS NOT NULL AND day_classification IS NOT NULL)),
  CHECK ((status = 'CERTIFIED') = (certified_hours IS NOT NULL)),
  CHECK (certified_hours IS NULL OR certified_hours <= actual_hours),
  CHECK ((status = 'NOT_CERTIFIED') = (decline_reason IS NOT NULL)),
  FOREIGN KEY (agency_id, overtime_authority_employee_id)
    REFERENCES overtime_authority_employees (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, source_attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX overtime_service_one_live_per_date_uq
ON overtime_service_records (agency_id, employee_id, work_date)
WHERE status <> 'NOT_CERTIFIED';
```

Submitting reads `actual_hours`, `day_classification`, and `source_attendance_day_id` through Attendance's application service from the latest locked Attendance Period Version covering the Work Date. Certifying re-reads them and is refused if the source day version has changed. The Employee's certified hours across one authority may not exceed `authorized_hours`; the certify service checks this under a lock on the `overtime_authority_employees` row.

---

## 3. Certificates of COC Earned

```sql
CREATE TABLE coc_earned_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  earned_month date NOT NULL CHECK (earned_month = date_trunc('month', earned_month)::date),
  status text NOT NULL
    CHECK (status IN ('DRAFT','FOR_APPROVAL','APPROVED','DISCARDED')),
  prepared_by_membership_id uuid NOT NULL,
  approved_by_membership_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'APPROVED') = (approved_by_membership_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (approved_by_membership_id IS DISTINCT FROM prepared_by_membership_id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, prepared_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE coc_earned_certificate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  coc_earned_certificate_id uuid NOT NULL,
  overtime_service_record_id uuid NOT NULL,
  certified_hours numeric(12,4) NOT NULL CHECK (certified_hours > 0),
  credited_hours numeric(12,4) CHECK (credited_hours IS NULL OR credited_hours >= 0),
  excess_hours numeric(12,4) CHECK (excess_hours IS NULL OR excess_hours >= 0),
  released_at timestamptz,
  FOREIGN KEY (agency_id, coc_earned_certificate_id)
    REFERENCES coc_earned_certificates (agency_id, id),
  FOREIGN KEY (agency_id, overtime_service_record_id)
    REFERENCES overtime_service_records (agency_id, id),
  UNIQUE (coc_earned_certificate_id, overtime_service_record_id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX coc_earned_certificate_lines_one_active_uq
ON coc_earned_certificate_lines (overtime_service_record_id)
WHERE released_at IS NULL;
```

The Overtime module owns certificates. Each line is a `CERTIFIED` record of the certificate's Employee, under a `COC` authority, with a Work Date in `earned_month`. Discarding a draft sets `released_at` on its lines. Approval calls the COC module once, keyed by the certificate, which applies the ratio, caps, and validity, writes the earned COC with the certificate as its source, and returns each line's `credited_hours` and `excess_hours`. An approved certificate and its lines are immutable. There is no per-record compensation decision.

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
