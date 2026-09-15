# Attendance and Leave Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.2
**Date:** September 15, 2026

---

## 1. Schedules and Work Arrangements

`work_schedules` and `work_arrangements` are stable identities. Their activated versions are immutable. Editing is allowed only while a version is `DRAFT`; normal changes activate a successor and mark the prior version `SUPERSEDED`.

```sql
CREATE TABLE work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  current_version_id uuid,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE work_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  work_schedule_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  schedule_type text NOT NULL
    CHECK (schedule_type IN ('REGULAR','FLEXIBLE','SHIFT','COMPRESSED')),
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  holiday_effect_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority_document_version_id uuid,
  approving_authority text,
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  effective_from date NOT NULL,
  effective_to date,
  activated_by_membership_id uuid,
  activated_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (status = 'DRAFT' OR (
    authority_document_version_id IS NOT NULL
    AND approving_authority IS NOT NULL
    AND activated_by_membership_id IS NOT NULL
    AND activated_at IS NOT NULL
  )),
  FOREIGN KEY (agency_id, work_schedule_id)
    REFERENCES work_schedules (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, activated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (work_schedule_id, version_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE work_schedule_day_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  work_schedule_version_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  rule_type text NOT NULL CHECK (rule_type IN ('REST','FIXED','FLEXIBLE')),
  duty_start_time time,
  earliest_start_time time,
  latest_start_time time,
  duty_end_time time,
  end_next_calendar_day boolean NOT NULL DEFAULT false,
  required_minutes integer NOT NULL CHECK (required_minutes >= 0),
  core_start_time time,
  core_end_time time,
  event_pattern text NOT NULL CHECK (event_pattern IN ('IN_OUT','WITH_BREAK_EVENTS')),
  collection_before_minutes integer NOT NULL CHECK (collection_before_minutes >= 0),
  collection_after_minutes integer NOT NULL CHECK (collection_after_minutes >= 0),
  FOREIGN KEY (agency_id, work_schedule_version_id)
    REFERENCES work_schedule_versions (agency_id, id),
  UNIQUE (work_schedule_version_id, weekday),
  UNIQUE (agency_id, id)
);

CREATE TABLE work_schedule_break_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  day_rule_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  break_start_time time NOT NULL,
  break_end_time time NOT NULL,
  end_next_calendar_day boolean NOT NULL DEFAULT false,
  FOREIGN KEY (agency_id, day_rule_id)
    REFERENCES work_schedule_day_rules (agency_id, id),
  UNIQUE (day_rule_id, sequence_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE work_arrangements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  current_version_id uuid,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE work_arrangement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  work_arrangement_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  arrangement_type text NOT NULL
    CHECK (arrangement_type IN ('ONSITE','WORK_FROM_HOME','HYBRID','FIELD','OTHER')),
  permitted_schedule_types jsonb NOT NULL,
  holiday_calendar_id uuid NOT NULL,
  authority_document_version_id uuid,
  approving_authority text,
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  effective_from date NOT NULL,
  effective_to date,
  activated_by_membership_id uuid,
  activated_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (status = 'DRAFT' OR (
    authority_document_version_id IS NOT NULL
    AND approving_authority IS NOT NULL
    AND activated_by_membership_id IS NOT NULL
    AND activated_at IS NOT NULL
  )),
  FOREIGN KEY (agency_id, work_arrangement_id)
    REFERENCES work_arrangements (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, activated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (work_arrangement_id, version_no),
  UNIQUE (agency_id, id)
);
```

Migration ordering must create Holiday Calendars before Work Arrangement Versions. Add exclusion constraints preventing overlapping `ACTIVE` versions. Validate each active Work Schedule Version as exactly seven Day Rules, fixed/flexible field completeness, non-overlapping breaks, required-minute consistency, and an unambiguous Event Collection Window. There is no implicit grace or rounding column.

For a flexible Day Rule, the first qualifying worked or Attendance Context minute within the permitted window anchors expected duty. An earlier minute clamps to the earliest permitted start. A later minute uses the latest permitted start and leaves the preceding deficit as tardiness. With no qualifying coverage, the latest permitted start places the required absent minutes. Scheduled unpaid breaks extend the derived end and do not count as expected duty.

`IN_OUT` requires `TIME_IN` then `TIME_OUT` and automatically excludes scheduled unpaid breaks. `WITH_BREAK_EVENTS` requires `TIME_IN`, paired `BREAK_OUT` and `BREAK_IN` events, then `TIME_OUT`. Missing, duplicate, or out-of-order required events are preserved and create a blocking Attendance Exception.

---

## 2. Holiday Calendars and Schedule Assignments

```sql
CREATE TABLE holiday_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('AGENCY','OFFICE','WORKSITE')),
  scope_reference text NOT NULL,
  current_version_id uuid,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE holiday_calendar_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  holiday_calendar_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  authority_document_version_id uuid,
  approving_authority text,
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  effective_from date NOT NULL,
  effective_to date,
  activated_by_membership_id uuid,
  activated_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (status = 'DRAFT' OR (
    authority_document_version_id IS NOT NULL
    AND approving_authority IS NOT NULL
    AND activated_by_membership_id IS NOT NULL
    AND activated_at IS NOT NULL
  )),
  FOREIGN KEY (agency_id, holiday_calendar_id)
    REFERENCES holiday_calendars (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, activated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (holiday_calendar_id, version_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE holiday_calendar_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  holiday_calendar_version_id uuid NOT NULL,
  holiday_date date NOT NULL,
  name text NOT NULL,
  day_type text NOT NULL CHECK (day_type IN (
    'REGULAR_HOLIDAY','SPECIAL_NON_WORKING','SPECIAL_WORKING',
    'LOCAL_HOLIDAY','WORK_SUSPENSION'
  )),
  source_reference text NOT NULL,
  FOREIGN KEY (agency_id, holiday_calendar_version_id)
    REFERENCES holiday_calendar_versions (agency_id, id),
  UNIQUE (holiday_calendar_version_id, holiday_date, day_type),
  UNIQUE (agency_id, id)
);

ALTER TABLE work_arrangement_versions
ADD FOREIGN KEY (agency_id, holiday_calendar_id)
  REFERENCES holiday_calendars (agency_id, id);

CREATE TABLE schedule_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  work_schedule_version_id uuid NOT NULL,
  work_arrangement_version_id uuid NOT NULL,
  authority_document_version_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  assigned_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, work_schedule_version_id)
    REFERENCES work_schedule_versions (agency_id, id),
  FOREIGN KEY (agency_id, work_arrangement_version_id)
    REFERENCES work_arrangement_versions (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, assigned_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Add no-overlap exclusion constraints for active calendar versions and Schedule Assignments. A valid assignment requires Attendance Applicability and active, mutually compatible schedule and arrangement versions. The arrangement selects one stable Holiday Calendar scope; calculation resolves and snapshots exactly one version effective on the Work Date. A new annual calendar version does not rewrite employee assignments.

---

## 3. Attendance Periods, Events, and Context

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

CREATE TABLE attendance_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  context_type text NOT NULL CHECK (context_type IN (
    'OFFICIAL_BUSINESS','OFFICIAL_TRAVEL','TRAINING','APPROVED_ABSENCE'
  )),
  coverage_mode text NOT NULL CHECK (coverage_mode IN ('WHOLE_WORK_DATE','TIMED')),
  work_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  reason text NOT NULL,
  source_type text,
  source_id uuid,
  evidence_document_version_id uuid,
  entered_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (coverage_mode = 'WHOLE_WORK_DATE' AND work_date IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL)
    OR (coverage_mode = 'TIMED' AND work_date IS NULL AND starts_at IS NOT NULL AND ends_at > starts_at)
  ),
  CHECK ((source_type IS NOT NULL AND source_id IS NOT NULL) OR evidence_document_version_id IS NOT NULL),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, entered_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

No biometric source is included in the MVP.

Events and Attendance Context are append-only. Approved Attendance Corrections retain the original and add, replace, or void its effect on later calculations. `AM_IN`, `AM_OUT`, `PM_IN`, and `PM_OUT` are DTR presentation slots, not stored event types.

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
  work_schedule_version_id uuid,
  work_arrangement_version_id uuid,
  holiday_calendar_version_id uuid,
  day_classification text NOT NULL CHECK (day_classification IN ('SCHEDULED','UNSCHEDULED_SERVICE')),
  status text NOT NULL
    CHECK (status IN ('PENDING','CALCULATED','EXCEPTION','FOR_REVIEW','APPROVED','LOCKED','ADJUSTED')),
  expected_minutes integer NOT NULL DEFAULT 0 CHECK (expected_minutes >= 0),
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  coverage_minutes integer NOT NULL DEFAULT 0 CHECK (coverage_minutes >= 0),
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  undertime_minutes integer NOT NULL DEFAULT 0 CHECK (undertime_minutes >= 0),
  absence_minutes integer NOT NULL DEFAULT 0 CHECK (absence_minutes >= 0),
  official_business_minutes integer NOT NULL DEFAULT 0 CHECK (official_business_minutes >= 0),
  official_travel_minutes integer NOT NULL DEFAULT 0 CHECK (official_travel_minutes >= 0),
  training_minutes integer NOT NULL DEFAULT 0 CHECK (training_minutes >= 0),
  approved_absence_minutes integer NOT NULL DEFAULT 0 CHECK (approved_absence_minutes >= 0),
  posted_leave_minutes integer NOT NULL DEFAULT 0 CHECK (posted_leave_minutes >= 0),
  outside_schedule_minutes integer NOT NULL DEFAULT 0 CHECK (outside_schedule_minutes >= 0),
  statutory_night_window_minutes integer NOT NULL DEFAULT 0 CHECK (statutory_night_window_minutes >= 0),
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
  FOREIGN KEY (agency_id, work_schedule_version_id)
    REFERENCES work_schedule_versions (agency_id, id),
  FOREIGN KEY (agency_id, work_arrangement_version_id)
    REFERENCES work_arrangement_versions (agency_id, id),
  FOREIGN KEY (agency_id, holiday_calendar_version_id)
    REFERENCES holiday_calendar_versions (agency_id, id),
  UNIQUE (attendance_period_id, employee_id, work_date, calculation_version),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX attendance_days_one_current_uq
ON attendance_days (agency_id, employee_id, work_date)
WHERE is_current;
```

```sql
CREATE TABLE attendance_day_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_day_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duty_relation text NOT NULL CHECK (duty_relation IN ('EXPECTED','OUTSIDE_SCHEDULE')),
  coverage_type text NOT NULL CHECK (coverage_type IN (
    'WORKED','OFFICIAL_BUSINESS','OFFICIAL_TRAVEL','TRAINING',
    'APPROVED_ABSENCE','POSTED_LEAVE','UNCOVERED'
  )),
  deficit_type text CHECK (deficit_type IN ('TARDINESS','UNDERTIME','ABSENCE')),
  holiday_classification text,
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK (ends_at > starts_at),
  CHECK ((coverage_type = 'UNCOVERED') = (deficit_type IS NOT NULL)),
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE attendance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_day_id uuid NOT NULL,
  exception_type text NOT NULL,
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

Add a no-overlap exclusion constraint for Attendance Day Segments within one calculation version. All Attendance Exceptions in the MVP block approval. Worked, Attendance Context, and posted-leave intervals form a union so overlapping minutes count once; conflicting context or leave classifications create an exception rather than an assumed precedence. A fully uncovered expected Work Date is absence; otherwise leading uncovered minutes are tardiness, trailing uncovered minutes are undertime, and internal uncovered minutes are absence.

An overnight calculation remains one Attendance Day under the beginning-local-date Work Date, while each segment keeps the holiday classification of its actual local calendar date. Complete events on a rest day create `UNSCHEDULED_SERVICE` with no deficit minutes. Outside-schedule and statutory-night-window totals remain factual candidates, not compensation decisions.

---

## 5. Corrections

```sql
CREATE TABLE attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_day_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('ATTENDANCE_EVENT','ATTENDANCE_CONTEXT')),
  requested_action text NOT NULL CHECK (requested_action IN ('ADD','REPLACE','VOID')),
  target_id uuid,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','NEEDS_INFORMATION','APPROVED','REJECTED','CANCELLED','APPLIED')),
  requested_record jsonb,
  reason text NOT NULL,
  evidence_document_version_id uuid NOT NULL,
  submitted_at timestamptz,
  decided_by_membership_id uuid,
  decided_at timestamptz,
  decision_reason text,
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, decided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Applied correction transaction:

- retain the original Attendance Event or Attendance Context and record the approved ADD, REPLACE, or VOID effect;
- retain the old Attendance Day and its segments;
- create replacement current version;
- mark old version `is_current = false`;
- append audit record;
- create payroll adjustment if period was locked/finalized.

The finalization contract defines the normalized applied-effect and locked-period adjustment tables. The input boundary forbids hard deletion or in-place mutation of the target record.

---

## 6. Leave Types and Policies

```sql
CREATE TABLE leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
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
  entitlement_basis text NOT NULL
    CHECK (entitlement_basis IN (
      'ACCRUED_ACCOUNT','PERIODIC_ALLOWANCE',
      'QUALIFYING_EVENT','NON_CREDIT_AUTHORIZATION'
    )),
  calendar_basis text NOT NULL
    CHECK (calendar_basis IN (
      'WORKING_DAY','CALENDAR_DAY','SCHEDULED_TIME','SOURCE_DEFINED'
    )),
  charged_leave_type_id uuid,
  evaluator_kind citext NOT NULL,
  rule_parameters jsonb NOT NULL,
  applicability_rules jsonb NOT NULL,
  document_requirements jsonb NOT NULL,
  approval_route_code citext NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, leave_type_id)
    REFERENCES leave_types (agency_id, id),
  FOREIGN KEY (agency_id, charged_leave_type_id)
    REFERENCES leave_types (agency_id, id),
  UNIQUE (leave_type_id, version_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_policy_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_policy_version_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  authority_class text NOT NULL
    CHECK (authority_class IN ('NATIONAL_RULE','AGENCY_CONFIGURATION')),
  citation text NOT NULL CHECK (btrim(citation) <> ''),
  FOREIGN KEY (agency_id, leave_policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (leave_policy_version_id, document_version_id, citation),
  UNIQUE (agency_id, id)
);

ALTER TABLE leave_types
ADD CONSTRAINT leave_types_current_policy_version_fk
FOREIGN KEY (agency_id, current_policy_version_id)
REFERENCES leave_policy_versions (agency_id, id);
```

Use an exclusion constraint to prevent overlapping `ACTIVE` policy versions for
one Leave Type. Activation must validate `rule_parameters` against the fixed
schema registered for `evaluator_kind`, require applicable authority links, and
reject unsupported or conflicting national and Agency values. Active and
superseded versions and their authority links are immutable.

---

## 7. Leave Accounts and Ledger

```sql
CREATE TABLE leave_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  unit_code text NOT NULL CHECK (unit_code IN ('CREDIT_DAY')),
  status text NOT NULL CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  opened_at date NOT NULL,
  closed_at date,
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CHECK (
    (status IN ('ACTIVE','FROZEN') AND closed_at IS NULL)
    OR (status = 'CLOSED' AND closed_at IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, leave_type_id)
    REFERENCES leave_types (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX leave_accounts_one_open_uq
ON leave_accounts (agency_id, employee_id, leave_type_id)
WHERE status IN ('ACTIVE','FROZEN');
```

```sql
CREATE TABLE leave_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_account_id uuid NOT NULL,
  quantity numeric(12,4) NOT NULL CHECK (quantity <> 0),
  effective_date date NOT NULL,
  source_type citext NOT NULL CHECK (btrim(source_type::text) <> ''),
  source_id uuid NOT NULL,
  source_posting_key citext NOT NULL
    CHECK (btrim(source_posting_key::text) <> ''),
  policy_version_id uuid NOT NULL,
  reverses_entry_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by_membership_id uuid,
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  FOREIGN KEY (agency_id, reverses_entry_id)
    REFERENCES leave_ledger_entries(agency_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, posted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (
    agency_id, leave_account_id,
    source_type, source_id, source_posting_key
  ),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX leave_ledger_entries_one_reversal_uq
ON leave_ledger_entries (agency_id, reverses_entry_id)
WHERE reverses_entry_id IS NOT NULL;

CREATE TABLE leave_credit_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_account_id uuid NOT NULL,
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  source_type citext NOT NULL CHECK (btrim(source_type::text) <> ''),
  source_id uuid NOT NULL,
  source_commitment_key citext NOT NULL
    CHECK (btrim(source_commitment_key::text) <> ''),
  succeeds_commitment_id uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','RELEASED')),
  effective_from timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK (
    (status = 'ACTIVE' AND ended_at IS NULL)
    OR (status IN ('CONSUMED','RELEASED') AND ended_at IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (agency_id, succeeds_commitment_id)
    REFERENCES leave_credit_commitments (agency_id, id) ON DELETE RESTRICT,
  UNIQUE (
    agency_id, leave_account_id,
    source_type, source_id, source_commitment_key
  ),
  UNIQUE (agency_id, succeeds_commitment_id),
  UNIQUE (agency_id, id)
);
```

Attach immutable mutation-prevention triggers to posted ledger entries and
terminal commitment states. A reviewed trigger must require a reversal to use
the same account and exact opposite quantity as its original entry. The owning
service must validate the polymorphic source and serialize balance-sensitive
posting by locking the Leave Account.

A balance query always states both cutoffs:

```sql
SELECT
  COALESCE(SUM(quantity), 0) AS posted_balance
FROM leave_ledger_entries
WHERE agency_id = :agency_id
  AND leave_account_id = :leave_account_id
  AND effective_date <= :balance_as_of
  AND posted_at <= :ledger_recorded_through;
```

Currently available credits subtract active commitments and the quantity under
review from this posted balance. HR certification creates commitments under the
affected account locks. Posting consumes them; withdrawal, rejection, material
return, invalidation, or supersession releases them. A partial approval may
release one commitment and create a linked successor only when the successor is
in the same account and has a smaller quantity. Other replacement requires a new
Leave Application Version and recertification.

---

## 8. Leave Applications

```sql
CREATE TABLE leave_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  draft_leave_type_id uuid NOT NULL,
  current_version_id uuid,
  draft_reason text,
  draft_policy_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_commutation_choice text
    CHECK (draft_commutation_choice IN ('REQUESTED','NOT_REQUESTED')),
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','SUBMITTED','FOR_CERTIFICATION','FOR_RECOMMENDATION',
      'FOR_APPROVAL','APPROVED','REJECTED','NEEDS_INFORMATION',
      'WITHDRAWN','CANCEL_REQUESTED','CANCELLED','POSTED'
    )),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, draft_leave_type_id)
    REFERENCES leave_types (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_application_draft_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  date_from date NOT NULL,
  date_to date NOT NULL,
  CHECK (date_to >= date_from),
  FOREIGN KEY (agency_id, leave_application_id)
    REFERENCES leave_applications (agency_id, id),
  UNIQUE (leave_application_id, sequence_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_application_draft_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  purpose_code citext NOT NULL CHECK (btrim(purpose_code::text) <> ''),
  FOREIGN KEY (agency_id, leave_application_id)
    REFERENCES leave_applications (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (leave_application_id, document_version_id, purpose_code),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_application_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  leave_type_id uuid NOT NULL,
  accepted_assessment_id uuid,
  approval_route_version_id uuid NOT NULL,
  approval_request_id uuid NOT NULL,
  form_template_document_version_id uuid NOT NULL,
  attestation_type text NOT NULL
    CHECK (attestation_type IN (
      'AUTHENTICATED_SUBMISSION','SIGNED_DOCUMENT'
    )),
  attestation_document_version_id uuid,
  submitted_by_membership_id uuid NOT NULL,
  employee_attested_at timestamptz,
  submission_method citext NOT NULL
    CHECK (btrim(submission_method::text) <> ''),
  received_at timestamptz NOT NULL,
  reason text,
  policy_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  commutation_choice text
    CHECK (commutation_choice IN ('REQUESTED','NOT_REQUESTED')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (attestation_type = 'AUTHENTICATED_SUBMISSION'
      AND attestation_document_version_id IS NULL
      AND employee_attested_at IS NOT NULL)
    OR
    (attestation_type = 'SIGNED_DOCUMENT'
      AND attestation_document_version_id IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, leave_application_id)
    REFERENCES leave_applications (agency_id, id),
  FOREIGN KEY (agency_id, leave_type_id)
    REFERENCES leave_types (agency_id, id),
  FOREIGN KEY (agency_id, approval_route_version_id)
    REFERENCES approval_route_versions (agency_id, id),
  FOREIGN KEY (agency_id, approval_request_id)
    REFERENCES approval_requests (agency_id, id),
  FOREIGN KEY (agency_id, form_template_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, attestation_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, submitted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (leave_application_id, version_no),
  UNIQUE (approval_request_id),
  UNIQUE (agency_id, leave_application_id, id),
  UNIQUE (agency_id, id)
);

ALTER TABLE leave_applications
ADD CONSTRAINT leave_applications_current_version_fk
FOREIGN KEY (agency_id, id, current_version_id)
REFERENCES leave_application_versions (
  agency_id, leave_application_id, id
);

CREATE TABLE leave_application_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  date_from date NOT NULL,
  date_to date NOT NULL,
  CHECK (date_to >= date_from),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  UNIQUE (leave_application_version_id, sequence_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_application_version_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  purpose_code citext NOT NULL CHECK (btrim(purpose_code::text) <> ''),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (
    leave_application_version_id, document_version_id, purpose_code
  ),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_eligibility_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  assessment_no integer NOT NULL CHECK (assessment_no > 0),
  result text NOT NULL
    CHECK (result IN ('ELIGIBLE','INELIGIBLE','INDETERMINATE')),
  input_facts jsonb NOT NULL,
  rule_results jsonb NOT NULL,
  missing_facts jsonb NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  UNIQUE (leave_application_version_id, assessment_no),
  UNIQUE (agency_id, leave_application_version_id, id),
  UNIQUE (agency_id, id)
);

ALTER TABLE leave_application_versions
ADD CONSTRAINT leave_application_versions_accepted_assessment_fk
FOREIGN KEY (agency_id, id, accepted_assessment_id)
REFERENCES leave_eligibility_assessments (
  agency_id, leave_application_version_id, id
);

CREATE TABLE leave_calculation_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  eligibility_assessment_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  schedule_assignment_id uuid,
  holiday_facts jsonb NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  requested_quantity numeric(12,4) NOT NULL CHECK (requested_quantity > 0),
  requested_unit text NOT NULL
    CHECK (requested_unit IN (
      'WORKING_DAY','CALENDAR_DAY','SCHEDULED_MINUTE','SOURCE_DEFINED'
    )),
  account_quantity numeric(12,4),
  CHECK (date_to >= date_from),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  FOREIGN KEY (
    agency_id, leave_application_version_id, eligibility_assessment_id
  ) REFERENCES leave_eligibility_assessments (
    agency_id, leave_application_version_id, id
  ),
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  FOREIGN KEY (agency_id, schedule_assignment_id)
    REFERENCES schedule_assignments (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_credit_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  eligibility_assessment_id uuid NOT NULL,
  approval_decision_id uuid NOT NULL,
  balance_as_of date NOT NULL,
  ledger_recorded_through timestamptz NOT NULL,
  certified_by_membership_id uuid NOT NULL,
  certified_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  FOREIGN KEY (
    agency_id, leave_application_version_id, eligibility_assessment_id
  ) REFERENCES leave_eligibility_assessments (
    agency_id, leave_application_version_id, id
  ),
  FOREIGN KEY (agency_id, approval_decision_id)
    REFERENCES approval_decisions (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (leave_application_version_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_credit_certification_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_credit_certification_id uuid NOT NULL,
  leave_account_id uuid NOT NULL,
  posted_balance numeric(12,4) NOT NULL,
  active_commitments numeric(12,4) NOT NULL CHECK (active_commitments >= 0),
  application_quantity numeric(12,4) NOT NULL CHECK (application_quantity > 0),
  available_after_application numeric(12,4) NOT NULL,
  leave_credit_commitment_id uuid NOT NULL,
  FOREIGN KEY (agency_id, leave_credit_certification_id)
    REFERENCES leave_credit_certifications (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (agency_id, leave_credit_commitment_id)
    REFERENCES leave_credit_commitments (agency_id, id),
  UNIQUE (leave_credit_certification_id, leave_account_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  approval_decision_id uuid NOT NULL,
  outcome text NOT NULL
    CHECK (outcome IN ('RECOMMEND_APPROVAL','RECOMMEND_REJECTION')),
  reason text,
  recommended_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome <> 'RECOMMEND_REJECTION' OR reason IS NOT NULL),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  FOREIGN KEY (agency_id, approval_decision_id)
    REFERENCES approval_decisions (agency_id, id),
  UNIQUE (leave_application_version_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_approval_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  approval_decision_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  FOREIGN KEY (agency_id, approval_decision_id)
    REFERENCES approval_decisions (agency_id, id),
  UNIQUE (leave_application_version_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_approval_allocation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_approval_allocation_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  date_from date NOT NULL,
  date_to date NOT NULL,
  allocation_kind text NOT NULL
    CHECK (allocation_kind IN (
      'LEAVE_ACCOUNT','LEAVE_WITHOUT_PAY','NON_CREDIT'
    )),
  leave_account_id uuid,
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit_code text NOT NULL
    CHECK (unit_code IN (
      'WORKING_DAY','CALENDAR_DAY','SCHEDULED_MINUTE','SOURCE_DEFINED'
    )),
  CHECK (date_to >= date_from),
  CHECK (
    (allocation_kind = 'LEAVE_ACCOUNT' AND leave_account_id IS NOT NULL)
    OR
    (allocation_kind <> 'LEAVE_ACCOUNT' AND leave_account_id IS NULL)
  ),
  FOREIGN KEY (agency_id, leave_approval_allocation_id)
    REFERENCES leave_approval_allocations (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  UNIQUE (leave_approval_allocation_id, sequence_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_version_id uuid NOT NULL,
  leave_approval_allocation_id uuid NOT NULL,
  idempotency_key citext NOT NULL
    CHECK (btrim(idempotency_key::text) <> ''),
  posted_by_membership_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, leave_application_version_id)
    REFERENCES leave_application_versions (agency_id, id),
  FOREIGN KEY (agency_id, leave_approval_allocation_id)
    REFERENCES leave_approval_allocations (agency_id, id),
  FOREIGN KEY (agency_id, posted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (leave_application_version_id),
  UNIQUE (agency_id, idempotency_key),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_posting_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_posting_id uuid NOT NULL,
  effect_kind text NOT NULL
    CHECK (effect_kind IN (
      'LEDGER_ENTRY','ATTENDANCE_INPUT','PAYROLL_INPUT'
    )),
  effect_key citext NOT NULL CHECK (btrim(effect_key::text) <> ''),
  owner_record_id uuid NOT NULL,
  FOREIGN KEY (agency_id, leave_posting_id)
    REFERENCES leave_postings (agency_id, id),
  UNIQUE (leave_posting_id, effect_key),
  UNIQUE (agency_id, effect_kind, owner_record_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_application_id uuid NOT NULL,
  leave_application_version_id uuid NOT NULL,
  leave_posting_id uuid,
  scope_type text NOT NULL CHECK (scope_type IN ('WHOLE','PARTIAL')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  approval_route_version_id uuid NOT NULL,
  approval_request_id uuid NOT NULL,
  decision_status text NOT NULL
    CHECK (decision_status IN ('REQUESTED','APPROVED','REJECTED')),
  effect_status text NOT NULL
    CHECK (effect_status IN ('NOT_READY','PENDING','APPLIED','FAILED')),
  requested_by_membership_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  last_effect_failure_code citext,
  FOREIGN KEY (agency_id, leave_application_id)
    REFERENCES leave_applications (agency_id, id),
  FOREIGN KEY (
    agency_id, leave_application_id, leave_application_version_id
  ) REFERENCES leave_application_versions (
    agency_id, leave_application_id, id
  ),
  FOREIGN KEY (agency_id, leave_posting_id)
    REFERENCES leave_postings (agency_id, id),
  FOREIGN KEY (agency_id, approval_route_version_id)
    REFERENCES approval_route_versions (agency_id, id),
  FOREIGN KEY (agency_id, approval_request_id)
    REFERENCES approval_requests (agency_id, id),
  FOREIGN KEY (agency_id, requested_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_cancellation_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_cancellation_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  purpose_code citext NOT NULL CHECK (btrim(purpose_code::text) <> ''),
  FOREIGN KEY (agency_id, leave_cancellation_id)
    REFERENCES leave_cancellations (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (leave_cancellation_id, document_version_id, purpose_code),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_cancellation_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_cancellation_id uuid NOT NULL,
  approval_allocation_line_id uuid NOT NULL,
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (agency_id, leave_cancellation_id)
    REFERENCES leave_cancellations (agency_id, id),
  FOREIGN KEY (agency_id, approval_allocation_line_id)
    REFERENCES leave_approval_allocation_lines (agency_id, id),
  UNIQUE (leave_cancellation_id, approval_allocation_line_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_cancellation_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  leave_cancellation_id uuid NOT NULL,
  effect_kind text NOT NULL
    CHECK (effect_kind IN (
      'COMMITMENT_RELEASE','LEDGER_REVERSAL','LEDGER_REPLACEMENT',
      'ATTENDANCE_CORRECTION','PAYROLL_CORRECTION'
    )),
  effect_key citext NOT NULL CHECK (btrim(effect_key::text) <> ''),
  owner_record_id uuid NOT NULL,
  owner_status citext NOT NULL CHECK (btrim(owner_status::text) <> ''),
  FOREIGN KEY (agency_id, leave_cancellation_id)
    REFERENCES leave_cancellations (agency_id, id),
  UNIQUE (leave_cancellation_id, effect_key),
  UNIQUE (agency_id, effect_kind, owner_record_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE mandatory_leave_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  leave_account_id uuid NOT NULL,
  assessment_date date NOT NULL,
  result text NOT NULL
    CHECK (result IN ('SUBJECT','NOT_SUBJECT','INDETERMINATE')),
  required_quantity numeric(12,4),
  fulfilled_quantity numeric(12,4),
  input_facts jsonb NOT NULL,
  rule_results jsonb NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Application validation must prove that current versions, assessments, routes,
allocations, postings, and cancellations belong to the same Agency and stable
application. It must prevent overlapping periods within a version, allocations
outside the request, cancellation scopes outside the allocation, and overlapping
posted leave where the accepted Leave Policy Version forbids it.

Submitted version facts, periods, submission-time document snapshots,
assessments, segments, certifications, recommendations, allocations, postings,
applied cancellations, and effect links are immutable. Later rendered form links
may be appended but never edited or removed. Documents owns exact-version
eligibility and classification; Leave owns requirement satisfaction and domain
error language.

HR certification locks affected Leave Accounts, freezes the certification and
lines, and creates their commitments in one transaction. Current certification
authority is derived rather than stored as a mutable validity flag. A partial
approval may atomically release a commitment and create only a smaller linked
successor in the same account.

Leave Posting locks affected accounts in stable order, revalidates the exact
version, assessment, certification, commitments, allocation, and Approval
Decisions, and calls Attendance and Payroll application services inside the
transaction. It creates all required effects, consumes commitments, updates the
application projection, and appends Audit Events and outbox records, or rolls
back all authoritative changes. Stable effect keys make retries return existing
results.

Applying a Leave Cancellation follows the same atomic boundary. Whole
cancellation exactly reverses affected ledger entries. Partial cancellation
fully reverses each affected entry and posts a replacement for the retained
quantity with the original effective date and a later posting time. Attendance
and Payroll return idempotent correction or adjustment identifiers. A failed
effect transaction records `FAILED` separately, leaves the approved cancellation
available for retry, and does not change the original posting. `APPLIED` means
all required reversals or owner handoffs exist, even when an accepted downstream
adjustment remains pending.

Required policy, schedule, holiday, document, route, authority, or account gaps
produce a blocking result; they are not filled with schema defaults. A route or
commitment has no silent system-defined expiry.

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
