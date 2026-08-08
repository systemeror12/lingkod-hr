# Organization and Plantilla Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Organization Structure

```sql
CREATE TABLE organization_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  unit_type text NOT NULL
    CHECK (unit_type IN ('DEPARTMENT','BUREAU','SERVICE','DIVISION','SECTION','OFFICE','OTHER')),
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','ABOLISHED')),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE organization_unit_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  organization_unit_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  name text NOT NULL,
  parent_unit_id uuid,
  head_position_id uuid,
  cost_center_code text,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, organization_unit_id)
    REFERENCES organization_units (agency_id, id),
  FOREIGN KEY (agency_id, parent_unit_id)
    REFERENCES organization_units (agency_id, id),
  UNIQUE (organization_unit_id, version_no),
  UNIQUE (agency_id, id)
);
```

Prevent effective-period overlap:

```sql
ALTER TABLE organization_unit_versions
ADD CONSTRAINT organization_unit_versions_no_overlap
EXCLUDE USING gist (
  agency_id WITH =,
  organization_unit_id WITH =,
  daterange(
    effective_from,
    COALESCE(effective_to + 1, 'infinity'::date),
    '[)'
  ) WITH &&
)
WHERE (status <> 'SUPERSEDED');
```

Hierarchy cycles should be prevented through an application service and verified through a recursive SQL query before activation.

---

## 2. Staffing Authorities

```sql
CREATE TABLE staffing_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  authority_type text NOT NULL
    CHECK (authority_type IN ('LAW','EXECUTIVE_ORDER','DBM_APPROVAL','BOARD_RESOLUTION','OTHER')),
  reference_no citext NOT NULL,
  issued_date date NOT NULL,
  effective_date date NOT NULL,
  document_id uuid,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, authority_type, reference_no),
  UNIQUE (agency_id, id)
);
```

---

## 3. Qualification Standards

```sql
CREATE TABLE qualification_standards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE qualification_standard_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  qualification_standard_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  education_requirement text,
  training_hours_required numeric(12,4)
    CHECK (training_hours_required IS NULL OR training_hours_required >= 0),
  experience_months_required integer
    CHECK (experience_months_required IS NULL OR experience_months_required >= 0),
  eligibility_requirement text,
  competency_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  license_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, qualification_standard_id)
    REFERENCES qualification_standards (agency_id, id),
  UNIQUE (qualification_standard_id, version_no),
  UNIQUE (agency_id, id)
);
```

Add a no-overlap exclusion constraint per qualification standard.

---

## 4. Plantilla Positions

```sql
CREATE TABLE plantilla_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  item_number citext NOT NULL,
  status text NOT NULL
    CHECK (status IN ('PROPOSED','AUTHORIZED','VACANT','RESERVED','OCCUPIED','FROZEN','ABOLISHED')),
  current_version_id uuid,
  created_from_authority_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, created_from_authority_id)
    REFERENCES staffing_authorities (agency_id, id),
  UNIQUE (agency_id, item_number),
  UNIQUE (agency_id, id)
);

CREATE TABLE position_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  organization_unit_id uuid NOT NULL,
  qualification_standard_version_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  position_title text NOT NULL,
  parenthetical_title text,
  salary_grade integer NOT NULL CHECK (salary_grade > 0),
  funding_source text,
  employment_category text NOT NULL
    CHECK (employment_category IN ('PLANTILLA','CASUAL','CONTRACTUAL','OTHER')),
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED','VOIDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  FOREIGN KEY (agency_id, organization_unit_id)
    REFERENCES organization_units (agency_id, id),
  FOREIGN KEY (agency_id, qualification_standard_version_id)
    REFERENCES qualification_standard_versions (agency_id, id),
  UNIQUE (position_id, version_no),
  UNIQUE (agency_id, id)
);
```

No-overlap constraint:

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
WHERE (status NOT IN ('SUPERSEDED','VOIDED'));
```

---

## 5. Position Incumbency

```sql
CREATE TABLE position_incumbencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  service_segment_id uuid NOT NULL,
  appointment_id uuid,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','ENDED','VOIDED')),
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  UNIQUE (agency_id, id)
);
```

After employee/service tables exist, add agency-safe foreign keys.

Enforce one active incumbent:

```sql
CREATE UNIQUE INDEX position_incumbencies_one_active_uq
ON position_incumbencies (agency_id, position_id)
WHERE status = 'ACTIVE' AND effective_to IS NULL;
```

Also use an exclusion constraint to prevent overlapping historical incumbencies for the same position.

---

## 6. Position Documents

```sql
CREATE TABLE position_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_type text NOT NULL,
  effective_from date,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  UNIQUE (position_id, document_id, document_type)
);
```

---

## 7. RLS and Indexes

Enable RLS on all tables.

Important indexes:

```sql
CREATE INDEX organization_unit_versions_parent_idx
  ON organization_unit_versions (agency_id, parent_unit_id, effective_from);

CREATE INDEX position_versions_unit_idx
  ON position_versions (agency_id, organization_unit_id, effective_from);

CREATE INDEX plantilla_positions_status_idx
  ON plantilla_positions (agency_id, status);

CREATE INDEX position_incumbencies_employee_idx
  ON position_incumbencies (agency_id, employee_id, effective_from DESC);
```

---

## 8. Database Invariants

- `OCCUPIED` position requires one active incumbency.
- `VACANT`, `RESERVED`, and `FROZEN` positions cannot have an active incumbency.
- Position state and incumbency changes occur in one transaction.
- Abolition closes active position versions and incumbencies prospectively.
- Reorganization does not update historical position or unit versions.
