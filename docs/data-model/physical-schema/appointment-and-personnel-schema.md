# Appointment and Personnel Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Appointments

```sql
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  application_id uuid,
  position_id uuid NOT NULL,
  appointee_person_key uuid NOT NULL,
  appointment_type text NOT NULL,
  appointment_status text NOT NULL,
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','FOR_REVIEW','FOR_SIGNATURE','ISSUED',
      'SUBMITTED','RETURNED','VALIDATED','INVALIDATED','CANCELLED'
    )),
  current_version_id uuid,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE appointment_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  salary_grade integer NOT NULL CHECK (salary_grade > 0),
  salary_step integer NOT NULL CHECK (salary_step > 0),
  effectivity_date date NOT NULL,
  appointing_authority_membership_id uuid,
  nature_of_appointment text NOT NULL,
  form_version text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ISSUED','SUPERSEDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, appointment_id)
    REFERENCES appointments (agency_id, id),
  FOREIGN KEY (agency_id, appointing_authority_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (appointment_id, version_no),
  UNIQUE (agency_id, id)
);
```

Issued versions receive immutable triggers.

---

## 2. External Submission Tracking

```sql
CREATE TABLE appointment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL,
  submission_no text,
  submitted_at timestamptz NOT NULL,
  received_at timestamptz,
  action text NOT NULL
    CHECK (action IN ('SUBMITTED','RETURNED','RESUBMITTED','VALIDATED','INVALIDATED')),
  action_date date NOT NULL,
  reason text,
  document_id uuid,
  FOREIGN KEY (agency_id, appointment_id)
    REFERENCES appointments (agency_id, id),
  UNIQUE (agency_id, id)
);
```

This table is append-only.

---

## 3. Oath and Assumption

```sql
CREATE TABLE oaths_of_office (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL,
  oath_date date NOT NULL,
  administered_by text NOT NULL,
  place text,
  document_id uuid,
  FOREIGN KEY (agency_id, appointment_id)
    REFERENCES appointments (agency_id, id),
  UNIQUE (appointment_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE assumptions_to_duty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL,
  actual_assumption_date date,
  certified_by_membership_id uuid,
  certified_at timestamptz,
  status text NOT NULL
    CHECK (status IN ('PENDING','ASSUMED','DID_NOT_ASSUME','CANCELLED')),
  document_id uuid,
  FOREIGN KEY (agency_id, appointment_id)
    REFERENCES appointments (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (appointment_id),
  UNIQUE (agency_id, id),
  CHECK (
    status <> 'ASSUMED'
    OR (
      actual_assumption_date IS NOT NULL
      AND certified_by_membership_id IS NOT NULL
      AND certified_at IS NOT NULL
    )
  )
);
```

Appointment issuance date versus assumption date is validated in a transaction before effectuation.

---

## 4. Employees

```sql
CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_number citext NOT NULL,
  person_key uuid NOT NULL,
  membership_id uuid,
  current_service_segment_id uuid,
  status text NOT NULL
    CHECK (status IN ('PREBOARDING','ACTIVE','ON_EXTENDED_LEAVE','SUSPENDED','SEPARATED','DECEASED')),
  first_government_service_date date,
  agency_service_start_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, employee_number),
  UNIQUE (agency_id, person_key),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX employees_membership_uq
ON employees (agency_id, membership_id)
WHERE membership_id IS NOT NULL;
```

After this table exists, add the agency-safe `agency_memberships.employee_id` foreign key.

---

## 5. PDS Versioning

```sql
CREATE TABLE pds_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  form_version text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','CERTIFIED','SUPERSEDED')),
  as_of_date date NOT NULL,
  certified_by_employee_at timestamptz,
  verified_by_membership_id uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, verified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (employee_id, version_no),
  UNIQUE (agency_id, id)
);
```

Repeated sections use separate normalized tables.

Example:

```sql
CREATE TABLE education_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  pds_version_id uuid NOT NULL,
  level text NOT NULL,
  school_name text NOT NULL,
  degree_course text,
  period_from date,
  period_to date,
  highest_level_units text,
  year_graduated integer,
  honors text,
  sequence_no integer NOT NULL DEFAULT 1,
  FOREIGN KEY (agency_id, pds_version_id)
    REFERENCES pds_versions (agency_id, id),
  UNIQUE (pds_version_id, sequence_no)
);
```

Create equivalent tables for:

- family records;
- eligibility records;
- work-experience records;
- training records;
- voluntary-work records;
- references.

Certified PDS versions and their children are immutable.

---

## 6. Service Segments

```sql
CREATE TABLE service_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  appointment_id uuid,
  personnel_action_id uuid,
  position_id uuid,
  organization_unit_id uuid NOT NULL,
  appointment_status text NOT NULL,
  salary_grade integer,
  salary_step integer,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','CLOSED','VOIDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, appointment_id)
    REFERENCES appointments (agency_id, id),
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  FOREIGN KEY (agency_id, organization_unit_id)
    REFERENCES organization_units (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Prevent improper overlap:

```sql
ALTER TABLE service_segments
ADD CONSTRAINT service_segments_primary_no_overlap
EXCLUDE USING gist (
  agency_id WITH =,
  employee_id WITH =,
  daterange(
    effective_from,
    COALESCE(effective_to + 1, 'infinity'::date),
    '[)'
  ) WITH &&
)
WHERE (status <> 'VOIDED');
```

If future rules permit simultaneous detail/designation segments, model those as separate assignment types instead of weakening the primary-service constraint.

---

## 7. Personnel Actions

```sql
CREATE TABLE personnel_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  action_type text NOT NULL,
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','FOR_REVIEW','FOR_APPROVAL','APPROVED',
      'EFFECTIVE','RETURNED','REJECTED','CANCELLED','SUPERSEDED'
    )),
  effectivity_date date NOT NULL,
  from_service_segment_id uuid,
  to_position_id uuid,
  authority_document_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, from_service_segment_id)
    REFERENCES service_segments (agency_id, id),
  FOREIGN KEY (agency_id, to_position_id)
    REFERENCES plantilla_positions (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Effectuation transaction:

1. lock employee;
2. lock affected position rows;
3. validate current service;
4. close prior segment/incumbency;
5. create new segment/incumbency;
6. update employee current pointer;
7. update position statuses;
8. append audit and outbox records.

---

## 8. Protected Identifiers and Bank Accounts

```sql
CREATE TABLE government_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  identifier_type text NOT NULL
    CHECK (identifier_type IN ('GSIS','PHILHEALTH','PAGIBIG','TIN','OTHER')),
  encrypted_value bytea NOT NULL,
  masked_value text NOT NULL,
  verified_at timestamptz,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','REPLACED','INVALID')),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id)
);

CREATE UNIQUE INDEX government_identifiers_one_active_uq
ON government_identifiers (agency_id, employee_id, identifier_type)
WHERE status = 'ACTIVE';
```

Use equivalent encrypted storage for bank accounts.

---

## 9. RLS

All appointment and personnel tables require agency RLS.

Additional application checks enforce:

- self-service access;
- supervisor scope;
- HR function scope;
- restricted sensitive-field permissions.

Database RLS handles tenant isolation, not full field-level authorization.
