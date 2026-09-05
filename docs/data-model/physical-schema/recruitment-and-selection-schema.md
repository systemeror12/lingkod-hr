# Recruitment and Selection Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.1
**Date:** September 6, 2026

---

## 1. Request to Fill and Publication

Agency Merit Selection Plan Versions, Merit Selection Criteria Sets, Board Definitions, Board Appointments, and Approval Route Versions are effective-dated configuration. The application service resolves them from trusted Agency Context, position scope, action type, and relevant date; the client does not choose them.

```sql
CREATE TABLE agency_merit_selection_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  plan_code citext NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  applicability jsonb NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  approval_document_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, approval_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, plan_code, version_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE merit_selection_criteria_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  merit_selection_plan_version_id uuid NOT NULL,
  criteria_code citext NOT NULL,
  applicability jsonb NOT NULL,
  criteria_definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, merit_selection_plan_version_id)
    REFERENCES agency_merit_selection_plan_versions (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (merit_selection_plan_version_id, criteria_code),
  UNIQUE (agency_id, id)
);

CREATE TABLE board_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  merit_selection_plan_version_id uuid NOT NULL,
  board_code citext NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  applicability jsonb NOT NULL,
  seat_definition jsonb NOT NULL,
  quorum_definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, merit_selection_plan_version_id)
    REFERENCES agency_merit_selection_plan_versions (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, board_code, version_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE requests_to_fill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL,
  requesting_unit_id uuid NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  justification text NOT NULL,
  qualification_standard_version_id uuid,
  merit_selection_plan_version_id uuid,
  merit_selection_criteria_set_id uuid,
  board_definition_id uuid,
  current_binding_set_no integer,
  bindings_resolved_at timestamptz,
  bindings_frozen_at timestamptz,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','FOR_REVIEW','APPROVED','REJECTED','CANCELLED','CLOSED')),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  FOREIGN KEY (agency_id, requesting_unit_id)
    REFERENCES organization_units (agency_id, id),
  FOREIGN KEY (agency_id, requested_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, qualification_standard_version_id)
    REFERENCES qualification_standard_versions (agency_id, id),
  FOREIGN KEY (agency_id, merit_selection_plan_version_id)
    REFERENCES agency_merit_selection_plan_versions (agency_id, id),
  FOREIGN KEY (agency_id, merit_selection_criteria_set_id)
    REFERENCES merit_selection_criteria_sets (agency_id, id),
  FOREIGN KEY (agency_id, board_definition_id)
    REFERENCES board_definitions (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX requests_to_fill_active_position_uq
ON requests_to_fill (agency_id, position_id)
WHERE status IN ('SUBMITTED','FOR_REVIEW','APPROVED');

CREATE TABLE request_approval_route_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  request_to_fill_id uuid NOT NULL,
  binding_set_no integer NOT NULL CHECK (binding_set_no > 0),
  checkpoint_code citext NOT NULL,
  approval_route_version_id uuid NOT NULL,
  bound_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, request_to_fill_id)
    REFERENCES requests_to_fill (agency_id, id),
  FOREIGN KEY (agency_id, approval_route_version_id)
    REFERENCES approval_route_versions (agency_id, id),
  UNIQUE (request_to_fill_id, binding_set_no, checkpoint_code),
  UNIQUE (agency_id, id)
);

CREATE TABLE request_msp_rebaselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  request_to_fill_id uuid NOT NULL,
  former_merit_selection_plan_version_id uuid NOT NULL,
  former_merit_selection_criteria_set_id uuid NOT NULL,
  former_board_definition_id uuid NOT NULL,
  replacement_merit_selection_plan_version_id uuid NOT NULL,
  replacement_merit_selection_criteria_set_id uuid NOT NULL,
  replacement_board_definition_id uuid NOT NULL,
  former_binding_set_no integer NOT NULL CHECK (former_binding_set_no > 0),
  replacement_binding_set_no integer NOT NULL CHECK (replacement_binding_set_no > 0),
  reason text NOT NULL,
  authorized_by_membership_id uuid NOT NULL,
  authority_document_version_id uuid NOT NULL,
  rebaselined_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, request_to_fill_id)
    REFERENCES requests_to_fill (agency_id, id),
  FOREIGN KEY (agency_id, authorized_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, former_merit_selection_plan_version_id)
    REFERENCES agency_merit_selection_plan_versions (agency_id, id),
  FOREIGN KEY (agency_id, former_merit_selection_criteria_set_id)
    REFERENCES merit_selection_criteria_sets (agency_id, id),
  FOREIGN KEY (agency_id, former_board_definition_id)
    REFERENCES board_definitions (agency_id, id),
  FOREIGN KEY (agency_id, replacement_merit_selection_plan_version_id)
    REFERENCES agency_merit_selection_plan_versions (agency_id, id),
  FOREIGN KEY (agency_id, replacement_merit_selection_criteria_set_id)
    REFERENCES merit_selection_criteria_sets (agency_id, id),
  FOREIGN KEY (agency_id, replacement_board_definition_id)
    REFERENCES board_definitions (agency_id, id),
  UNIQUE (agency_id, id)
);
```

The Qualification Standard Version, all governing identifiers, and route bindings are required before approval. The application service rejects zero or multiple matches, freezes the bindings when a publication becomes `PUBLISHED`, and permits rebaseline only before that point. The Reference Agency Profile has no active invented configuration.

```sql
CREATE TABLE vacancy_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  request_to_fill_id uuid NOT NULL,
  publication_no citext NOT NULL,
  qualification_standard_version_id uuid NOT NULL,
  form_document_version_id uuid NOT NULL,
  opening_date date NOT NULL,
  closing_date date NOT NULL,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact_details jsonb NOT NULL,
  certified_by_membership_id uuid NOT NULL,
  certified_at timestamptz NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','FOR_APPROVAL','PUBLISHED','CLOSED','CANCELLED','REPUBLISHED')),
  republication_of_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  CHECK (closing_date >= opening_date),
  FOREIGN KEY (agency_id, request_to_fill_id)
    REFERENCES requests_to_fill (agency_id, id),
  FOREIGN KEY (agency_id, qualification_standard_version_id)
    REFERENCES qualification_standard_versions (agency_id, id),
  FOREIGN KEY (agency_id, form_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, republication_of_id)
    REFERENCES vacancy_publications (agency_id, id) ON DELETE RESTRICT,
  UNIQUE (agency_id, publication_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE vacancy_publication_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  vacancy_publication_id uuid NOT NULL,
  channel_type text NOT NULL
    CHECK (channel_type IN ('CSC_FIELD_OFFICE','CSC_JOB_PORTAL','AGENCY_POSTING_PLACE','SUPPLEMENTAL')),
  location_or_reference text NOT NULL,
  published_at timestamptz,
  removed_at timestamptz,
  evidence_document_version_id uuid NOT NULL,
  FOREIGN KEY (agency_id, vacancy_publication_id)
    REFERENCES vacancy_publications (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (vacancy_publication_id, channel_type, location_or_reference),
  UNIQUE (agency_id, id)
);
```

The ordinary Reference Agency path requires the CSC Field Office submission, CSC Job Portal entry, and three Agency posting locations for at least ten calendar days. Unsupported exceptions fail closed. A material correction creates a cancelled, linked republication.

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
  replaces_screening_id uuid,
  correction_authority_document_version_id uuid,
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  FOREIGN KEY (agency_id, qualification_standard_version_id)
    REFERENCES qualification_standard_versions (agency_id, id),
  FOREIGN KEY (agency_id, screened_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, replaces_screening_id)
    REFERENCES application_screenings (agency_id, id),
  FOREIGN KEY (agency_id, correction_authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (application_id, version_no)
);
```

```sql
CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL,
  merit_selection_criteria_set_id uuid NOT NULL,
  assessment_type text NOT NULL,
  scheduled_at timestamptz,
  status text NOT NULL
    CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED','NO_SHOW')),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  FOREIGN KEY (agency_id, merit_selection_criteria_set_id)
    REFERENCES merit_selection_criteria_sets (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE assessment_result_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  assessment_id uuid NOT NULL,
  criterion_code citext NOT NULL,
  evaluated_by_membership_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  score numeric(12,4) NOT NULL,
  rating text,
  evidence_document_version_id uuid NOT NULL,
  replaces_result_id uuid,
  correction_reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, assessment_id)
    REFERENCES assessments (agency_id, id),
  FOREIGN KEY (agency_id, evaluated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, replaces_result_id)
    REFERENCES assessment_result_versions (agency_id, id),
  UNIQUE (assessment_id, criterion_code, evaluated_by_membership_id, version_no),
  UNIQUE (agency_id, id)
);
```

The bound Merit Selection Criteria Set supplies weights, scales, cutoffs, rounding, tie rules, evidence requirements, and evaluator eligibility. Result rows are immutable; a correction appends a replacement.

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
CREATE TABLE board_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  board_definition_id uuid NOT NULL,
  seat_code citext NOT NULL,
  membership_id uuid NOT NULL,
  appointment_kind text NOT NULL CHECK (appointment_kind IN ('PRINCIPAL','ALTERNATE')),
  effective_from date NOT NULL,
  effective_to date,
  authority_document_version_id uuid NOT NULL,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, board_definition_id)
    REFERENCES board_definitions (agency_id, id),
  UNIQUE (board_definition_id, seat_code, membership_id, effective_from),
  UNIQUE (agency_id, id)
);

CREATE TABLE selection_board_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  vacancy_publication_id uuid NOT NULL,
  session_date date NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
  roster_frozen_at timestamptz,
  minutes_document_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid NOT NULL,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, vacancy_publication_id)
    REFERENCES vacancy_publications (agency_id, id),
  FOREIGN KEY (agency_id, minutes_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, updated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE board_roster_snapshot_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  board_appointment_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  seat_code citext NOT NULL,
  is_voting boolean NOT NULL,
  FOREIGN KEY (agency_id, session_id)
    REFERENCES selection_board_sessions (agency_id, id),
  FOREIGN KEY (agency_id, board_appointment_id)
    REFERENCES board_appointments (agency_id, id),
  FOREIGN KEY (agency_id, membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (session_id, seat_code),
  UNIQUE (session_id, board_appointment_id),
  UNIQUE (session_id, membership_id),
  UNIQUE (agency_id, id, membership_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE board_member_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  roster_snapshot_member_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  board_role text NOT NULL
    CHECK (board_role IN ('CHAIR','MEMBER','SECRETARIAT','OBSERVER')),
  attendance_status text NOT NULL
    CHECK (attendance_status IN ('PRESENT','ABSENT','RECUSED')),
  signed_at timestamptz,
  FOREIGN KEY (agency_id, session_id)
    REFERENCES selection_board_sessions (agency_id, id),
  FOREIGN KEY (agency_id, roster_snapshot_member_id, membership_id)
    REFERENCES board_roster_snapshot_members (agency_id, id, membership_id),
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

CREATE TABLE applicant_quorum_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  application_id uuid NOT NULL,
  eligible_voting_members integer NOT NULL CHECK (eligible_voting_members > 0),
  required_voting_members integer NOT NULL CHECK (required_voting_members > 0),
  present_voting_members integer NOT NULL CHECK (present_voting_members >= 0),
  satisfied boolean NOT NULL,
  frozen_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, session_id)
    REFERENCES selection_board_sessions (agency_id, id),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  UNIQUE (session_id, application_id),
  UNIQUE (agency_id, id)
);
```

Board Appointments are effective-dated and immutable after activation. Snapshot rows copy the resolved Agency Membership, seat, and voting status so later Board Appointment changes cannot alter a session. The application service prevents one membership from filling two voting seats or acting as both voting member and secretariat. Applicant-specific conflicts and recusals are excluded before quorum is frozen. Agency configuration may strengthen, but never weaken, the national majority floor. Deliberation cannot begin until the publication period has elapsed and screening is complete.

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
  finalized_at timestamptz,
  FOREIGN KEY (agency_id, session_id)
    REFERENCES selection_board_sessions (agency_id, id),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  UNIQUE (session_id, application_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE candidate_evaluation_report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  report_document_version_id uuid NOT NULL,
  report_data jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, session_id)
    REFERENCES selection_board_sessions (agency_id, id),
  FOREIGN KEY (agency_id, report_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (session_id, version_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE selection_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL,
  decision text NOT NULL
    CHECK (decision IN ('SELECTED','NOT_SELECTED')),
  decided_by_membership_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  authority_document_version_id uuid NOT NULL,
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  FOREIGN KEY (agency_id, decided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (application_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE recruitment_appointment_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  selection_decision_id uuid NOT NULL,
  application_id uuid NOT NULL,
  position_id uuid NOT NULL,
  selection_package jsonb NOT NULL,
  idempotency_key text NOT NULL,
  handed_off_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  FOREIGN KEY (agency_id, selection_decision_id)
    REFERENCES selection_decisions (agency_id, id),
  FOREIGN KEY (agency_id, application_id)
    REFERENCES applications (agency_id, id),
  FOREIGN KEY (agency_id, position_id)
    REFERENCES plantilla_positions (agency_id, id),
  UNIQUE (agency_id, idempotency_key),
  UNIQUE (selection_decision_id),
  UNIQUE (agency_id, id)
);
```

Board Recommendations and Comprehensive Candidate Evaluation Reports are advisory records. Selection Decisions are distinct, immutable Recruitment records. Appointment accepts the handoff through Recruitment's application service; it does not read Recruitment tables.

---

## 7. RLS and Immutability

Enable RLS on every table.

After board session completion:

- governing bindings and rebaseline history;
- publication forms and evidence;
- screening and assessment result versions;
- board roster and applicant quorum snapshots;
- board participation;
- conflict declarations;
- recommendations;
- Selection Decisions and handoffs;
- submitted feedback

should be protected by immutable-record triggers.

Recruitment records are archived rather than deleted after screening or decision.
