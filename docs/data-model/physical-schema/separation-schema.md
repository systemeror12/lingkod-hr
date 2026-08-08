# Separation Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Separation Cases

```sql
CREATE TABLE separation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  separation_type text NOT NULL
    CHECK (separation_type IN (
      'RESIGNATION','RETIREMENT','TRANSFER','EXPIRATION',
      'TERMINATION','DEATH','REORGANIZATION','OTHER'
    )),
  proposed_effective_date date NOT NULL,
  approved_effective_date date,
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','SUBMITTED','FOR_REVIEW','APPROVED',
      'CLEARANCE_IN_PROGRESS','CLEARED','EFFECTIVE','CANCELLED'
    )),
  reason text,
  initiated_by_membership_id uuid NOT NULL,
  approved_by_membership_id uuid,
  service_segment_id uuid,
  position_incumbency_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, initiated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, service_segment_id)
    REFERENCES service_segments (agency_id, id),
  FOREIGN KEY (agency_id, position_incumbency_id)
    REFERENCES position_incumbencies (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX separation_cases_one_active_uq
ON separation_cases (agency_id, employee_id)
WHERE status IN (
  'SUBMITTED','FOR_REVIEW','APPROVED',
  'CLEARANCE_IN_PROGRESS','CLEARED'
);
```

---

## 2. Clearance Configuration

```sql
CREATE TABLE clearance_offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  organization_unit_id uuid NOT NULL,
  code citext NOT NULL,
  name text NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  required_by_default boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  FOREIGN KEY (agency_id, organization_unit_id)
    REFERENCES organization_units (agency_id, id),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);
```

---

## 3. Clearance Tasks

```sql
CREATE TABLE clearance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  separation_case_id uuid NOT NULL,
  clearance_office_id uuid NOT NULL,
  assigned_membership_id uuid,
  status text NOT NULL
    CHECK (status IN ('PENDING','IN_PROGRESS','CLEARED','WITH_ACCOUNTABILITY','WAIVED','CANCELLED')),
  started_at timestamptz,
  completed_at timestamptz,
  comments text,
  waived_by_membership_id uuid,
  FOREIGN KEY (agency_id, separation_case_id)
    REFERENCES separation_cases (agency_id, id),
  FOREIGN KEY (agency_id, clearance_office_id)
    REFERENCES clearance_offices (agency_id, id),
  FOREIGN KEY (agency_id, assigned_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, waived_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (separation_case_id, clearance_office_id),
  UNIQUE (agency_id, id)
);
```

---

## 4. Accountability Items

```sql
CREATE TABLE accountability_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  clearance_task_id uuid NOT NULL,
  accountability_type text NOT NULL
    CHECK (accountability_type IN ('PROPERTY','CASH','RECORD','DOCUMENT','FINANCIAL','OTHER')),
  reference_no text,
  description text NOT NULL,
  amount numeric(19,4),
  status text NOT NULL CHECK (status IN ('OPEN','RESOLVED','WAIVED')),
  resolved_at timestamptz,
  resolution_document_id uuid,
  FOREIGN KEY (agency_id, clearance_task_id)
    REFERENCES clearance_tasks (agency_id, id),
  UNIQUE (agency_id, id)
);
```

A trigger or service validation prevents setting a task to `CLEARED` while open accountability items exist.

---

## 5. Downstream Effects

```sql
CREATE TABLE separation_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  separation_case_id uuid NOT NULL,
  effect_type text NOT NULL
    CHECK (effect_type IN (
      'CLOSE_SERVICE','VACATE_POSITION','STOP_SCHEDULE',
      'STOP_PAYROLL','DEACTIVATE_MEMBERSHIP','REVOKE_SESSIONS'
    )),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  applied_at timestamptz,
  status text NOT NULL CHECK (status IN ('PENDING','APPLIED','FAILED','REVERSED')),
  failure_reason text,
  FOREIGN KEY (agency_id, separation_case_id)
    REFERENCES separation_cases (agency_id, id),
  UNIQUE (separation_case_id, effect_type, target_id),
  UNIQUE (agency_id, id)
);
```

---

## 6. Effectuation Transaction

When a separation becomes effective:

1. lock employee;
2. lock service segment and position incumbency;
3. verify approved effectivity;
4. close service segment;
5. end position incumbency;
6. set position to vacant/frozen/abolished as applicable;
7. stop future schedule and payroll eligibility;
8. deactivate membership when configured;
9. revoke sessions;
10. append audit/outbox records.

External notifications occur after commit.

Historical personnel records remain accessible according to permissions and retention.
