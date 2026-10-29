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
  UNIQUE (holiday_calendar_version_id, holiday_date),
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
  status text NOT NULL CHECK (status IN ('OPEN','FINALIZED')),
  CHECK (date_to >= date_from),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE employee_attendance_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL CHECK (status IN (
    'DRAFT','SUBMITTED','RETURNED','APPROVED','CANCELLED','STALE'
  )),
  submitted_by_membership_id uuid NOT NULL,
  submitted_at timestamptz,
  on_behalf_reason text,
  evidence_document_version_id uuid,
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  CHECK (
    (on_behalf_reason IS NULL AND evidence_document_version_id IS NULL)
    OR (on_behalf_reason IS NOT NULL AND evidence_document_version_id IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, attendance_period_id)
    REFERENCES attendance_periods (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, submitted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, reviewed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (attendance_period_id, employee_id, version_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE attendance_period_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_period_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  predecessor_version_id uuid,
  status text NOT NULL CHECK (status IN ('FOR_REVIEW','APPROVED','RETURNED','LOCKED')),
  approval_route_version_id uuid NOT NULL,
  submitted_by_membership_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  locked_by_membership_id uuid,
  locked_at timestamptz,
  reconciliation jsonb,
  CHECK (reviewed_by_membership_id IS NULL OR reviewed_by_membership_id <> locked_by_membership_id),
  CHECK (
    status <> 'LOCKED'
    OR (reviewed_by_membership_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND locked_by_membership_id IS NOT NULL
      AND locked_at IS NOT NULL
      AND reconciliation IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, attendance_period_id)
    REFERENCES attendance_periods (agency_id, id),
  FOREIGN KEY (agency_id, predecessor_version_id)
    REFERENCES attendance_period_versions (agency_id, id),
  FOREIGN KEY (agency_id, approval_route_version_id)
    REFERENCES approval_route_versions (agency_id, id),
  FOREIGN KEY (agency_id, submitted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, reviewed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, locked_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (attendance_period_id, version_no),
  UNIQUE (agency_id, id)
);
```

An Attendance Period is the stable interval every Attendance Period Version, Finalized Daily Time Record, and Attendance Payroll Publication refers to. `hris_app` holds `SELECT, INSERT, UPDATE` under the Agency policy, and the `attendance_periods_update_trigger` (`guard_attendance_period_update`) narrows UPDATE: `id`, `agency_id`, `code`, `date_from`, `date_to`, and `created_at` never change; status moves only from `OPEN` to `FINALIZED`, and only under the Attendance transition capability (`app.attendance_transition`) that Attendance Period Lock sets. A finalized period never reopens.

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
    CHECK (status IN ('PENDING','CALCULATED','EXCEPTION','APPROVED')),
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
  cto_minutes integer NOT NULL DEFAULT 0 CHECK (cto_minutes >= 0),
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
    'APPROVED_ABSENCE','POSTED_LEAVE','CTO','UNCOVERED'
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

CREATE TABLE employee_attendance_submission_days (
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_attendance_submission_id uuid NOT NULL,
  attendance_day_id uuid NOT NULL,
  PRIMARY KEY (employee_attendance_submission_id, attendance_day_id),
  FOREIGN KEY (agency_id, employee_attendance_submission_id)
    REFERENCES employee_attendance_submissions (agency_id, id),
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id)
);

CREATE TABLE attendance_period_version_days (
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_period_version_id uuid NOT NULL,
  employee_attendance_submission_id uuid NOT NULL,
  attendance_day_id uuid NOT NULL,
  PRIMARY KEY (attendance_period_version_id, attendance_day_id),
  FOREIGN KEY (agency_id, attendance_period_version_id)
    REFERENCES attendance_period_versions (agency_id, id),
  FOREIGN KEY (agency_id, employee_attendance_submission_id)
    REFERENCES employee_attendance_submissions (agency_id, id),
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id)
);
```

```sql
CREATE TABLE attendance_posted_leave_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  source_key text NOT NULL CHECK (btrim(source_key) <> ''),
  source_type text NOT NULL CHECK (btrim(source_type) <> ''),
  source_id uuid NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL CHECK (date_to >= date_from),
  unit_code text NOT NULL
    CHECK (unit_code IN (
      'WORKING_DAY','CALENDAR_DAY','SCHEDULED_MINUTE','SOURCE_DEFINED'
    )),
  quantity numeric(12,4) NOT NULL,
  allocation_kind text NOT NULL
    CHECK (allocation_kind IN (
      'LEAVE_ACCOUNT','LEAVE_WITHOUT_PAY','NON_CREDIT'
    )),
  predecessor_input_id uuid,
  CHECK (quantity > 0 OR (quantity = 0 AND predecessor_input_id IS NOT NULL)),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id) REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, employee_id, predecessor_input_id)
    REFERENCES attendance_posted_leave_inputs (agency_id, employee_id, id),
  UNIQUE (agency_id, id),
  UNIQUE (agency_id, employee_id, id),
  UNIQUE (agency_id, source_key),
  UNIQUE (agency_id, predecessor_input_id)
);
```

`attendance_posted_leave_inputs` is Attendance's immutable record of posted leave. Leave Posting creates one input per posted allocation line through the Attendance application service, inside its own authoritative transaction, and retains the returned identifier. The stable `source_key` makes a retry return the existing input. `source_type` and `source_id` name the Leave source. Leave without pay and non-credit leave never touch the ledger, so every allocation kind reaches Attendance through its own input. A successor input names its predecessor, which must belong to the same Employee and can have only one successor; only an input with no successor is current and contributes coverage. A zero-quantity successor withdraws its predecessor's coverage; only a successor may be zero. Inputs are never updated or deleted. Attendance Day calculation reads current inputs and places whole Work Date `POSTED_LEAVE` coverage. It never reads the Leave Ledger. A quantity it cannot place, such as a fraction of a day, minutes, a source-defined unit, or working days that do not equal the working dates of their range under the Employee's schedule, becomes a blocking `AMBIGUOUS_LEAVE_QUANTITY` exception rather than an assumed interval. Working-day inputs from one source sharing one date range, such as a posting's lines split between charged leave and leave without pay, are counted together; inputs from separate sources are never combined. A range whose schedule cannot be resolved fails closed. A REST day or non-working holiday inside a placeable range receives no leave coverage, matching Leave's working-day count.

```sql
CREATE TABLE attendance_cto_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  source_key text NOT NULL CHECK (btrim(source_key) <> ''),
  source_type text NOT NULL CHECK (btrim(source_type) <> ''),
  source_id uuid NOT NULL,
  work_date date NOT NULL,
  coverage_mode text NOT NULL CHECK (coverage_mode IN ('WHOLE_WORK_DATE','TIMED','NONE')),
  starts_at timestamptz,
  ends_at timestamptz,
  predecessor_input_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (coverage_mode = 'WHOLE_WORK_DATE' AND starts_at IS NULL AND ends_at IS NULL)
    OR (coverage_mode = 'TIMED' AND starts_at IS NOT NULL AND ends_at IS NOT NULL
        AND ends_at > starts_at)
    OR (coverage_mode = 'NONE' AND predecessor_input_id IS NOT NULL
        AND starts_at IS NULL AND ends_at IS NULL)
  ),
  FOREIGN KEY (agency_id, employee_id) REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, employee_id, predecessor_input_id)
    REFERENCES attendance_cto_inputs (agency_id, employee_id, id),
  UNIQUE (agency_id, id),
  UNIQUE (agency_id, employee_id, id),
  UNIQUE (agency_id, source_key),
  UNIQUE (agency_id, predecessor_input_id)
);
```

`attendance_cto_inputs` is Attendance's immutable record of approved CTO, following `attendance_posted_leave_inputs`. CTO Request approval creates one input per Work Date through the Attendance application service, and a retry with the same `source_key` returns the existing input. Only an input with no successor is current. A `NONE` successor withdraws coverage, and only a successor may be `NONE`. Attendance Day calculation places current inputs as `CTO` coverage: the Work Date's whole coverage window, or the timed interval. CTO pays expected duty only, as the CTO Request controls in `docs/hris-controls.md` require: a Work Date without expected duty, such as a REST day or a non-working holiday, is refused in either mode, and a timed interval must lie inside the Work Date's expected duty, which an overnight Day Rule extends past midnight and which excludes scheduled unpaid breaks. A Work Date whose schedule cannot be resolved is refused. Recording can check only the Work Date's coverage window, so the calculated Day decides placement: a timed input with any minute outside the calculated expected duty, or any input on no expected minute, is placed nowhere and becomes a blocking `UNPLACED_CTO_INPUT` exception, as an unplaceable posted-leave quantity does. A later schedule change, an early flexible start that ends expected duty sooner, or a Non-Working Holiday after midnight can each cause it. The coverage is paid time with no deficit, stored as the Day's `cto_minutes`, and published as its own Attendance Payroll Fact classification that period lock reconciles against that total. Creating or superseding an input on a Work Date in a locked period is refused. A cancellation there becomes a `CTO_INPUT` Attendance Correction, which extends `target_type` with the same rules as `POSTED_LEAVE_INPUT`: created only by the COC module, entering at `FOR_AUTHORIZATION` with the approved CTO cancellation as its evidence, and authorized by a different HR Administrator through the ordinary Locked Attendance Adjustment (#548).

Add a no-overlap exclusion constraint for Attendance Day Segments within one calculation version. All Attendance Exceptions in the MVP block approval. Worked, Attendance Context, posted-leave, and CTO intervals form a union so overlapping minutes count once; conflicting context or leave classifications create an exception rather than an assumed precedence. A fully uncovered expected Work Date is absence; otherwise leading uncovered minutes are tardiness, trailing uncovered minutes are undertime, and internal uncovered minutes are absence.

Segment boundaries are whole minutes, while Attendance Event and Attendance Context timestamps keep their seconds. Calculation counts Fully Covered Minutes (ADR 0005): a timed interval starts at the first whole minute at or after its raw start and ends at the last whole minute at or before its raw end, so no segment starts before or ends after its raw source. `rule_snapshot.minuteRule` records `FULLY_COVERED_MINUTE`, and the input fingerprint includes it.

An overnight calculation remains one Attendance Day under the beginning-local-date Work Date, while each segment keeps the holiday classification of its actual local calendar date. Complete events on a rest day create `UNSCHEDULED_SERVICE` with no deficit minutes.

A Non-Working Holiday (`REGULAR_HOLIDAY`, `SPECIAL_NON_WORKING`, `LOCAL_HOLIDAY`, or `WORK_SUSPENSION`) removes expected duty for the minutes on its actual calendar date, so an overnight shift loses only the portion after midnight on the holiday. Service rendered there is recorded like rest-day service: `OUTSIDE_SCHEDULE` worked minutes and `UNSCHEDULED_SERVICE`, with no deficit, premium, overtime, or credit. `SPECIAL_WORKING` keeps ordinary duty. The rule is fixed and shared with Leave's working-day count; Work Schedule Versions carry no holiday setting (ADR 0006). A partial-day work suspension is recorded as Attendance Context, not as a `WORK_SUSPENSION` entry. Outside-schedule and statutory-night-window totals remain factual candidates, not compensation decisions.

---

## 5. Corrections

```sql
CREATE TABLE attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  initiated_by_membership_id uuid NOT NULL,
  recorded_by_membership_id uuid NOT NULL,
  target_type text NOT NULL
    CHECK (target_type IN ('ATTENDANCE_EVENT','ATTENDANCE_CONTEXT','POSTED_LEAVE_INPUT')),
  requested_action text NOT NULL CHECK (requested_action IN ('ADD','REPLACE','VOID')),
  target_id uuid,
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','SUBMITTED','NEEDS_INFORMATION','APPROVED','FOR_AUTHORIZATION',
      'REJECTED','CANCELLED','APPLIED'
    )),
  requested_record jsonb,
  reason text NOT NULL,
  approval_route_version_id uuid NOT NULL,
  impact_preview jsonb NOT NULL,
  submitted_at timestamptz,
  decided_by_membership_id uuid,
  decided_at timestamptz,
  decision_reason text,
  authorized_by_membership_id uuid,
  authorized_at timestamptz,
  applied_by_membership_id uuid,
  applied_at timestamptz,
  excluded_decider_membership_ids uuid[] NOT NULL DEFAULT '{}',
  blocking_reason text,
  blocked_by_membership_id uuid,
  blocked_at timestamptz,
  CHECK (
    (blocking_reason IS NULL AND blocked_by_membership_id IS NULL AND blocked_at IS NULL)
    OR (target_type = 'POSTED_LEAVE_INPUT' AND btrim(blocking_reason) <> ''
      AND blocked_by_membership_id IS NOT NULL AND blocked_at IS NOT NULL)
  ),
  CHECK (
    target_type <> 'POSTED_LEAVE_INPUT'
    OR (requested_action IN ('REPLACE','VOID') AND decided_by_membership_id IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, blocked_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, initiated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, approval_route_version_id)
    REFERENCES approval_route_versions (agency_id, id),
  FOREIGN KEY (agency_id, decided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, authorized_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, applied_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE attendance_correction_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_correction_id uuid NOT NULL,
  document_version_id uuid,
  source_type text,
  source_id uuid,
  CHECK (
    (document_version_id IS NOT NULL AND source_type IS NULL AND source_id IS NULL)
    OR (document_version_id IS NULL AND source_type IS NOT NULL AND source_id IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, attendance_correction_id)
    REFERENCES attendance_corrections (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE attendance_correction_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_correction_id uuid NOT NULL,
  effect_action text NOT NULL CHECK (effect_action IN ('ADD','REPLACE','VOID')),
  target_type text NOT NULL
    CHECK (target_type IN ('ATTENDANCE_EVENT','ATTENDANCE_CONTEXT','POSTED_LEAVE_INPUT')),
  original_target_id uuid,
  replacement_record jsonb,
  applied_by_membership_id uuid NOT NULL,
  applied_at timestamptz NOT NULL,
  CHECK (
    (effect_action = 'ADD' AND original_target_id IS NULL AND replacement_record IS NOT NULL)
    OR (effect_action = 'REPLACE' AND original_target_id IS NOT NULL AND replacement_record IS NOT NULL)
    OR (effect_action = 'VOID' AND original_target_id IS NOT NULL AND replacement_record IS NULL)
  ),
  FOREIGN KEY (agency_id, attendance_correction_id)
    REFERENCES attendance_corrections (agency_id, id),
  FOREIGN KEY (agency_id, applied_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (attendance_correction_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE locked_attendance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_correction_id uuid NOT NULL,
  authorized_by_membership_id uuid NOT NULL,
  authorized_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, attendance_correction_id)
    REFERENCES attendance_corrections (agency_id, id),
  FOREIGN KEY (agency_id, authorized_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (attendance_correction_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE locked_attendance_adjustment_periods (
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  locked_attendance_adjustment_id uuid NOT NULL,
  predecessor_period_version_id uuid NOT NULL,
  successor_period_version_id uuid NOT NULL,
  PRIMARY KEY (locked_attendance_adjustment_id, predecessor_period_version_id),
  CHECK (predecessor_period_version_id <> successor_period_version_id),
  FOREIGN KEY (agency_id, locked_attendance_adjustment_id)
    REFERENCES locked_attendance_adjustments (agency_id, id),
  FOREIGN KEY (agency_id, predecessor_period_version_id)
    REFERENCES attendance_period_versions (agency_id, id),
  FOREIGN KEY (agency_id, successor_period_version_id)
    REFERENCES attendance_period_versions (agency_id, id)
);
```

Applied correction transaction:

- require at least one immutable evidence row and bind the exact Approval Route Version and impact preview;
- retain the original Attendance Event or Attendance Context and record the approved `ADD`, `REPLACE`, or `VOID` effect;
- retain every old Attendance Day and segment, create replacement current versions for all affected Work Dates, and make their prior versions non-current;
- apply open-period approval and effect atomically against the previewed versions;
- for a locked period, require a different HR Administrator's authorization and group every affected predecessor and successor Attendance Period Version under one Locked Attendance Adjustment; and
- append sanitized audit and outbox records without partial effects.

An approved correction may produce an Attendance Exception. The effect remains applied, but the affected Employee Attendance Submission becomes stale and no successor period may enter review until the exception is resolved. The input boundary forbids hard deletion or in-place mutation of the target record.
A `POSTED_LEAVE_INPUT` correction is created only by Leave through the Attendance application service when an applied Leave Cancellation changes posted leave on a Work Date in a locked period. It `REPLACE`s the posted-leave input with the retained successor or `VOID`s it, and its evidence row references the Leave Cancellation as its authoritative source. The approved Leave Cancellation is its factual basis, so it enters at `FOR_AUTHORIZATION` without a second factual review. A different HR Administrator from the cancellation's requester and approvers authorizes it through the ordinary Locked Attendance Adjustment, which produces the successor Attendance Day and Attendance Period Versions, corrected DTRs, and adjustment publication. Attendance cannot change the Leave fact. The authorizer may only authorize or record a blocking reason, which Leave shows as the handoff's current status. Because no reviewer read its impact preview, authorization applies against the period's current locked versions, which an earlier authorization may have moved forward, and records the preview it applied.

---

## 6. Finalized DTR and Attendance Payroll Publications

```sql
CREATE TABLE dtr_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_period_version_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  predecessor_dtr_document_id uuid,
  classification text NOT NULL CHECK (classification IN ('ORIGINAL','CORRECTED')),
  output_type text NOT NULL CHECK (output_type IN ('PRINTABLE_SYSTEM_VIEW','EXACT_VERSIONED_FORM')),
  document_version_id uuid NOT NULL,
  authoritative_template_reference jsonb,
  source_manifest jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  CHECK (output_type <> 'EXACT_VERSIONED_FORM' OR authoritative_template_reference IS NOT NULL),
  CHECK (
    (classification = 'ORIGINAL' AND predecessor_dtr_document_id IS NULL)
    OR (classification = 'CORRECTED' AND predecessor_dtr_document_id IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, attendance_period_version_id)
    REFERENCES attendance_period_versions (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, predecessor_dtr_document_id)
    REFERENCES dtr_documents (agency_id, id),
  FOREIGN KEY (agency_id, document_version_id)
    REFERENCES document_versions (agency_id, id),
  UNIQUE (attendance_period_version_id, employee_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE attendance_payroll_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_period_version_id uuid NOT NULL,
  predecessor_publication_id uuid,
  publication_type text NOT NULL CHECK (publication_type IN ('ORIGINAL','ADJUSTMENT')),
  idempotency_key text NOT NULL,
  published_at timestamptz NOT NULL,
  CHECK (
    (publication_type = 'ORIGINAL' AND predecessor_publication_id IS NULL)
    OR (publication_type = 'ADJUSTMENT' AND predecessor_publication_id IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, attendance_period_version_id)
    REFERENCES attendance_period_versions (agency_id, id),
  FOREIGN KEY (agency_id, predecessor_publication_id)
    REFERENCES attendance_payroll_publications (agency_id, id),
  UNIQUE (attendance_period_version_id),
  UNIQUE (agency_id, idempotency_key),
  UNIQUE (agency_id, id)
);

CREATE TABLE attendance_payroll_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_payroll_publication_id uuid NOT NULL,
  attendance_day_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  fact_type text NOT NULL CHECK (fact_type IN (
    'EXPECTED','WORKED','OFFICIAL_BUSINESS','OFFICIAL_TRAVEL','TRAINING',
    'APPROVED_ABSENCE','POSTED_LEAVE','CTO','TARDINESS','UNDERTIME','ABSENCE'
  )),
  holiday_classification text,
  stable_source_key text NOT NULL,
  corrected_minutes integer NOT NULL CHECK (corrected_minutes >= 0),
  prior_minutes integer CHECK (prior_minutes >= 0),
  difference_direction text CHECK (difference_direction IN ('INCREASE','DECREASE')),
  difference_minutes integer CHECK (difference_minutes >= 0),
  CHECK (
    (prior_minutes IS NULL AND difference_direction IS NULL AND difference_minutes IS NULL)
    OR (prior_minutes IS NOT NULL AND difference_direction IS NOT NULL AND difference_minutes IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, attendance_payroll_publication_id)
    REFERENCES attendance_payroll_publications (agency_id, id),
  FOREIGN KEY (agency_id, attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (attendance_payroll_publication_id, stable_source_key),
  UNIQUE (agency_id, id)
);
```

Attendance Period Lock must atomically validate Attendance Period Reconciliation, set the approved version to `LOCKED`, set an initially open stable period to `FINALIZED`, create one DTR per covered Employee, create exactly one idempotent publication, and append audit and outbox events. Any failure leaves the version `APPROVED` and creates none of those outputs.

An adjustment publication contains only changed facts and records prior, corrected, and nonnegative directional difference values. It never edits or retracts the original publication, assigns money or rates, or selects the payroll period that consumes the difference. Posted leave is retained as attendance provenance while Leave owns its payroll effect. Outside-schedule and statutory-night-window minutes do not enter these publications.

---

## 7. Leave Types and Policies

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

## 8. Leave Accounts and Ledger

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

## 9. Leave Applications

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
  policy_version_id uuid NOT NULL,
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
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  UNIQUE (leave_approval_allocation_id, sequence_no),
  UNIQUE (agency_id, id)
);

CREATE INDEX leave_approval_allocation_lines_policy_version_idx
ON leave_approval_allocation_lines (agency_id, policy_version_id);

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
  prior_status text NOT NULL CHECK (prior_status IN ('APPROVED','POSTED')),
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
  last_effect_failure_kind text CHECK (last_effect_failure_kind IN ('RETRYABLE','BLOCKING')),
  FOREIGN KEY (agency_id, leave_application_id)
    REFERENCES leave_applications (agency_id, id),
  FOREIGN KEY (
    agency_id, leave_application_id, leave_application_version_id
  ) REFERENCES leave_application_versions (
    agency_id, leave_application_id, id
  ),
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
  date_from date NOT NULL,
  date_to date NOT NULL,
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  CHECK (date_to >= date_from),
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
  assessment_year integer NOT NULL CHECK (assessment_year BETWEEN 1900 AND 9999),
  policy_version_id uuid,
  leave_account_id uuid,
  previous_assessment_id uuid,
  assessment_date date NOT NULL,
  result text NOT NULL
    CHECK (result IN ('SUBJECT','NOT_SUBJECT','INDETERMINATE')),
  required_quantity numeric(12,4) CHECK (required_quantity > 0),
  fulfilled_quantity numeric(12,4) CHECK (fulfilled_quantity >= 0),
  material_fingerprint text NOT NULL CHECK (btrim(material_fingerprint) <> ''),
  input_facts jsonb NOT NULL,
  rule_results jsonb NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extract(year FROM assessment_date) = assessment_year),
  CHECK (
    result = 'INDETERMINATE'
    OR (policy_version_id IS NOT NULL AND leave_account_id IS NOT NULL
        AND fulfilled_quantity IS NOT NULL)
  ),
  CHECK ((result = 'SUBJECT') = (required_quantity IS NOT NULL)),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (agency_id, previous_assessment_id)
    REFERENCES mandatory_leave_assessments (agency_id, id),
  UNIQUE (previous_assessment_id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX mandatory_leave_assessments_first_per_year
  ON mandatory_leave_assessments (agency_id, employee_id, assessment_year)
  WHERE previous_assessment_id IS NULL;
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
lines, and creates their commitments in one transaction. Posted balance is read
as of the recorded effective balance date and ledger knowledge cutoff, and
other active commitments are read as of the same knowledge cutoff so a
commitment raised earlier the same day still counts. Current certification
authority is derived rather than stored as a mutable validity flag.

Every approval allocation line binds the calculation-segment Leave Policy
Version that authorized its kind and unit. A ledger-charging policy authorizes
only `LEAVE_ACCOUNT` for the quantity the certified account can cover and
`LEAVE_WITHOUT_PAY` for the uncovered excess; a paid non-ledger policy
authorizes `NON_CREDIT`, and an unpaid policy authorizes `LEAVE_WITHOUT_PAY`. A
partial approval may atomically release a commitment and create only a smaller
linked successor in the same account. Charging a different account, or moving
credit-covered quantity to unpaid leave, replaces a certified fact and requires
a successor version and recertification.

Leave Posting locks affected accounts in stable order, revalidates the exact
version, assessment, certification, commitments, allocation, and Approval
Decisions, and calls Attendance and Payroll application services inside the
transaction. It creates all required effects, consumes commitments, updates the
application projection, and appends Audit Events and outbox records, or rolls
back all authoritative changes. Stable effect keys make retries return existing
results.

A Leave Cancellation is requested while the application is `APPROVED` or
`POSTED`; `prior_status` records which, so a rejection returns the application
to that exact state and preserves every original record. Requesting creates an
Approval Request on the fixed `LEAVE_CANCELLATION` route, a single step that
requires `leave.applications.cancel`, and projects the application
`CANCEL_REQUESTED`. Only one cancellation per application may await decision.
Approval sets `decision_status = APPROVED` and `effect_status = PENDING` and
leaves the application `CANCEL_REQUESTED`; it creates no ledger, commitment,
Attendance, or Payroll effect. Applying unposted cancellation uses
`leave_cancellation_effects`. A version has at most one Leave Posting, so the
bound version identifies the posting a `POSTED` cancellation reverses.

For approved, unposted leave, the apply command requires
`leave.applications.apply_cancellation` and an Idempotency-Key bound to the exact
cancellation. It locks the application and accounts in stable order, validates
active commitments against the approved allocation, releases affected
commitments, and creates only a linked smaller successor for retained account
quantities. A savepoint isolates effect writes; rolling back to it preserves key
and application locks until the failure is recorded. It records immutable
`COMMITMENT_RELEASE` effects with stable keys
and the original commitment identifier, projects `APPLIED` and `CANCELLED`, and
appends Audit Events and an outbox record in the same transaction. Whole
cancellation releases all active commitments; non-credit cancellation needs no
commitment effects. A failed attempt rolls back every effect before recording
`FAILED`, `last_effect_failure_code`, and `last_effect_failure_kind`
(`RETRYABLE` or `BLOCKING`) separately. A successful retry clears both failure
fields. Applied cancellation records and effect links are immutable.

For posted leave, the same command locks the cancelled lines' accounts in
stable order. For each cancelled `LEAVE_ACCOUNT` line it inserts a
`LEDGER_REVERSAL` that exactly negates the posted entry and, when quantity is
retained, a `LEDGER_REPLACEMENT` for that quantity with the original effective
date and policy. For every cancelled line it asks Attendance to supersede the
posted-leave input with the retained range and quantity, or with a
zero-quantity successor when nothing is retained, and to recalculate the
current Attendance Days across the original range. The `ATTENDANCE_CORRECTION`
effect retains the successor input identifier. Ledger and Attendance effect
rows must name records created for that cancellation. When a finalized
Attendance Period covers the input's dates, Attendance instead accepts a
`POSTED_LEAVE_INPUT` correction at `FOR_AUTHORIZATION`, and the
`ATTENDANCE_LOCKED_CORRECTION` effect retains its identifier with owner status
`FOR_AUTHORIZATION`. The locked records stay unchanged until a different HR
Administrator authorizes it. A missing `ATTENDANCE_CORRECTION_POSTED_LEAVE`
route or other Attendance refusal fails the command with
`LEAVE_CANCELLATION_ATTENDANCE_REFUSED`. Payroll handoffs belong to M4; leave posted before M4 carries
no Payroll Input.

A cancellation scope names the exact cancelled dates within one approval
allocation line. A scope covering the whole line cancels its full quantity. A
partial scope must include the line's first or last date, so the retained
period is one contiguous range and the retained quantity is the line quantity
less the cancelled quantity. Cancelling dates inside a line without either
endpoint is not supported.

Applying a Leave Cancellation follows the same atomic boundary. Whole
cancellation exactly reverses affected ledger entries. Partial cancellation
fully reverses each affected entry and posts a replacement for the retained
quantity with the original effective date and a later posting time. Attendance
and Payroll return idempotent correction or adjustment identifiers. For an
unlocked Work Date, Attendance creates a successor posted-leave input and
recalculates. For a locked Work Date, Attendance accepts a `POSTED_LEAVE_INPUT`
Attendance Correction awaiting Locked Attendance Adjustment authorization. A failed
effect transaction records `FAILED` separately, leaves the approved cancellation
available for retry, and does not change the original posting. `APPLIED` means
all required reversals or owner handoffs exist, even when an accepted downstream
adjustment remains pending.

Required policy, schedule, holiday, document, route, authority, or account gaps
produce a blocking result; they are not filled with schema defaults. A route or
commitment has no silent system-defined expiry.

---

## 10. Monetization

```sql
CREATE TABLE leave_monetization_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  current_version_id uuid,
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','SUBMITTED','CREDIT_CERTIFIED','NEEDS_INFORMATION',
      'FOR_APPROVAL','APPROVED','REJECTED','POSTED','WITHDRAWN','CANCELLED'
    )),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, created_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE leave_monetization_request_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_request_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  kind text NOT NULL CHECK (kind IN ('REGULAR','SPECIAL')),
  approval_route_version_id uuid NOT NULL,
  approval_request_id uuid NOT NULL,
  form_template_document_version_id uuid NOT NULL,
  attestation_type text NOT NULL
    CHECK (attestation_type IN ('AUTHENTICATED_SUBMISSION','SIGNED_DOCUMENT')),
  attestation_document_version_id uuid,
  submitted_by_membership_id uuid NOT NULL,
  employee_attested_at timestamptz,
  reason text,
  authority_snapshot jsonb NOT NULL,
  submitted_at timestamptz NOT NULL,
  CHECK (
    (attestation_type = 'AUTHENTICATED_SUBMISSION'
      AND employee_attested_at IS NOT NULL
      AND attestation_document_version_id IS NULL)
    OR
    (attestation_type = 'SIGNED_DOCUMENT'
      AND employee_attested_at IS NULL
      AND attestation_document_version_id IS NOT NULL)
  ),
  FOREIGN KEY (agency_id, monetization_request_id)
    REFERENCES leave_monetization_requests (agency_id, id),
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
  UNIQUE (monetization_request_id, version_no),
  UNIQUE (agency_id, id)
);

ALTER TABLE leave_monetization_requests
ADD CONSTRAINT leave_monetization_requests_current_version_fk
FOREIGN KEY (agency_id, current_version_id)
REFERENCES leave_monetization_request_versions (agency_id, id);

CREATE TABLE leave_monetization_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_request_version_id uuid NOT NULL,
  leave_account_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  requested_quantity numeric(12,4) NOT NULL CHECK (requested_quantity > 0),
  approved_quantity numeric(12,4),
  CHECK (
    approved_quantity IS NULL
    OR (approved_quantity >= 0 AND approved_quantity <= requested_quantity)
  ),
  FOREIGN KEY (agency_id, monetization_request_version_id)
    REFERENCES leave_monetization_request_versions (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  UNIQUE (monetization_request_version_id, leave_account_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE monetization_eligibility_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_request_version_id uuid NOT NULL,
  result text NOT NULL
    CHECK (result IN ('ELIGIBLE','INELIGIBLE','INDETERMINATE')),
  balance_effective_date date NOT NULL,
  ledger_cutoff timestamptz NOT NULL,
  input_facts jsonb NOT NULL,
  rule_results jsonb NOT NULL,
  assessed_by_membership_id uuid,
  assessed_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, monetization_request_version_id)
    REFERENCES leave_monetization_request_versions (agency_id, id),
  FOREIGN KEY (agency_id, assessed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE monetization_credit_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_request_version_id uuid NOT NULL,
  eligibility_assessment_id uuid NOT NULL,
  certified_by_membership_id uuid NOT NULL,
  certified_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, monetization_request_version_id)
    REFERENCES leave_monetization_request_versions (agency_id, id),
  FOREIGN KEY (agency_id, eligibility_assessment_id)
    REFERENCES monetization_eligibility_assessments (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (monetization_request_version_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE monetization_credit_certification_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_credit_certification_id uuid NOT NULL,
  monetization_allocation_id uuid NOT NULL,
  leave_account_id uuid NOT NULL,
  posted_balance numeric(12,4) NOT NULL,
  other_active_commitments numeric(12,4) NOT NULL
    CHECK (other_active_commitments >= 0),
  certified_quantity numeric(12,4) NOT NULL CHECK (certified_quantity > 0),
  resulting_available_quantity numeric(12,4) NOT NULL
    CHECK (resulting_available_quantity >= 0),
  leave_credit_commitment_id uuid NOT NULL,
  FOREIGN KEY (agency_id, monetization_credit_certification_id)
    REFERENCES monetization_credit_certifications (agency_id, id),
  FOREIGN KEY (agency_id, monetization_allocation_id)
    REFERENCES leave_monetization_allocations (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (agency_id, leave_credit_commitment_id)
    REFERENCES leave_credit_commitments (agency_id, id),
  UNIQUE (monetization_credit_certification_id, leave_account_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE monetization_funding_determinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_request_version_id uuid NOT NULL,
  result text NOT NULL
    CHECK (result IN ('SUPPORTED','UNSUPPORTED','INDETERMINATE')),
  fiscal_authority_document_version_id uuid NOT NULL,
  funding_source_snapshot jsonb NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  reviewed_by_membership_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, monetization_request_version_id)
    REFERENCES leave_monetization_request_versions (agency_id, id),
  FOREIGN KEY (agency_id, fiscal_authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, reviewed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE monetization_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_request_version_id uuid NOT NULL,
  posting_key citext NOT NULL CHECK (btrim(posting_key::text) <> ''),
  valuation_date date NOT NULL,
  calculator_kind citext NOT NULL CHECK (btrim(calculator_kind::text) <> ''),
  factor numeric(12,7) NOT NULL CHECK (factor > 0),
  payroll_input_id uuid NOT NULL,
  payroll_result jsonb NOT NULL,
  posted_by_membership_id uuid NOT NULL,
  posted_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, monetization_request_version_id)
    REFERENCES leave_monetization_request_versions (agency_id, id),
  FOREIGN KEY (agency_id, posted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, posting_key),
  UNIQUE (monetization_request_version_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE monetization_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_posting_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('WHOLE','PARTIAL')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  approval_route_version_id uuid NOT NULL,
  approval_request_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN (
      'DRAFT','FOR_APPROVAL','APPROVED','APPLIED',
      'REJECTED','BLOCKED','RETRYABLE'
    )),
  payroll_adjustment_input_id uuid,
  owner_result jsonb,
  applied_at timestamptz,
  CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL)),
  FOREIGN KEY (agency_id, monetization_posting_id)
    REFERENCES monetization_postings (agency_id, id),
  FOREIGN KEY (agency_id, approval_route_version_id)
    REFERENCES approval_route_versions (agency_id, id),
  FOREIGN KEY (agency_id, approval_request_id)
    REFERENCES approval_requests (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE monetization_adjustment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  monetization_adjustment_id uuid NOT NULL,
  original_ledger_entry_id uuid NOT NULL,
  retained_quantity numeric(12,4) NOT NULL CHECK (retained_quantity >= 0),
  reversal_ledger_entry_id uuid,
  replacement_ledger_entry_id uuid,
  FOREIGN KEY (agency_id, monetization_adjustment_id)
    REFERENCES monetization_adjustments (agency_id, id),
  FOREIGN KEY (agency_id, original_ledger_entry_id)
    REFERENCES leave_ledger_entries (agency_id, id),
  FOREIGN KEY (agency_id, reversal_ledger_entry_id)
    REFERENCES leave_ledger_entries (agency_id, id),
  FOREIGN KEY (agency_id, replacement_ledger_entry_id)
    REFERENCES leave_ledger_entries (agency_id, id),
  UNIQUE (monetization_adjustment_id, original_ledger_entry_id),
  UNIQUE (agency_id, id)
);
```

Submission freezes the request version, allocation, evidence, policy, authority,
and route records. HR certification locks all affected accounts and creates each
commitment in one transaction. The owning service must enforce actor separation
and validate polymorphic commitment sources.

Posting must call Payroll's owning service and receive `ACCEPTED` or the matching
`ALREADY_ACCEPTED` result before atomically:

1. inserting every source-owned negative Leave Ledger Entry;
2. consuming every active commitment;
3. storing the immutable Payroll result and input identifier;
4. updating request status; and
5. appending audit and outbox events.

`REJECTED` and `RETRYABLE_FAILURE` create none of those authoritative effects.
Payroll validates the input identifier across the Agency boundary because its
table belongs to the Payroll schema. Missing authority for valuation date,
allocation, salary components, or rounding blocks posting rather than invoking a
default.

An applied Monetization Adjustment must receive Payroll's accepted cancellation,
replacement, or linked adjustment before it writes exact ledger reversals and
any partial retained replacements. Consumed Payroll Inputs and finalized Payroll
results are never edited. Attach immutable mutation-prevention triggers to
submitted versions, material assessments and determinations, certifications,
postings, applied adjustments, and their lines.

---

## 11. Terminal Leave Input Preservation

```sql
CREATE TABLE terminal_leave_input_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  separation_source_type citext NOT NULL
    CHECK (btrim(separation_source_type::text) <> ''),
  separation_source_id uuid NOT NULL,
  separation_source_version_key citext NOT NULL
    CHECK (btrim(separation_source_version_key::text) <> ''),
  separation_classification citext NOT NULL
    CHECK (btrim(separation_classification::text) <> ''),
  separation_effective_date date NOT NULL,
  ledger_cutoff timestamptz NOT NULL,
  result text NOT NULL CHECK (result IN ('READY','INDETERMINATE')),
  input_facts jsonb NOT NULL,
  missing_or_conflicting_facts jsonb NOT NULL,
  assessed_by_membership_id uuid NOT NULL,
  assessed_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, assessed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (
    agency_id, separation_source_type, separation_source_id,
    separation_source_version_key, ledger_cutoff
  ),
  UNIQUE (agency_id, id)
);

CREATE TABLE terminal_leave_input_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  terminal_leave_input_assessment_id uuid NOT NULL,
  supersedes_snapshot_id uuid,
  snapshot_key citext NOT NULL CHECK (btrim(snapshot_key::text) <> ''),
  service_source_snapshot jsonb NOT NULL,
  authority_snapshot jsonb NOT NULL,
  clearance_document_snapshot jsonb NOT NULL,
  salary_source_reference jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, terminal_leave_input_assessment_id)
    REFERENCES terminal_leave_input_assessments (agency_id, id),
  FOREIGN KEY (agency_id, supersedes_snapshot_id)
    REFERENCES terminal_leave_input_snapshots (agency_id, id),
  UNIQUE (terminal_leave_input_assessment_id),
  UNIQUE (agency_id, snapshot_key),
  UNIQUE (agency_id, supersedes_snapshot_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE terminal_leave_input_snapshot_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  terminal_leave_input_snapshot_id uuid NOT NULL,
  leave_account_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  balance_effective_date date NOT NULL,
  ledger_cutoff timestamptz NOT NULL,
  posted_balance numeric(12,4) NOT NULL CHECK (posted_balance >= 0),
  FOREIGN KEY (agency_id, terminal_leave_input_snapshot_id)
    REFERENCES terminal_leave_input_snapshots (agency_id, id),
  FOREIGN KEY (agency_id, leave_account_id)
    REFERENCES leave_accounts (agency_id, id),
  FOREIGN KEY (agency_id, policy_version_id)
    REFERENCES leave_policy_versions (agency_id, id),
  UNIQUE (terminal_leave_input_snapshot_id, leave_account_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE terminal_leave_input_handoff_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  terminal_leave_input_snapshot_id uuid NOT NULL,
  attempt_key citext NOT NULL CHECK (btrim(attempt_key::text) <> ''),
  result text NOT NULL
    CHECK (result IN (
      'ACCEPTED','ALREADY_ACCEPTED','REJECTED','RETRYABLE_FAILURE'
    )),
  separation_reference jsonb,
  reason jsonb,
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id, terminal_leave_input_snapshot_id)
    REFERENCES terminal_leave_input_snapshots (agency_id, id),
  UNIQUE (terminal_leave_input_snapshot_id, attempt_key),
  UNIQUE (agency_id, id)
);
```

Only a `READY` assessment may create a snapshot. Its account lines use the
effective separation or last service date as the balance date and state the
separate ledger-knowledge cutoff. The Leave service validates the polymorphic
Separation source and owning-module salary reference. Handoff outcomes are
append-only and never mutate the snapshot.

A corrected source creates a reasoned successor assessment and snapshot. These
records cannot close a Leave Account, create a Leave Ledger Entry or Payroll
Input, calculate or authorize a terminal benefit, or record payment. Attach
immutable mutation-prevention triggers to assessments, snapshots, lines, and
handoff outcomes.
