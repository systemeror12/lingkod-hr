# Recruitment and Selection Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Request to Fill and Publication

```sql
CREATE TABLE requests_to_fill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  requesting_unit_id uuid NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  justification text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','FOR_REVIEW','APPROVED','REJECTED','CANCELLED','CLOSED')),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  FOREIGN KEY (agency_id, requesting_unit_id)
    REFERENCES organization_units (agency_id, id),
  FOREIGN KEY (agency_id, requested_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX requests_to_fill_active_position_uq
ON requests_to_fill (agency_id, position_id)
WHERE status IN ('SUBMITTED','FOR_REVIEW','APPROVED');
```

```sql
CREATE TABLE vacancy_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  request_to_fill_id uuid NOT NULL,
  publication_no citext NOT NULL,
  qualification_standard_version_id uuid NOT NULL,
  opening_date date NOT NULL,
  closing_date date NOT NULL,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL
    CHECK (status IN ('DRAFT','FOR_APPROVAL','PUBLISHED','CLOSED','CANCELLED','REPUBLISHED')),
  republication_of_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closing_date >= opening_date),
  FOREIGN KEY (agency_id, request_to_fill_id)
    REFERENCES requests_to_fill (agency_id, id),
  FOREIGN KEY (agency_id, qualification_standard_version_id)
    REFERENCES qualification_standard_versions (agency_id, id),
  FOREIGN KEY (republication_of_id)
    REFERENCES vacancy_publications(id) ON DELETE RESTRICT,
  UNIQUE (agency_id, publication_no),
  UNIQUE (agency_id, id)
);
```

---

## 2. Applicants and Applications

```sql
CREATE TABLE applicants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  suffix text,
  email_normalized citext,
  mobile_number text,
  privacy_notice_version text NOT NULL,
  consented_at timestamptz NOT NULL,
  deduplication_key bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, id)
);

CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  vacancy_publication_id uuid NOT NULL,
  applicant_id uuid NOT NULL,
  application_no citext NOT NULL,
  status text NOT NULL
    CHECK (status IN (
      'RECEIVED','INCOMPLETE','QUALIFIED','NOT_QUALIFIED',
      'FOR_ASSESSMENT','FOR_INTERVIEW','FOR_DELIBERATION',
      'RECOMMENDED','NOT_RECOMMENDED','SELECTED',
      'NOT_SELECTED','WITHDRAWN','CLOSED'
    )),
  received_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, vacancy_publication_id)
    REFERENCES vacancy_publications (agency_id, id),
  FOREIGN KEY (agency_id, applicant_id)
    REFERENCES applicants (agency_id, id),
  UNIQUE (vacancy_publication_id, applicant_id),
  UNIQUE (agency_id, application_no),
  UNIQUE (agency_id, id)
);
```

Applicant documents should link through the shared document service.

---

## 3. Screening and Assessment

```sql
CREATE TABLE application_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL,
  qualification_standard_version_id uuid NOT NULL,
  result text NOT NULL
    CHECK (result IN ('QUALIFIED','NOT_QUALIFIED','INCOMPLETE','FOR_REVIEW')),
  education_result text NOT NULL
    CHECK (education_result IN ('MEETS','DOES_NOT_MEET','UNVERIFIED')),
  training_result text NOT NULL
    CHECK (training_result IN ('MEETS','DOES_NOT_MEET','UNVERIFIED')),
  experience_result text NOT NULL
    CHECK (experience_result IN ('MEETS','DOES_NOT_MEET','UNVERIFIED')),
  eligibility_result text NOT NULL
    CHECK (eligibility_result IN ('MEETS','DOES_NOT_MEET','UNVERIFIED')),
  screened_by_membership_id uuid NOT NULL,
  screened_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  version_no integer NOT NULL DEFAULT 1,
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  FOREIGN KEY (agency_id, qualification_standard_version_id)
    REFERENCES qualification_standard_versions (agency_id, id),
  FOREIGN KEY (agency_id, screened_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (application_id, version_no)
);
```

```sql
CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL,
  assessment_type text NOT NULL,
  scheduled_at timestamptz,
  maximum_score numeric(12,4),
  score numeric(12,4),
  rating text,
  status text NOT NULL
    CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED','NO_SHOW')),
  evaluated_by_membership_id uuid,
  CHECK (
    score IS NULL OR maximum_score IS NULL
    OR (score >= 0 AND score <= maximum_score)
  ),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id)
);
```

---

## 4. Interviews

```sql
CREATE TABLE interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  location_or_link text,
  panel_name text,
  status text NOT NULL
    CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED','NO_SHOW')),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE interview_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  interview_id uuid NOT NULL,
  interviewer_membership_id uuid NOT NULL,
  score numeric(12,4),
  recommendation text NOT NULL
    CHECK (recommendation IN ('PROCEED','HOLD','DO_NOT_PROCEED')),
  comments text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, interview_id)
    REFERENCES interviews (agency_id, id),
  FOREIGN KEY (agency_id, interviewer_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (interview_id, interviewer_membership_id)
);
```

After deliberation starts, feedback should be immutable.

---

## 5. Selection Board

```sql
CREATE TABLE selection_board_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  vacancy_publication_id uuid NOT NULL,
  session_date date NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
  quorum_required integer NOT NULL CHECK (quorum_required > 0),
  minutes_document_id uuid,
  FOREIGN KEY (agency_id, vacancy_publication_id)
    REFERENCES vacancy_publications (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE board_member_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  board_role text NOT NULL
    CHECK (board_role IN ('CHAIR','MEMBER','SECRETARIAT','OBSERVER')),
  attendance_status text NOT NULL
    CHECK (attendance_status IN ('PRESENT','ABSENT','RECUSED')),
  signed_at timestamptz,
  FOREIGN KEY (agency_id, session_id)
    REFERENCES selection_board_sessions (agency_id, id),
  FOREIGN KEY (agency_id, membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (session_id, membership_id),
  UNIQUE (agency_id, id)
);
```

```sql
CREATE TABLE conflict_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  participation_id uuid NOT NULL,
  application_id uuid,
  has_conflict boolean NOT NULL,
  details text,
  declared_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, participation_id)
    REFERENCES board_member_participations (agency_id, id),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id)
);
```

---

## 6. Recommendation and Decision

```sql
CREATE TABLE board_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  application_id uuid NOT NULL,
  rank_no integer CHECK (rank_no IS NULL OR rank_no > 0),
  recommendation text NOT NULL
    CHECK (recommendation IN ('RECOMMENDED','NOT_RECOMMENDED','RESERVE')),
  composite_score numeric(12,4),
  reason text,
  approved_at timestamptz,
  FOREIGN KEY (agency_id, session_id)
    REFERENCES selection_board_sessions (agency_id, id),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  UNIQUE (session_id, application_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE selection_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL,
  decision text NOT NULL
    CHECK (decision IN ('SELECTED','NOT_SELECTED','RETURNED')),
  decided_by_membership_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  authority_document_id uuid,
  status text NOT NULL DEFAULT 'EFFECTIVE'
    CHECK (status IN ('EFFECTIVE','SUPERSEDED','VOIDED')),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  FOREIGN KEY (agency_id, decided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id)
);

CREATE UNIQUE INDEX selection_decisions_one_effective_uq
ON selection_decisions (application_id)
WHERE status = 'EFFECTIVE';
```

---

## 7. RLS and Immutability

Enable RLS on every table.

After board session completion:

- board participation;
- conflict declarations;
- recommendations;
- submitted feedback

should be protected by immutable-record triggers.

Recruitment records are archived rather than deleted after screening or decision.
