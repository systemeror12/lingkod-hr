# Government Payroll Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---

## Scope and rule model

These tables serve one Appointed Personnel Payroll Rule Set. No table carries a
payroll profile: pay basis is an effective-dated Personnel fact that Payroll
reads (#619), with monthly full-time, proportional part-time, and casual
daily-wage variants. JO/COS Service Payments are outside payroll and have no
table here (#21, #27).

`national_payroll_rule_versions`, `salary_grade_rates`, and `pay_components`
are platform-wide (#328,
[ADR 0013](../../adr/0013-platform-wide-national-payroll-rule-versions.md)).
They have no `agency_id` and no row-level security. `hris_app` holds `SELECT`
only, and the `hris_operator` load command is the only writer. Every other
table here is Agency-owned and isolated by RLS.

A Payroll Period consumes its sources by cutoff
([ADR 0014](../../adr/0014-consume-payroll-sources-by-cutoff.md)), and a
regular period is one calendar month
([ADR 0015](../../adr/0015-regular-payroll-period-is-one-calendar-month.md)).
`docs/data-model/payroll-logical-erd.md` states each table's rules, the three
variants that fail closed without an authorized input, and the yearly GAA
revalidation (#27, #43).

No table stores a free-form formula, a calculation method, or an override of a
calculated line (#27, #43).

---

## 1. National Payroll Rule Versions

```sql
CREATE TABLE national_payroll_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_kind text NOT NULL
    CHECK (rule_kind IN ('SALARY_SCHEDULE','AUTHORIZED_DEDUCTIONS',
                         'GSIS_CONTRIBUTION','EMPLOYEES_COMPENSATION',
                         'YEAR_END_BONUS_AND_CASH_GIFT','COMMUTABLE_RATA')),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  issuing_authority text NOT NULL,
  issuance_reference text NOT NULL,
  source_url text NOT NULL,
  verified_on date NOT NULL,
  verified_by text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  supersedes_rule_version_id uuid UNIQUE
    REFERENCES national_payroll_rule_versions (id) ON DELETE RESTRICT,
  parameters jsonb NOT NULL DEFAULT '{}',
  loaded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE salary_grade_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id uuid NOT NULL
    REFERENCES national_payroll_rule_versions (id) ON DELETE RESTRICT,
  salary_grade integer NOT NULL CHECK (salary_grade > 0),
  salary_step integer NOT NULL CHECK (salary_step > 0),
  monthly_rate numeric(19,4) NOT NULL CHECK (monthly_rate > 0),
  UNIQUE (rule_version_id, salary_grade, salary_step)
);
```

Each ticket that adds a rule kind adds its value to the `rule_kind` check and
its calculator and parameter schema in code. The load validates `parameters`
against that schema. `SALARY_SCHEDULE` has empty parameters, because its rates
are rows. `AUTHORIZED_DEDUCTIONS` is the GAA's authorized-deductions provision
(FY 2026 GAA sec. 62); its parameters list `allowedPayeeCategories`, drawn
from the categories that section names (section 9). `GSIS_CONTRIBUTION`
(RA No. 8291, sec. 5(a)) holds `employeeRate`, `employerRate`, and
`monthlyCompensationLimit`, the AMC limit, which the file states as null only
when its issuance sets none. `EMPLOYEES_COMPENSATION` (PD No. 626, art. 181)
holds `employerRate` and `monthlySalaryCreditCeiling`, and no employee rate.
Rates are fractions, such as `0.09`. Neither kind is issued for 2027
([R18, R23](../../research/national-payroll-rule-versions-2027.md)), so
neither is loaded until its issuance is read (section 9).
`YEAR_END_BONUS_AND_CASH_GIFT` is one fiscal year's year-end bonus and cash
gift rule (FY 2026 GAA sec. 75); its parameters are `serviceFrom`, `asOf`,
`minimumServiceMonths`, `bonusMonthsOfBasicSalary`, `cashGiftAmount`, and
`grantsSeparatedBeforeAsOf` (section 8). `COMMUTABLE_RATA` is one fiscal
year's commutable RATA rule (FY 2026 GAA sec. 71; DBM NBC No. 593); its
parameters are `ranks`, each with its `rank`, the eligible `positionTitles`, and
the monthly `representationAllowance` and `transportationAllowance`, and
`actualWorkSchedule`, NBC 593's bands of `minimumDays` and `share`, rising to a
share of 1 (section 8).

A trigger rejects every `UPDATE` and `DELETE` on both tables. A version is
immutable from load, so there is no status column and no draft. A correction or
a new issuance is a new row that names the version it supersedes. A second
trigger admits a `salary_grade_rates` row only for a `SALARY_SCHEDULE` version
inserted in the same transaction, so a loaded schedule cannot gain rates later.

The version in effect on a date is the one whose effectivity covers the date
and that no successor has replaced from that date. The load refuses a version
that would leave two versions of one kind in effect on the same date. A
superseded row keeps its own dates, so this is checked by the load, not by an
exclusion constraint.

There is no derived-rate column. The compensation basis (#332) derives the
daily rate as the monthly rate ÷ 22, the 22-working-day divisor of RA No. 6758,
sec. 7. It matches each stretch of an Employee's Personnel salary facts to the
salary schedule in effect on those dates, and returns `INDETERMINATE`, with
reasons, for a missing fact, an unsupported pay basis, or a missing schedule or
rate. The salary calculator does not prorate a partial month of a
monthly-paid Employee: no rule is recorded for that case, and it blocks until
an authority is found
([authorities](../../research/partial-month-basic-salary-authorities.md)).

---

## 2. Pay Component Catalogue

```sql
CREATE TABLE pay_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL
    CHECK (category IN ('EARNING','DEDUCTION','EMPLOYER_SHARE','INFORMATIONAL')),
  is_conditional boolean NOT NULL,
  is_gaa_revalidated boolean NOT NULL,
  accepts_authorized_input boolean NOT NULL,
  reporting_category text
);
```

The catalogue is fixed and loaded with the rule versions. An Agency cannot add
or change a component, and there is no free-form pay item (#27).

A component's tax and contribution treatment is not a column here. It is
specified with the contribution and tax calculators (#348, #350, #632).

There is no `pay_component_rule_versions` and no `employee_compensations`
table. A component's rule is a `national_payroll_rule_versions` row of its
kind. Grade, step, pay basis, and employment fraction are Personnel facts
(#619).

---

## 3. Agency Payroll Applicability and Authorized Inputs

```sql
CREATE TABLE agency_payroll_applicabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  pay_component_id uuid NOT NULL REFERENCES pay_components (id),
  scope text NOT NULL CHECK (scope IN ('AGENCY','EMPLOYEE')),
  employee_id uuid,
  authority_document_version_id uuid NOT NULL,
  funding_reference text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((scope = 'EMPLOYEE') = (employee_id IS NOT NULL)),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE authorized_payroll_component_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  pay_component_id uuid NOT NULL REFERENCES pay_components (id),
  scope text NOT NULL CHECK (scope IN ('AGENCY','EMPLOYEE')),
  employee_id uuid,
  value_kind text NOT NULL CHECK (value_kind IN ('AMOUNT','RATE','QUANTITY')),
  value numeric(19,8) NOT NULL CHECK (value > 0),
  payment_schedule text NOT NULL
    CHECK (payment_schedule IN ('ONCE','EACH_REGULAR_PERIOD')),
  authority_document_version_id uuid NOT NULL,
  source_reference text NOT NULL CHECK (btrim(source_reference) <> ''),
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('RECORDED','APPROVED','CANCELLED')),
  recorded_by_membership_id uuid NOT NULL,
  approved_by_membership_id uuid,
  approved_at timestamptz,
  consumed_by_payroll_period_id uuid,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((scope = 'EMPLOYEE') = (employee_id IS NOT NULL)),
  CHECK (approved_by_membership_id IS DISTINCT FROM recorded_by_membership_id),
  CHECK ((status = 'APPROVED') = (approved_at IS NOT NULL)
    AND (approved_at IS NULL) = (approved_by_membership_id IS NULL)),
  CHECK (consumed_by_payroll_period_id IS NULL
    OR (status = 'APPROVED' AND payment_schedule = 'ONCE')),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, consumed_by_payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE INDEX ON authorized_payroll_component_inputs
  (agency_id, pay_component_id, status, effective_from);
```

Applicability records for one component and one scope target must not overlap:
add an exclusion constraint over `(agency_id, pay_component_id, employee_id,
daterange)`. A trigger requires the component to be conditional and, for a
GAA-revalidated component, an `effective_to` no later than 31 December of the
year of `effective_from`. After insert, only `effective_to` may move, and only
earlier.

Migration 0159 creates `agency_payroll_applicabilities` (#618). The record and
end services each need `payroll.compensation.manage` for the whole Agency and
write an Audit Event; ending takes a reason for that event. The authority is a
finalized Document Version of the Agency. A lookup for a component, date, and
optional Employee answers applicable, not applicable, or expired, preferring
the Employee's own record over the Agency-wide one. An unconditional component
is applicable with no record.

An official-vehicle assignment is an applicability record of the
`OFFICIAL_VEHICLE_ASSIGNMENT` component for one named Employee, whose authority
is the assignment's Document Version (#343). Migration 0169 adds it to the
catalogue as conditional, so it takes a record, `INFORMATIONAL`, so it writes
no line, and not GAA-revalidated. It still needs a funding reference, which an
assignment does not have.

Migration 0156 creates `authorized_payroll_component_inputs` (#346), and
migration 0157 adds the `consumed_by_payroll_period_id` foreign key to
`payroll_periods`. Marking a `ONCE` input consumed is #626.

A trigger requires an authorized input's component to accept one and the
input to start `RECORDED`. Before approval, an input is approved or cancelled
and nothing else changes. Approval needs an approver who is not the recorder:
the check compares Users, so two memberships of one person count as one (#27).
An approved input changes only by an earlier `effective_to` or by its `ONCE`
consumption. No input is deleted. `hris_app` holds `SELECT`, `INSERT`, and
`UPDATE` under the Agency policy.

The record and approve services each need `payroll.inputs.adjust` for the
whole Agency and write an Audit Event. The recorder's authority is a finalized
Document Version of the Agency.

National ceilings, such as the 20% night-shift rate, are checked by the service
that records the input (#43). No National Payroll Rule Version kind carries the
RATA ceiling yet, so the service refuses every reimbursable RATA input
(catalogue code `REIMBURSABLE_RATA`) until one is loaded. The night-shift rate
ceiling arrives with its calculation (#627).

---

## 4. Payroll Input Inbox

```sql
CREATE TABLE payroll_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  source_module text NOT NULL
    CHECK (source_module IN ('LEAVE','OVERTIME')),
  input_kind text NOT NULL
    CHECK (input_kind IN ('LEAVE_WITHOUT_PAY','UNPAID_DEFICIT_REMAINDER',
                          'MONETIZATION_EARNING','OVERTIME_HOURS')),
  source_key citext NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  effective_date date NOT NULL,
  quantity numeric(12,4),
  amount numeric(19,4),
  status text NOT NULL
    CHECK (status IN ('PENDING','CONSUMED','CANCELLED')),
  payload_snapshot jsonb NOT NULL,
  payload_hash text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  consumed_by_payroll_period_id uuid,
  replaces_payroll_input_id uuid,
  source_correction_key citext,
  CHECK ((input_kind = 'MONETIZATION_EARNING') = (amount IS NOT NULL)),
  CHECK ((input_kind = 'OVERTIME_HOURS') = (source_module = 'OVERTIME')),
  CHECK ((status = 'CONSUMED') = (consumed_by_payroll_period_id IS NOT NULL)),
  CHECK (source_correction_key IS NULL OR status = 'CANCELLED'),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, consumed_by_payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, replaces_payroll_input_id)
    REFERENCES payroll_inputs (agency_id, id),
  UNIQUE (agency_id, source_module, source_key),
  UNIQUE (agency_id, source_module, source_correction_key),
  UNIQUE (agency_id, id)
);
```

Only Leave and Overtime post here. The source names an input kind and its own
stable effect key, never a pay component. A retry with the same key and the
same `payload_hash` returns the existing input, and the same key with a
different payload is rejected. Payroll returns `ACCEPTED`, matching
`ALREADY_ACCEPTED`, `REJECTED`, or `RETRYABLE_FAILURE` to the owner command. A
rejected or retryable request creates no Payroll Input.

There is no manual source. An amount, rate, or quantity that no source module
owns is an Authorized Payroll Component Input in its own table (#27, #328).
Payroll reads Attendance Payroll Facts and Personnel salary facts through their
owning services and copies neither here (#329, #619).

An input belongs to no period when accepted. After acceptance a trigger allows
only the status change, `consumed_by_payroll_period_id`, which the
finalization transaction sets, and `source_correction_key`, which a withdrawal
sets. Consumed inputs are immutable, apart from the
return to `PENDING` when their payroll is voided. The migration that creates
`payroll_periods` adds the foreign key on `consumed_by_payroll_period_id`, which
until then has only its CHECK (#338).

A source module corrects an effect it posted by asking Payroll to withdraw the
input, in its own transaction and idempotently by a stable correction key
(#330):

- a `PENDING` input that no live calculation uses, or whose period is `DRAFT`,
  becomes `CANCELLED`. A replacement is a new input with
  `replaces_payroll_input_id`;
- a `PENDING` input used by a `CALCULATING`, `FOR_REVIEW`, `CERTIFIED`, or
  `APPROVED` period becomes `CANCELLED`, and the period gets a blocking
  exception until it is returned and recalculated;
- a `CONSUMED` input is unchanged. Payroll opens a Payroll Adjustment, or
  joins the open one, and returns its identifier (section 10).

There is no `REVERSED` or `SUPERSEDED` status.

`withdrawInTransaction` builds the first case (#357). It writes the correction
key with the cancellation, so a retry with the key answers `ALREADY_WITHDRAWN`,
the key cannot withdraw another input, and another key cannot withdraw a
cancelled one. Inputs cancelled before migration 0166 have no key. Per ADR
0014, a live calculation uses the input when a period past `DRAFT` has a
`cutoff_at` at or after its `accepted_at`. No recorded rule maps an input kind
to a special period's components, so a live special period counts too. The
withdrawal locks the Agency's open periods, so a calculation cannot start
until it commits. Until #649 builds the second and third cases, Payroll refuses
both as `RETRYABLE_FAILURE`, with `PAYROLL_INPUT_IN_LIVE_CALCULATION` or
`PAYROLL_INPUT_CONSUMED_CORRECTION_UNAVAILABLE`, and changes nothing. A
cancelled input stays readable with its key.

For a Leave Monetization input, Payroll resolves the authoritative salary source
and computes `amount`; Leave may not supply either as an unrestricted value. The
immutable `payload_snapshot` must bind the exact Monetization Posting, approved
per-account credit quantities, stable effect key, valuation date, fixed
calculator and authority-bound factor, policy and authority Document Versions,
funding determination, Approval Decisions, resolved salary source and value,
calculation steps, and evidence-backed rounding rule and result.

Leave posts it with `source_key` the posting key, `source_type`
`MONETIZATION_POSTING`, `source_id` the Leave Monetization Request Version, and
`effective_date` the valuation date. Payroll adds its valuation to the payload
under `payrollValuation`; `payload_hash` stays the hash of Leave's request, so
a retry replays without valuing again. The calculator is S × credits ×
0.0481927, the published constant for monetization and terminal leave alike
(CSC MC No. 2, s. 2016; DBM BC No. 2016-2, sec. 3.1), and Payroll rejects any
other calculator or factor. The authority's S is the highest monthly salary
received; no recorded rule says which compensation-basis value that is, so
Payroll names `AUTHORITATIVE_SALARY_SOURCE` until one is recorded (#614). Once
a salary rule is recorded, Payroll reads the salary through the compensation
basis (#332) and still names it while the basis does not resolve. No authority
settles the valuation date or centavo rounding (#614, questions 1 and 4), so
Payroll answers `RETRYABLE_FAILURE` naming `VALUATION_DATE_RULE` and
`ROUNDING_RULE` too.

A Monetization Adjustment withdraws the posted input with its adjustment key,
`MONETIZATION_ADJUSTMENT:<id>`, as the correction key (#357). When it retains
credits, Leave also posts a replacement in the same transaction: a
`MONETIZATION_EARNING` input with `source_key` the adjustment key,
`source_type` `MONETIZATION_ADJUSTMENT`, `quantity` the retained credits, and
the posting's valuation date and calculator. Payroll values it like the
original. If Payroll refuses the replacement, the withdrawal rolls back.
Payroll answers with the replacement's identifier and `PENDING`, or with the
cancelled input's identifier and `CANCELLED` when no credits are retained.

Migration 0161 moved the phase-local `payroll_monetization_earning_inputs` rows
here with their identifiers and dropped the table (#339). A superseded row is
`CANCELLED`, and its successor names it in `replaces_payroll_input_id`. Each
row's old status and the columns this table lacks stay in `payload_snapshot`
under `movedFrom` and `payrollValuation`. `payroll_monetization_adjustment_outcomes`
keeps its rows, with its foreign keys now on this table. It has no writer,
because the cancelled input's correction key records Payroll's answer (#357).

For leave without pay, `payload_snapshot` holds the day quantity for each Work
Date of the allocation line. Payroll values each calendar month's days at the
monthly salary in effect on those Work Dates, ÷ 22 (CSC MC No. 8, s. 2014;
#328).

For overtime pay, Overtime posts one `OVERTIME_HOURS` input when it certifies
an Overtime Service Record under an `OVERTIME_PAY` authority, keyed by that
record. Its `quantity` is the Certified Overtime Hours in whole minutes, as
ADR 0009 counts COC, so no unsourced rounding rule applies, and `payload_snapshot`
records `quantityUnit: 'MINUTE'`, the day classification, the Work Date, and
the authority and Attendance provenance (#347).

---

## 5. Payroll Periods

```sql
CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  run_type text NOT NULL CHECK (run_type IN ('REGULAR','SPECIAL')),
  period_from date NOT NULL,
  period_to date NOT NULL,
  cutoff_at timestamptz NOT NULL,
  payment_date date NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','CALCULATING','FOR_REVIEW','CERTIFIED','APPROVED','FINALIZED','VOIDED')),
  carries_adjustments boolean NOT NULL DEFAULT false,
  calculation_version integer NOT NULL DEFAULT 0 CHECK (calculation_version >= 0),
  finalized_at timestamptz,
  void_requested_by_membership_id uuid,
  void_requested_at timestamptz,
  void_reason text,
  void_document_version_id uuid,
  voided_by_membership_id uuid,
  voided_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (period_to >= period_from),
  CHECK (NOT carries_adjustments OR run_type = 'SPECIAL'),
  CHECK ((void_requested_at IS NULL) = (void_requested_by_membership_id IS NULL)),
  CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CHECK (status <> 'VOIDED'
         OR (voided_by_membership_id IS NOT NULL AND btrim(void_reason) <> '')),
  CHECK (void_requested_by_membership_id IS NULL
         OR void_requested_by_membership_id <> voided_by_membership_id),
  FOREIGN KEY (agency_id, void_requested_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, voided_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, void_document_version_id)
    REFERENCES document_versions (agency_id, id),
  CHECK (
    run_type <> 'REGULAR'
    OR (period_from = date_trunc('month', period_from)::date
        AND period_to = (period_from + interval '1 month - 1 day')::date)
  ),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX payroll_periods_regular_month_key
  ON payroll_periods (agency_id, period_from)
  WHERE run_type = 'REGULAR' AND status <> 'VOIDED';

CREATE UNIQUE INDEX payroll_periods_one_open_regular_key
  ON payroll_periods (agency_id)
  WHERE run_type = 'REGULAR' AND status NOT IN ('FINALIZED','VOIDED');

CREATE TABLE payroll_period_components (
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  pay_component_id uuid NOT NULL REFERENCES pay_components (id),
  PRIMARY KEY (payroll_period_id, pay_component_id),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id)
);
```

A period carries no payroll profile. One run covers every pay basis of the
Appointed Personnel Payroll Rule Set (#27).

`calculation_version` counts the calculations of one run and is not part of the
key. A regular period is one calendar month, so one unique index refuses a
duplicate month and the other keeps an Agency to one regular period that is not
`FINALIZED` or `VOIDED`. A special period may overlap any dates, and a trigger
requires it to name at least one component before calculation and a regular
period to name none.

`cutoff_at` changes only while the period is `DRAFT`. The service refuses to
start a calculation before it.

Starting a calculation needs `payroll.periods.calculate` and claims the
Payroll Preparer's `PREPARATION` function (#621). In one transaction it moves
the period from `DRAFT` to `CALCULATING`, advances `calculation_version`, and
freezes that version's rule snapshot (section 6); a missing required rule
refuses the start and changes nothing. A special period is refused unless it
names a component and a calculator exists for each one it names; it runs only
those calculators. A second start at the same
`row_version` finds the period moved and is refused.

The committed `CALCULATING` period is the queued job. The calculation job
reads every `CALCULATING` period through `payroll_calculations_due()`, a
`SECURITY DEFINER` function that returns only identifiers and versions across
Agencies, then runs each under its own Agency's context. A run locks the
period row and writes nothing unless the period is still `CALCULATING` at its
version, so a repeated or concurrent run is harmless and a run that died
mid-transaction left nothing. The run writes every result, line, and
exception with the period's next status in one transaction: `FOR_REVIEW` on a
clean run, `DRAFT` on any blocking exception. A failure rolls that back and
returns the period to `DRAFT`. Each outcome is a `SYSTEM` Audit Event with the
reason, keyed to its calculation version.

Migration 0153 creates the period tables (#333). Its trigger also keeps a
period's code, run type, dates, and `carries_adjustments` fixed, creates it
`DRAFT`, rejects every `DELETE`, holds the status to the transitions of
`hris-controls.md` §5.20 with `VOIDED` final, and advances
`calculation_version` by one exactly when the period moves from `DRAFT` to
`CALCULATING`. A component joins only a `DRAFT` special period.

A special period carries Payroll Adjustments only with `carries_adjustments`.
The trigger accepts that in place of a named component. A regular period
always carries them (section 10). Until Payroll Adjustments exist, the create
command does not set it, so a special period always names a component.

A period becomes `VOIDED` in two ways (#330). The Payroll Preparer cancels a
`DRAFT` period with a reason: `void_reason`, `voided_by_membership_id`, and
`voided_at` are set, and there is no request. A `FINALIZED` period is voided
in two steps: the request sets `void_requested_by_membership_id`,
`void_requested_at`, `void_reason`, and `void_document_version_id`, and a
different person's approval sets `voided_by_membership_id` and `voided_at`. A
declined request clears the request columns and stays in its Audit Events.

The service refuses a void request and a void approval when:

- a regular period has a later regular period that is not `VOIDED`;
- any Payment Instruction of the period has `SUBMITTED`, `ACCEPTED`, or
  `SETTLED` as its latest Disbursement Outcome.

The void transaction marks the period and its results `VOIDED`, returns its
Payroll Inputs to `PENDING`, sets `released_at` on its
`payroll_consumed_attendance_facts`, releases its once-only Authorized Payroll
Component Inputs, supersedes its Payslips and exports, cancels every open
Payroll Adjustment against it, and reopens every adjustment it carried
([ADR 0016](../../adr/0016-payroll-corrections-are-recalculated-differences.md)).

```sql
CREATE TABLE payroll_period_actors (
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  payroll_function text NOT NULL
    CHECK (payroll_function IN ('PREPARATION','HR_CERTIFICATION','BUDGET_REVIEW',
                                'ACCOUNTING_REVIEW','APPROVAL','DISBURSEMENT')),
  first_acted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payroll_period_id, membership_id),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, membership_id)
    REFERENCES agency_memberships (agency_id, id)
);
```

On one Payroll Period a person acts in at most one payroll function, across
every calculation version (#330). Each command that belongs to a function
inserts its row with `ON CONFLICT DO NOTHING` in its own transaction, then
refuses when the stored function differs. The primary key makes the rule hold
under concurrency, and a trigger rejects every `UPDATE` and `DELETE`. The
functions and their commands are in `hris-controls.md` §5.20.

---

## 6. Rule Snapshots

```sql
CREATE TABLE payroll_rule_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  calculation_version integer NOT NULL CHECK (calculation_version > 0),
  cutoff_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  UNIQUE (payroll_period_id, calculation_version),
  UNIQUE (agency_id, id)
);

CREATE TABLE payroll_rule_snapshot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_rule_snapshot_id uuid NOT NULL,
  national_payroll_rule_version_id uuid
    REFERENCES national_payroll_rule_versions (id),
  agency_payroll_applicability_id uuid,
  authorized_payroll_component_input_id uuid,
  CHECK (num_nonnulls(national_payroll_rule_version_id,
                      agency_payroll_applicability_id,
                      authorized_payroll_component_input_id) = 1),
  FOREIGN KEY (agency_id, payroll_rule_snapshot_id)
    REFERENCES payroll_rule_snapshots (agency_id, id),
  FOREIGN KEY (agency_id, agency_payroll_applicability_id)
    REFERENCES agency_payroll_applicabilities (agency_id, id),
  FOREIGN KEY (agency_id, authorized_payroll_component_input_id)
    REFERENCES authorized_payroll_component_inputs (agency_id, id),
  UNIQUE (payroll_rule_snapshot_id, national_payroll_rule_version_id),
  UNIQUE (payroll_rule_snapshot_id, agency_payroll_applicability_id),
  UNIQUE (payroll_rule_snapshot_id, authorized_payroll_component_input_id)
);
```

One snapshot is taken per calculation version, when calculation starts. It
lists every rule version, of every kind, in effect on any date of the period,
every approved Authorized Payroll Component Input of the Agency whose effective
period overlaps the period, Agency-wide or Employee-scoped, and the
applicability records used. Items are references, not copies. Whether the
calculation pays an input is #626. Snapshots and their items are immutable.

Migration 0153 creates both tables (#333), and a trigger rejects every
`UPDATE` and `DELETE`. An item joins its snapshot only in the transaction that
takes it. The snapshot freezes the period's current `calculation_version`, so
the transaction that starts a calculation advances the version first (#621).
Each rule kind the calculators need must be in effect on every date of the
period; a date with none refuses the snapshot, naming the version that ended
if one did. A kind no calculator requires yet is referenced on the dates it
covers and never refuses. `SALARY_SCHEDULE` is the only kind yet.

Migration 0157 adds `authorized_payroll_component_input_id` with its foreign
key and UNIQUE, and replaces `payroll_rule_snapshot_items_one_source_check`
with one that counts it beside `national_payroll_rule_version_id` (#346).
Migration 0159 adds `agency_payroll_applicability_id` with its foreign key and
UNIQUE, and replaces the CHECK again (#618). The snapshot references every
applicability record of the Agency whose effective period overlaps the period.

---

## 7. Payroll Employee Results and Payroll Holds

```sql
CREATE TABLE payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  calculation_version integer NOT NULL CHECK (calculation_version > 0),
  employee_id uuid NOT NULL,
  compensation_basis_snapshot jsonb NOT NULL,
  status text NOT NULL
    CHECK (status IN ('PENDING','CALCULATED','EXCEPTION','REVIEWED','FINALIZED','VOIDED')),
  gross_amount numeric(19,4) NOT NULL DEFAULT 0,
  total_deductions numeric(19,4) NOT NULL DEFAULT 0,
  net_amount numeric(19,4) NOT NULL DEFAULT 0,
  calculation_hash text NOT NULL,
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (payroll_period_id, calculation_version, employee_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE payroll_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  payroll_exception_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  placed_by_membership_id uuid NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  lifted_by_membership_id uuid,
  lifted_at timestamptz,
  CHECK ((lifted_at IS NULL) = (lifted_by_membership_id IS NULL)),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, payroll_exception_id)
    REFERENCES payroll_exceptions (agency_id, id),
  FOREIGN KEY (agency_id, placed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, lifted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX payroll_holds_one_active_key
  ON payroll_holds (payroll_period_id, employee_id)
  WHERE lifted_at IS NULL;
```

Results are append-only. A recalculation inserts the next calculation version's
rows and never deletes or recomputes an earlier version's, because
certification and the Certified Payroll Review Export bind one exact version
(#29, #328). Once a calculation completes, only a result's `status` changes.

`compensation_basis_snapshot` freezes what #332 resolved, one entry per
continuous segment: Service Segment, salary grade, step, pay basis, employment
fraction, salary rate, and their sources.

Migration 0162 creates `payroll_employees` (#621); `payroll_holds` arrives
with the hold command. The calculation writes one result for each Employee
with a Service Segment on any date of the period: `CALCULATED` with its lines,
or `EXCEPTION` with a blocking exception, the frozen basis, zero totals, and no
line. A check's blocking exception (§10) names the Employee and leaves the
result `CALCULATED`. A trigger admits a result only while its period is
`CALCULATING` at the result's version, rejects every `DELETE`, and lets an `UPDATE` change only
`status`. `calculation_hash` is the SHA-256 of the canonical JSON of what the
calculation decided: the Employee, the period dates, the compensation basis,
the lines, the exceptions, and the totals. Row ids, times, and the version are
left out, so the same snapshot and inputs reproduce it.

A hold is placed or lifted only while the period is `DRAFT`, and only against
an Employee-level blocking exception. A held Employee has no result in that
period. When the period is finalized, the finalization transaction opens a
Payroll Adjustment for each Employee under an active hold, which is how the
held month is paid later (#330).

---

## 8. Payroll Lines and Their Sources

```sql
CREATE TABLE payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_employee_id uuid NOT NULL,
  pay_component_id uuid NOT NULL REFERENCES pay_components (id),
  rule_version_id uuid REFERENCES national_payroll_rule_versions (id),
  line_type text NOT NULL
    CHECK (line_type IN ('EARNING','DEDUCTION','EMPLOYER_SHARE','INFORMATIONAL')),
  quantity numeric(12,4),
  rate numeric(19,8),
  amount numeric(19,4) NOT NULL,
  taxable_amount numeric(19,4) NOT NULL DEFAULT 0,
  contribution_base numeric(19,4) NOT NULL DEFAULT 0,
  source_snapshot jsonb NOT NULL,
  payroll_adjustment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  FOREIGN KEY (agency_id, payroll_adjustment_id)
    REFERENCES payroll_adjustments (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE payroll_line_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_line_id uuid NOT NULL,
  payroll_input_id uuid,
  attendance_payroll_fact_id uuid,
  authorized_payroll_component_input_id uuid,
  CHECK (num_nonnulls(payroll_input_id, attendance_payroll_fact_id,
                      authorized_payroll_component_input_id) = 1),
  FOREIGN KEY (agency_id, payroll_line_id)
    REFERENCES payroll_lines (agency_id, id),
  FOREIGN KEY (agency_id, payroll_input_id)
    REFERENCES payroll_inputs (agency_id, id),
  FOREIGN KEY (agency_id, attendance_payroll_fact_id)
    REFERENCES attendance_payroll_facts (agency_id, id),
  FOREIGN KEY (agency_id, authorized_payroll_component_input_id)
    REFERENCES authorized_payroll_component_inputs (agency_id, id),
  UNIQUE (payroll_line_id, payroll_input_id),
  UNIQUE (payroll_line_id, attendance_payroll_fact_id),
  UNIQUE (payroll_line_id, authorized_payroll_component_input_id)
);

CREATE TABLE payroll_consumed_attendance_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  attendance_payroll_fact_id uuid NOT NULL,
  payroll_period_id uuid NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  FOREIGN KEY (agency_id, attendance_payroll_fact_id)
    REFERENCES attendance_payroll_facts (agency_id, id),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id)
);

CREATE UNIQUE INDEX payroll_consumed_attendance_facts_one_live_key
  ON payroll_consumed_attendance_facts (agency_id, attendance_payroll_fact_id)
  WHERE released_at IS NULL;
```

Lines are inserted with their result. A trigger rejects every `UPDATE` and
`DELETE` once the calculation that wrote them completes.

Migration 0162 creates `payroll_lines` (#621). A line joins its result only in
the transaction that wrote the result, and every `UPDATE` and `DELETE` is
rejected. Each column arrives with the calculator that needs it:
`taxable_amount` with the tax calculator (#350), and `payroll_adjustment_id`
with Payroll Adjustments (#330).

Migration 0164 creates `payroll_line_sources` and
`payroll_consumed_attendance_facts` (#341). A source joins its line only in the
transaction that wrote the line, and every `UPDATE` and `DELETE` is rejected.
`hris_app` holds `SELECT` on `payroll_consumed_attendance_facts`; finalization,
its only writer, grants itself `INSERT` and `UPDATE` when it arrives.

The `BASIC_SALARY` component, which 0162 adds to the catalogue, pays a full
month on the monthly full-time or proportional part-time basis as one
`EARNING` line: quantity 1 month, the monthly rate the compensation basis
derived, the salary schedule as `rule_version_id`, and the Service Segments,
grade, step, pay basis, and fraction in `source_snapshot`. Every case no
recorded rule settles is a blocking exception and no line: an `INDETERMINATE`
basis, a partial month (PAY-002, until #622), a casual daily wage, whose paid
days in a month no recorded rule fixes, a rate, pay basis, or schedule that
changes inside the month, such as a step increment, an amount that is not
whole centavos, and a schedule the snapshot did not freeze.

The `DAYS_WITHOUT_PAY` component, which 0164 adds, deducts salary for days
without pay as `DEDUCTION` lines: quantity × monthly salary ÷ 22 (CSC MC No. 8,
s. 2014), so with `BASIC_SALARY` a month pays `(22 − days) / 22` of its salary.
Its days are leave without pay from `LEAVE_WITHOUT_PAY` inputs and whole Work
Dates of `ABSENCE` facts (MC 41 sections 50 and 56). It writes one line per
calendar month and salary in effect on those Work Dates, with the days in
`quantity`, the monthly salary in `rate`, the salary schedule as
`rule_version_id`, each Work Date's days and source in `source_snapshot`, and
every input and fact it rests on in `payroll_line_sources`. A Work Date outside
the period is valued at the compensation basis on that date, which the
period's rule snapshot does not cover.

The calculation takes the `PENDING` inputs accepted, and the `ABSENCE` facts
published, at or before its rule snapshot's `cutoff_at`, less the facts in a
live `payroll_consumed_attendance_facts` row (ADR 0014). A fact counts as its
delta, `corrected_minutes − prior_minutes`, so an adjustment publication
counts only its change, and withdrawing a deducted absence gives a negative
line. Payroll never deducts `TARDINESS` or `UNDERTIME` facts (ADR 0012).
Every case no recorded rule settles blocks and writes no line:

- an `UNPAID_DEFICIT_REMAINDER` input, and an `ABSENCE` delta that is not a
  whole Work Date's expected minutes: no authority on file values a fraction of
  a day without pay. MC 8 counts days without pay, and MC 41 Table II converts
  minutes to fractions of a day only to charge leave credits (#329). The
  exception names `FRACTIONAL_DAY_SALARY_RULE` in `details.missingFacts`;
- a tardiness or undertime fact, in any publication at or before the cutoff,
  that Leave's application service reports as owed a charge (ADR 0012);
- leave without pay counted in calendar days, which include days outside MC
  8's 22-workday month exclusive of Saturdays and Sundays;
- more than 22 days in one month, which the formula would make negative pay;
- a Work Date whose compensation basis is `INDETERMINATE` or a casual daily
  wage, which has no monthly salary;
- an amount that is not whole centavos, which no recorded rule rounds.

A blocked result keeps none of its calculators' lines (section 7).

The `YEAR_END_BONUS` and `CASH_GIFT` components, which migration 0165 adds to
the catalogue with the `YEAR_END_BONUS_AND_CASH_GIFT` rule kind (#344), are
paid in a special period that names them and covers its rule version's service
window, January 1 to October 31. The version's parameters hold that window,
the minimum months of service, the months of basic salary, the cash gift
amount, and whether the GAA grants the case of personnel who left before
October 31 (FY 2026 GAA sec. 75). An Employee in service on October 31 with
the minimum months, counted in whole calendar months across their Service
Segments in the window, gets one `EARNING` line of one month's basic salary as
of that day, with the version as `rule_version_id` and the salary schedule in
`source_snapshot`, and one cash gift line. Under the minimum there is no
bonus. `source_snapshot.taxTreatment` marks the bonus
`THIRTEENTH_MONTH_AND_OTHER_BENEFITS`, counting toward the ₱90,000 exclusion
(#351), and the cash gift `DE_MINIMIS`. Every case no recorded rule settles
blocks the component and writes no line: no version with the period's window,
service months that turn on leftover days or a month end, a reduced cash gift
under the minimum, a separated Employee where the version grants that case,
because no rule on record prorates the bonus and the record does not show a
separation from government service rather than a transfer, a part-time cash
gift, a casual daily wage bonus, an `INDETERMINATE` basis on October 31, and a
schedule the snapshot did not freeze.

The `REPRESENTATION_ALLOWANCE` and `TRANSPORTATION_ALLOWANCE` components, which
migration 0169 adds with the `COMMUTABLE_RATA` rule kind (#343), pay
commutable RATA in a regular period as two `EARNING` lines. An Employee is
eligible when the Plantilla Position of their Service Segment carries a title
the version lists under a rank, compared trimmed, with one space and in any
case, and is paid that rank's monthly rates. Personnel supplies the title.
`quantity` is the share NBC 593's schedule gives the month's days of actual
work, `rate` the monthly rate, and `source_snapshot.taxTreatment` is
`NON_TAXABLE` (RR No. 11-2018 sec. 2.79(B)). The days come from the Attendance
facts published at or before the cutoff for the period's Work Dates, each
fact at its latest publication: a Work Date the Employee worked with no posted
leave, absence, approved absence, or CTO counts, and one wholly on those does
not. An `OFFICIAL_VEHICLE_ASSIGNMENT` record covering every served date of the
month leaves out the transportation line. A position whose title no rank
lists, such as an officer-in-charge's own, gets no line; reimbursable RATA is
an authorized input (#346). Every case no recorded rule settles blocks and
writes no line: no version in effect on every date of the month, or one that
changes in it; a rank that changes or ends in the month; a part-time or casual
pay basis; days that could change the share whose count as actual work no
rule settles, which are official business, travel, or training with no work
that day, a day partly on leave, absent, or on CTO, and a date no published
Attendance Period covers yet; a vehicle assignment for part of the month; and
an amount that is not whole centavos. With no version in effect, every Employee
blocks, since eligibility comes from the version.

A calculated line has no override column. A wrong amount is corrected at its
source, or after finalization through a Payroll Adjustment (#27, #330). A line
with `payroll_adjustment_id` carries the past period's component and the
signed difference.

A line can rest on several sources, and one source on several lines.
`payroll_consumed_attendance_facts` is Payroll's own record that a finalized
payroll consumed a fact: the unique index makes the second finalization fail,
and Attendance's tables are never written (ADR 0014). A void sets
`released_at`, so the replacement payroll can consume the fact (#330).

---

## 9. Contributions, Tax, and Loans

```sql
CREATE TABLE contribution_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_employee_id uuid NOT NULL,
  contribution_type text NOT NULL
    CHECK (contribution_type IN ('GSIS','PHILHEALTH','PAGIBIG','EMPLOYEES_COMPENSATION')),
  employee_share numeric(19,4) NOT NULL,
  employer_share numeric(19,4) NOT NULL,
  compensation_base numeric(19,4) NOT NULL,
  rule_version_id uuid NOT NULL REFERENCES national_payroll_rule_versions (id),
  CHECK (contribution_type <> 'EMPLOYEES_COMPENSATION' OR employee_share = 0),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  UNIQUE (payroll_employee_id, contribution_type)
);

CREATE TABLE tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_employee_id uuid NOT NULL,
  taxable_compensation numeric(19,4) NOT NULL,
  non_taxable_compensation numeric(19,4) NOT NULL,
  withholding_tax numeric(19,4) NOT NULL,
  rule_version_id uuid NOT NULL REFERENCES national_payroll_rule_versions (id),
  year_to_date_snapshot jsonb NOT NULL,
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  UNIQUE (payroll_employee_id)
);
```

Employees' Compensation is employer-only, and there is no `OTHER` contribution
type (#27, #328). A special period writes a tax line for its taxable lines and
no contribution lines.

Migration 0163 creates `contribution_lines` for `GSIS` and
`EMPLOYEES_COMPENSATION` (#348); `PHILHEALTH` and `PAGIBIG` join its type
check with their calculators (#632). A line joins its result only in the
transaction that writes the result, every `UPDATE` and `DELETE` is rejected,
and RLS is forced. Each share is also a Payroll Line, so the totals and the
payslip carry it: `GSIS_PERSONAL_SHARE` is a `DEDUCTION`, and
`GSIS_GOVERNMENT_SHARE` and `EMPLOYEES_COMPENSATION` are `EMPLOYER_SHARE`
lines, which never reduce pay. Each line's quantity is the base and its rate
the version's, so quantity × rate is the amount.

The base is the month's `BASIC_SALARY` line, so `payroll_lines` has no
`contribution_base` column: one column cannot carry a base per contribution
type, and basic salary is the only line any base rests on yet. GSIS takes the
version's member and government rates of it. Employees' Compensation takes the
employer rate of the monthly salary credit, the basic salary up to the
version's ceiling. Each reads the one version of its kind that the rule
snapshot froze for every date of the month. Neither kind is required to
freeze a snapshot, so every case the recorded rules do not settle is a
blocking exception on the Employee and no line: no version in effect on every
date, a version that changes inside the month, service for only part of the
month, a GSIS base above the AMC limit, where RA 8291 sets another member
share (research open question 3), and a share that is not whole centavos.
With no basic salary line, neither writes anything, because basic salary's
own exception already blocks the Employee. A blocked result keeps no
contribution line, as it keeps no Payroll Line (section 7).

Personnel records no GSIS or Employees' Compensation coverage fact. RA No.
8291 covers compensated government employees irrespective of appointment
status; its exclusions are special-regime populations and contractuals
without an employer-employee relationship, both outside the Reference Agency
Profile (BRD PAY-001;
`research/reference-agency-personnel-compensation-boundaries.md`). So an
Employee with a Service Segment in the month is treated as covered, and one
without is not in the calculation. A recorded coverage fact, when Personnel
adds one, replaces this.

Loan lines use a separate table because multiple deductions may exist.

```sql
CREATE TABLE deduction_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  payee_category text NOT NULL
    CHECK (payee_category IN ('BIR','PHILHEALTH','GSIS','HDMF',
      'NATIONAL_GOVERNMENT_COA_DECISION','EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
      'EMPLOYEE_PROVIDENT_FUND','GOVERNMENT_FINANCIAL_INSTITUTION',
      'LICENSED_INSURER','THRIFT_OR_RURAL_BANK')),
  payee_name citext NOT NULL,
  issuer_reference citext NOT NULL,
  incurred_on date NOT NULL,
  outstanding_balance numeric(19,4) NOT NULL CHECK (outstanding_balance > 0),
  scheduled_amount numeric(19,4) NOT NULL CHECK (scheduled_amount > 0),
  authority_document_version_id uuid NOT NULL,
  payee_rule_version_id uuid NOT NULL
    REFERENCES national_payroll_rule_versions (id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('ACTIVE','SUPERSEDED','ENDED')),
  supersedes_obligation_id uuid UNIQUE,
  change_reason text,
  end_reason text,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  ended_by_membership_id uuid,
  ended_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((status = 'ENDED') = (effective_to IS NOT NULL)),
  CHECK ((supersedes_obligation_id IS NOT NULL) = (change_reason IS NOT NULL)),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, authority_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, supersedes_obligation_id)
    REFERENCES deduction_obligations (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, ended_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

A Deduction Obligation is an Employee's issuer-validated loan or deduction:
the payee, the issuer's reference, the date incurred, the outstanding balance
and scheduled amount the issuer validated, and the finalized Document Version
that authorizes them. Payroll never calculates interest or amortization (#27).
`incurred_on` gives the order incurred, by which obligations other than those
due the BIR, PhilHealth, GSIS, and HDMF are satisfied (GAA sec. 62). Applying
an obligation in calculation is #634.

The payee categories are those of FY 2026 GAA sec. 62: (a) the BIR,
PhilHealth, GSIS, and HDMF; (b) the National Government under a final and
executory COA decision; and (c) to (g) qualified employee cooperatives and
savings, loan, and mutual-benefit associations, employee provident funds,
authorized government financial institutions and depository banks, licensed
insurers, and BSP-accredited thrift and rural banks
([R6](../../research/salary-overpayment-recovery-authorities.md);
`research/official-personnel-compensation-boundaries.md` §6). Recording or
changing an obligation needs the `AUTHORIZED_DEDUCTIONS` version in effect on
its `effective_from` to allow the category, and stores that version as
`payee_rule_version_id`. With no version in effect, no payee is accepted.

A change never edits a row. It marks the active row `SUPERSEDED` and inserts a
successor that names it, keeps its Employee, payee, issuer reference, and date
incurred, and does not start earlier. A deferred trigger refuses a
`SUPERSEDED` row without its successor at commit. Ending sets `effective_to`,
`end_reason`, and who ended it. A superseded or ended row does not change, and
no row is deleted. A partial unique index allows one `ACTIVE` row per Employee,
payee category, payee name, and issuer reference. Record, change, and end need
`payroll.deductions.manage` held Agency-wide and write an Audit Event.

---

## 10. Exceptions and Adjustments

```sql
CREATE TABLE payroll_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  calculation_version integer NOT NULL,
  employee_id uuid,
  exception_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('WARNING','BLOCKING')),
  status text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  details jsonb NOT NULL,
  reason text,
  resolved_by_membership_id uuid,
  CHECK (status <> 'ACKNOWLEDGED'
         OR (severity = 'WARNING' AND btrim(reason) <> '')),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, resolved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

There is no `WAIVED` status: no blocking exception can be waived, and only a
warning can be acknowledged, with a reason (#27, #328). An exception names the
Employee, not a result, because a blocked or held Employee may have none.

Migration 0162 creates `payroll_exceptions` (#621). The calculation writes
them, `OPEN`, with the cause in `details.message`; `reason` stays for an
acknowledgement or resolution. A trigger admits one only while its period is
`CALCULATING` at its version and rejects every `DELETE`.

After storing the lines, the calculation runs its checks (#623) in the same
transaction and writes what they raise, so a blocking one returns the period
to `DRAFT` and a warning alone does not:

| `exception_type`         | Severity | Raised for                                                                                                             |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NET_PAY_NEGATIVE`       | BLOCKING | A result whose `net_amount` is below zero (the developer's ruling)                                                     |
| `BASIC_SALARY_MISSING`   | BLOCKING | A `CALCULATED` result of a regular period with no `BASIC_SALARY` earning line                                          |
| `PAYROLL_LINE_DUPLICATE` | BLOCKING | Two lines of one result with equal component, line type, rule version, quantity, rate, amount, and `source_snapshot`   |
| `NET_PAY_VARIANCE`       | WARNING  | A `CALCULATED` result of a regular period whose net differs from the Employee's in the last `FINALIZED` regular period |

Variance has no threshold (the developer's ruling). With no `FINALIZED`
regular period before this one, or no result for the Employee in it, nothing
is compared. A check's exception leaves the result's `status` and lines as
calculated, and is not part of its `calculation_hash`.

Migration 0167 adds the acknowledge and resolve commands. `hris_app` may
update only `status`, `reason`, and `resolved_by_membership_id`, under an
Agency policy, and a trigger allows one decision, from `OPEN`, on the
period's current calculation version, with the period row locked `FOR SHARE`:
`ACKNOWLEDGED` (a warning) while the period is `DRAFT` or `FOR_REVIEW`, and
`RESOLVED` while it is `DRAFT`. A resolution lifts nothing: the next
calculation checks the cause again. A CHECK requires a decided exception to
carry a reason and the deciding membership, and an `OPEN` one neither.

```sql
CREATE TABLE payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  original_payroll_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','POSTED','CANCELLED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  posted_by_payroll_period_id uuid,
  posted_at timestamptz,
  cancelled_at timestamptz,
  CHECK ((status = 'POSTED') = (posted_by_payroll_period_id IS NOT NULL)),
  CHECK ((status = 'POSTED') = (posted_at IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  FOREIGN KEY (agency_id, original_payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, posted_by_payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX payroll_adjustments_one_open_key
  ON payroll_adjustments (original_payroll_period_id, employee_id)
  WHERE status = 'OPEN';

CREATE TABLE payroll_adjustment_causes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_adjustment_id uuid NOT NULL,
  origin text NOT NULL
    CHECK (origin IN ('SOURCE_CORRECTION','PAYROLL_HOLD','RECALCULATION')),
  payroll_input_id uuid,
  source_correction_key citext,
  payroll_hold_id uuid,
  reason text,
  opened_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((origin = 'SOURCE_CORRECTION')
         = (payroll_input_id IS NOT NULL AND source_correction_key IS NOT NULL)),
  CHECK ((origin = 'PAYROLL_HOLD') = (payroll_hold_id IS NOT NULL)),
  CHECK ((origin = 'RECALCULATION')
         = (opened_by_membership_id IS NOT NULL AND btrim(reason) <> '')),
  FOREIGN KEY (agency_id, payroll_adjustment_id)
    REFERENCES payroll_adjustments (agency_id, id),
  FOREIGN KEY (agency_id, payroll_input_id)
    REFERENCES payroll_inputs (agency_id, id),
  FOREIGN KEY (agency_id, payroll_hold_id)
    REFERENCES payroll_holds (agency_id, id),
  FOREIGN KEY (agency_id, opened_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, source_correction_key)
);
```

A Payroll Adjustment is Payroll's recalculation of one Employee's result for
one past Payroll Period (#330,
[ADR 0016](../../adr/0016-payroll-corrections-are-recalculated-differences.md)).
It holds no amount and no type, and it replaces the four-value
`adjustment_type`.

An Employee and past period have at most one `OPEN` adjustment, and a later
cause joins it, so a difference is never counted twice. It names the period and
the Employee, not a result, because a held Employee has none. A cause is
written in one of three ways:

- `SOURCE_CORRECTION`: by Payroll, when a source module withdraws an input a
  finalized payroll consumed. The unique correction key makes a retry return
  the same adjustment;
- `PAYROLL_HOLD`: by Payroll, in the finalization transaction of a period with
  an active hold;
- `RECALCULATION`: by a user with `payroll.inputs.adjust`, with a reason, for
  one finalized period and one Employee or all of its Employees. Payroll never
  opens one on its own.

Each calculation of the carrying period recalculates the Employee's result for
the original period from the rules and facts on record for its dates, less any
input a cause withdrew. It writes the difference against the original result
plus every `POSTED` adjustment for the same Employee and period, as
`payroll_lines` with `payroll_adjustment_id` in the carrying period's result.
The next regular period carries every open adjustment, and a special period
with `carries_adjustments` carries only those whose difference is positive.
The carrying period's finalization marks them `POSTED`. There is no separate
approval.

A negative adjustment stays `OPEN`, and no period carries it, until #648
builds the recovery rules #661 recorded
([authorities](../../research/salary-overpayment-recovery-authorities.md)). A
period deducts one only under a final and executory COA decision, for the
whole amount or the monthly amount COA approved, after statutory deductions
and never below the net-take-home floor. These tables do not yet hold that
decision, an approved monthly amount, or an adjustment settled across more
than one period. #648 adds them. Voiding the original period cancels its open
adjustments, and voiding a period that carried one returns it to `OPEN`.

---

## 11. Finalization Transaction

The database transaction must:

1. lock the payroll period;
2. verify status `APPROVED`;
3. verify `row_version` and approved calculation hash;
4. reject unresolved blocking exceptions;
5. verify totals against line sums;
6. verify every source the approved version used is still unconsumed, and fail
   with a blocking exception if another payroll consumed one first;
7. mark the approved version's employee results finalized;
8. mark payroll period finalized;
9. mark its Payroll Inputs and `ONCE` Authorized Payroll Component Inputs
   consumed, and insert `payroll_consumed_attendance_facts`;
10. mark the Payroll Adjustments it carried `POSTED`, and open one for each
    Employee under an active Payroll Hold;
11. append audit/outbox records;
12. commit before generating documents or emails.

---

## 12. Outputs

Create metadata tables for:

- payslips;
- payroll registers;
- remittance schedules;
- Payment Exports, their Payment Instructions, and Disbursement Outcomes (#28);
- the Certified Payroll Review Export and the Finalized Payroll Accounting
  Support Export (#29).

A Payment Export is an immutable, checksummed snapshot with no status of its
own. Generating it marks no one paid; the Cashier records each Payment
Instruction's Disbursement Outcome separately (#28). The two #29 exports are
Structured Exports that assert no external validation, obligation, or posting.
`docs/data-model/payroll-logical-erd.md` lists the columns and rules.

```sql
CREATE TABLE payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_employee_id uuid NOT NULL,
  document_id uuid,
  status text NOT NULL
    CHECK (status IN ('GENERATING','READY','RELEASED','WITHHELD','SUPERSEDED')),
  released_at timestamptz,
  released_by_membership_id uuid,
  withheld_at timestamptz,
  withheld_by_membership_id uuid,
  withhold_reason text,
  CHECK ((released_at IS NULL) = (released_by_membership_id IS NULL)),
  CHECK ((withheld_at IS NULL) = (withheld_by_membership_id IS NULL)),
  CHECK (withheld_at IS NULL OR btrim(withhold_reason) <> ''),
  CHECK (status <> 'RELEASED' OR released_at IS NOT NULL),
  CHECK (status <> 'WITHHELD' OR withheld_at IS NOT NULL),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  FOREIGN KEY (agency_id, released_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, withheld_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (payroll_employee_id)
);
```

A Payslip is the statement of one finalized Payroll Employee Result, one per
result, with no version number (#330). The Payroll Approver releases every
`READY` Payslip of a finalized period with one command, and may withhold a
`READY` one with a reason. Withholding never stops payment. The void
transaction supersedes a payroll's Payslips from any status, and nothing else
does. An Employee reads only their own `RELEASED` Payslips.

A Budget Officer and an Accounting Reviewer each record one immutable Payroll
Export Checkpoint Review against the current Certified Payroll Review Export,
in either order. Approval needs both confirmed. A returned review moves the
period to `FOR_REVIEW` and revokes the certification, the export, and the other
review (#29, #330). Its table is specified with the export in #636 and #637.

Files are stored through the shared document service.

---

## 13. RLS and Sensitive Access

RLS isolates agencies on every Agency-owned table. The three platform-wide
tables in sections 1 and 2 have no Agency policy: their protection is the
grant, `SELECT` only for `hris_app` (ADR 0013).

Application permissions separately control:

- compensation access;
- payroll preparation;
- Deduction Obligations;
- certification;
- the funding and accounting checkpoint reviews;
- approval;
- finalization;
- void request and void approval;
- Payslip release, withholding, and self-service;
- Payment Exports;
- Disbursement Outcomes.

A permission is not enough on its own: `payroll_period_actors` keeps each
person to one payroll function on a Payroll Period (section 5).
