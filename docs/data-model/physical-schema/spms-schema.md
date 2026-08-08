# SPMS Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Performance Cycles

```sql
CREATE TABLE performance_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','PLANNING','ACTIVE','MIDYEAR_REVIEW',
      'RATING','CALIBRATION','FINALIZED','CLOSED','CANCELLED'
    )),
  policy_version text NOT NULL,
  rating_scale jsonb NOT NULL,
  CHECK (period_to >= period_from),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);
```

---

## 2. Goals and Commitments

```sql
CREATE TABLE organizational_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  performance_cycle_id uuid NOT NULL,
  parent_goal_id uuid,
  organization_unit_id uuid,
  code citext NOT NULL,
  description text NOT NULL,
  weight numeric(8,4),
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
  FOREIGN KEY (agency_id, performance_cycle_id)
    REFERENCES performance_cycles (agency_id, id),
  FOREIGN KEY (agency_id, parent_goal_id)
    REFERENCES organizational_goals (agency_id, id),
  FOREIGN KEY (agency_id, organization_unit_id)
    REFERENCES organization_units (agency_id, id),
  UNIQUE (performance_cycle_id, code),
  UNIQUE (agency_id, id)
);
```

Goal hierarchy cycles are prevented through service validation.

```sql
CREATE TABLE office_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  performance_cycle_id uuid NOT NULL,
  organization_unit_id uuid NOT NULL,
  responsible_membership_id uuid,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','RETURNED','ACTIVE','FINALIZED','SUPERSEDED')),
  FOREIGN KEY (agency_id, performance_cycle_id)
    REFERENCES performance_cycles (agency_id, id),
  FOREIGN KEY (agency_id, organization_unit_id)
    REFERENCES organization_units (agency_id, id),
  FOREIGN KEY (agency_id, responsible_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (performance_cycle_id, organization_unit_id, version_no),
  UNIQUE (agency_id, id)
);
```

```sql
CREATE TABLE individual_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  performance_cycle_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  supervisor_employee_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','RETURNED','ACTIVE','FOR_RATING','RATED','FINALIZED','AMENDED')),
  submitted_at timestamptz,
  approved_at timestamptz,
  FOREIGN KEY (agency_id, performance_cycle_id)
    REFERENCES performance_cycles (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, supervisor_employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (performance_cycle_id, employee_id, version_no),
  UNIQUE (agency_id, id)
);
```

---

## 3. Success Indicators

```sql
CREATE TABLE success_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  office_commitment_id uuid,
  individual_commitment_id uuid,
  organizational_goal_id uuid,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  output_description text NOT NULL,
  measure text NOT NULL,
  target text NOT NULL,
  weight numeric(8,4) NOT NULL CHECK (weight >= 0),
  quality_criteria text,
  efficiency_criteria text,
  timeliness_criteria text,
  CHECK (
    (office_commitment_id IS NOT NULL)::integer
    + (individual_commitment_id IS NOT NULL)::integer = 1
  ),
  FOREIGN KEY (agency_id, office_commitment_id)
    REFERENCES office_commitments (agency_id, id),
  FOREIGN KEY (agency_id, individual_commitment_id)
    REFERENCES individual_commitments (agency_id, id),
  FOREIGN KEY (agency_id, organizational_goal_id)
    REFERENCES organizational_goals (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Weight totals are validated before commitment approval.

---

## 4. Accomplishments and Evidence

```sql
CREATE TABLE accomplishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  success_indicator_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  actual_result text NOT NULL,
  quantity_value numeric(19,4),
  submitted_at timestamptz,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','VERIFIED','RETURNED')),
  CHECK (period_to >= period_from),
  FOREIGN KEY (agency_id, success_indicator_id)
    REFERENCES success_indicators (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE performance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  accomplishment_id uuid NOT NULL,
  document_id uuid,
  external_reference text,
  description text,
  verified_at timestamptz,
  CHECK (document_id IS NOT NULL OR external_reference IS NOT NULL),
  FOREIGN KEY (agency_id, accomplishment_id)
    REFERENCES accomplishments (agency_id, id)
);
```

---

## 5. Coaching and Review

```sql
CREATE TABLE coaching_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  individual_commitment_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  supervisor_employee_id uuid NOT NULL,
  note_date date NOT NULL,
  note text NOT NULL,
  visibility text NOT NULL
    CHECK (visibility IN ('EMPLOYEE_AND_SUPERVISOR','HR_RESTRICTED')),
  FOREIGN KEY (agency_id, individual_commitment_id)
    REFERENCES individual_commitments (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, supervisor_employee_id)
    REFERENCES employees (agency_id, id)
);
```

```sql
CREATE TABLE performance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  individual_commitment_id uuid NOT NULL,
  review_type text NOT NULL
    CHECK (review_type IN ('MIDYEAR','FINAL','CALIBRATION','APPEAL')),
  reviewer_membership_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED')),
  comments text,
  submitted_at timestamptz,
  FOREIGN KEY (agency_id, individual_commitment_id)
    REFERENCES individual_commitments (agency_id, id),
  FOREIGN KEY (agency_id, reviewer_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

---

## 6. Rating Detail and Final Rating

```sql
CREATE TABLE rating_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  performance_review_id uuid NOT NULL,
  success_indicator_id uuid,
  component_type text NOT NULL
    CHECK (component_type IN ('OUTPUT','QUALITY','EFFICIENCY','TIMELINESS','COMPETENCY')),
  raw_score numeric(12,4) NOT NULL,
  weighted_score numeric(12,4) NOT NULL,
  rating_basis text,
  FOREIGN KEY (agency_id, performance_review_id)
    REFERENCES performance_reviews (agency_id, id),
  FOREIGN KEY (agency_id, success_indicator_id)
    REFERENCES success_indicators (agency_id, id)
);
```

```sql
CREATE TABLE performance_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  individual_commitment_id uuid NOT NULL,
  performance_review_id uuid NOT NULL,
  overall_score numeric(12,4) NOT NULL,
  adjectival_rating text NOT NULL,
  finalized_by_membership_id uuid NOT NULL,
  finalized_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('FINALIZED','SUPERSEDED')),
  FOREIGN KEY (agency_id, individual_commitment_id)
    REFERENCES individual_commitments (agency_id, id),
  FOREIGN KEY (agency_id, performance_review_id)
    REFERENCES performance_reviews (agency_id, id),
  FOREIGN KEY (agency_id, finalized_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX performance_ratings_one_final_uq
ON performance_ratings (individual_commitment_id)
WHERE status = 'FINALIZED';
```

Final ratings and rating components receive immutable triggers.

Amendments create a replacement rating plus a `rating_amendments` record.
