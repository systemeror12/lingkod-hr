# Appointment and Personnel Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.1
**Date:** September 6, 2026

---

## 1. Appointments

```sql
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  recruitment_handoff_id uuid NOT NULL,
  recruitment_selection_package jsonb NOT NULL,
  position_id uuid NOT NULL,
  appointee_person_key uuid NOT NULL,
  workflow_status text NOT NULL
    CHECK (workflow_status IN ('DRAFT','FOR_REVIEW','FOR_SIGNATURE','ISSUED','CANCELLED')),
  current_version_id uuid,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, recruitment_handoff_id),
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
  employment_status text NOT NULL,
  nature_of_appointment text NOT NULL,
  form_variant text NOT NULL CHECK (form_variant IN ('CS_FORM_33_A_2025','CS_FORM_33_B_2025')),
  signature_method text NOT NULL CHECK (signature_method IN ('WET_INK','ELECTRONIC','DIGITAL_CERTIFICATE')),
  signature_evidence_document_version_id uuid,
  appointment_document_version_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ISSUED','SUPERSEDED')),
  CHECK (signature_method = 'WET_INK' OR signature_evidence_document_version_id IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, appointment_id)
    REFERENCES appointments (agency_id, id),
  FOREIGN KEY (agency_id, appointing_authority_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, appointment_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, signature_evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (appointment_id, version_no),
  UNIQUE (agency_id, appointment_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE appointment_document_version_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_version_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  link_role text NOT NULL
    CHECK (link_role IN ('PDS','WORK_EXPERIENCE_SHEET','ELIGIBILITY_PROOF','POSITION_DESCRIPTION_FORM','SELECTION_CERTIFICATION','PUBLICATION_CERTIFICATION','AUTHORITY_OR_DELEGATION','CONDITION_SPECIFIC_ATTACHMENT')),
  FOREIGN KEY (agency_id, appointment_version_id)
    REFERENCES appointment_versions (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (appointment_version_id, document_version_id, link_role),
  UNIQUE (agency_id, id)
);

ALTER TABLE appointments
ADD CONSTRAINT appointments_current_version_fk
FOREIGN KEY (agency_id, id, current_version_id)
REFERENCES appointment_versions (agency_id, appointment_id, id);

CREATE TABLE appointment_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_version_id uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  evidence_document_version_id uuid NOT NULL,
  FOREIGN KEY (agency_id, appointment_version_id)
    REFERENCES appointment_versions (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (appointment_version_id),
  UNIQUE (agency_id, id)
);
```

Appointment receives `recruitment_handoff_id` through Recruitment's application service and revalidates `position_id` and its reservation through Plantilla's application service. These identifiers are integration references, not permission to read or write another module's tables.

The evidenced Agency regulatory or accreditation status selects exactly one supported variant of CS Form No. 33, Revised 2025 and its submission package. The regulated path pairs CS Form No. 33-A, Revised 2025 with CS Form No. 1, Revised 2025; the accredited or deregulated path pairs CS Form No. 33-B, Revised 2025 with CS Form No. 2, Revised 2025. Missing configuration blocks issuance. Electronic and digital signature methods require their applicable evidence Document Version. Issuance freezes the complete Appointment Version, exact signed Document Version, authority, issue date, and acknowledgment path as the Issued Appointment Contract. Issued versions and links receive immutable triggers.

`appointment_document_version_links.link_role` identifies the applicable PDS, Work Experience Sheet, eligibility proof, Position Description Form, selection and publication certifications, authority or delegation evidence, and any condition-specific attachment. Each link targets the exact retained Document Version.

---

## 2. External Submission and CSC Action History

```sql
CREATE TABLE appointment_external_submission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_version_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('SUBMITTED','RECEIVED','RETURNED','RESUBMITTED')),
  external_reference text,
  occurred_at timestamptz NOT NULL,
  receiving_office text NOT NULL,
  recorded_by_membership_id uuid NOT NULL,
  reason text,
  evidence_document_version_id uuid NOT NULL,
  FOREIGN KEY (agency_id, appointment_version_id)
    REFERENCES appointment_versions (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE appointment_external_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_version_id uuid NOT NULL,
  action text NOT NULL
    CHECK (action IN ('APPROVED','DISAPPROVED','VALIDATED','INVALIDATED')),
  external_reference text NOT NULL,
  action_at timestamptz NOT NULL,
  recorded_by_membership_id uuid NOT NULL,
  reason text,
  evidence_document_version_id uuid NOT NULL,
  FOREIGN KEY (agency_id, appointment_version_id)
    REFERENCES appointment_versions (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Both tables are append-only. They are the source of truth for any derived external standing and never change Appointment Workflow Status, Employment Status, Nature of Appointment, or the issued version. Regulated agencies use approval or disapproval; accredited or deregulated agencies use validation or invalidation. Recall, appeal, and finality remain disabled until their separate evidence-backed contracts exist.

External tracking is evidentiary only. The HRIS does not call or scrape a CSC system, and download, internal approval, elapsed time, or missing response never creates an external event.

---

## 3. Oath and Assumption

```sql
CREATE TABLE oaths_of_office (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_version_id uuid NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, appointment_version_id)
    REFERENCES appointment_versions (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (appointment_version_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE oath_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  oath_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  oath_date date NOT NULL,
  administered_by_membership_id uuid NOT NULL,
  authority text NOT NULL,
  place text,
  permitted_virtual_method text,
  document_version_id uuid NOT NULL,
  replaces_oath_version_id uuid,
  correction_reason text,
  correction_authority_document_version_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, oath_id)
    REFERENCES oaths_of_office (agency_id, id),
  FOREIGN KEY (agency_id, administered_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, replaces_oath_version_id)
    REFERENCES oath_versions (agency_id, id),
  FOREIGN KEY (agency_id, correction_authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (oath_id, version_no),
  UNIQUE (agency_id, oath_id, id),
  UNIQUE (agency_id, id)
);

ALTER TABLE oaths_of_office
ADD CONSTRAINT oaths_of_office_current_version_fk
FOREIGN KEY (agency_id, id, current_version_id)
REFERENCES oath_versions (agency_id, oath_id, id);

CREATE TABLE assumptions_to_duty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  appointment_version_id uuid NOT NULL,
  current_version_id uuid,
  status text NOT NULL
    CHECK (status IN ('PENDING','ASSUMED','DID_NOT_ASSUME','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, appointment_version_id)
    REFERENCES appointment_versions (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (appointment_version_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE assumption_outcome_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  assumption_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('DID_NOT_ASSUME','CANCELLED')),
  notice_date date,
  deadline_date date,
  outcome_date date NOT NULL,
  reason text NOT NULL,
  authorized_by_membership_id uuid NOT NULL,
  authority_document_version_id uuid NOT NULL,
  evidence_document_version_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome <> 'DID_NOT_ASSUME' OR (notice_date IS NOT NULL AND deadline_date IS NOT NULL)),
  FOREIGN KEY (agency_id, assumption_id)
    REFERENCES assumptions_to_duty (agency_id, id),
  FOREIGN KEY (agency_id, authorized_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (assumption_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE assumption_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  assumption_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  oath_version_id uuid NOT NULL,
  actual_assumption_date date NOT NULL,
  certified_by_membership_id uuid NOT NULL,
  certifying_authority text NOT NULL,
  certified_at timestamptz NOT NULL,
  document_version_id uuid NOT NULL,
  replaces_assumption_version_id uuid,
  correction_reason text,
  correction_authority_document_version_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, assumption_id)
    REFERENCES assumptions_to_duty (agency_id, id),
  FOREIGN KEY (agency_id, oath_version_id)
    REFERENCES oath_versions (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, replaces_assumption_version_id)
    REFERENCES assumption_versions (agency_id, id),
  FOREIGN KEY (agency_id, correction_authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (assumption_id, version_no),
  UNIQUE (agency_id, assumption_id, id),
  UNIQUE (agency_id, id)
);

ALTER TABLE assumptions_to_duty
ADD CONSTRAINT assumptions_to_duty_current_version_fk
FOREIGN KEY (agency_id, id, current_version_id)
REFERENCES assumption_versions (agency_id, assumption_id, id);

CREATE TABLE service_activation_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  assumption_version_id uuid NOT NULL,
  contract_schema_version integer NOT NULL CHECK (contract_schema_version > 0),
  contract_payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  personnel_completed_at timestamptz,
  plantilla_completed_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (agency_id, assumption_version_id)
    REFERENCES assumption_versions (agency_id, id),
  UNIQUE (agency_id, idempotency_key),
  UNIQUE (assumption_version_id),
  UNIQUE (agency_id, id)
);
```

Oath and Assumption Versions are immutable. Replacement rows preserve reason, authority, evidence, and their predecessors. `ASSUMED` requires the exact current Oath Version and Assumption Document Version, actual date, certifying authority, and certification time. Appointment issuance date versus assumption date is validated before effectuation.

CSC approval or validation is not a prerequisite. External tracking and oath or assumption advance independently after the appointee acknowledges the Issued Appointment Contract. Failure to assume and lawful pre-assumption cancellation preserve notice, authority, dates, and exact evidence before asking Plantilla to release the reservation.

The versioned `contract_payload` is validated against `contract_schema_version`, then stored immutably. It contains the person, Employment Status, Nature of Appointment, issue and effectivity dates, reserved position and organization, compensation, exact oath and assumption evidence, actual assumption date, certifying authority, and derived external standing at publication. Favorable CSC action is never required. Appointment orchestrates one atomic, idempotent business event while Personnel creates the Employee and Service Segment and Plantilla creates Position Incumbency. No module writes another module's tables directly.

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
  source_assumption_version_id uuid,
  personnel_action_id uuid,
  position_id uuid,
  organization_unit_id uuid NOT NULL,
  employment_status text NOT NULL,
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
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  FOREIGN KEY (agency_id, organization_unit_id)
    REFERENCES organization_units (agency_id, id),
  UNIQUE (agency_id, id)
);
```

`source_assumption_version_id` is copied from the Appointment application-service contract and is not a cross-module foreign key. Selection Decision or Appointment issuance alone cannot create a Service Segment.

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
    CHECK (identifier_type IN ('UMID','PAGIBIG','PHILHEALTH','PHILSYS_PCN','TIN')),
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
