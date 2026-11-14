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
    CHECK (rule_kind IN ('SALARY_SCHEDULE')),
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
are rows.

A trigger rejects every `UPDATE` and `DELETE` on both tables. A version is
immutable from load, so there is no status column and no draft. A correction or
a new issuance is a new row that names the version it supersedes.

The version in effect on a date is the one whose effectivity covers the date
and that no successor has replaced from that date. The load refuses a version
that would leave two versions of one kind in effect on the same date. A
superseded row keeps its own dates, so this is checked by the load, not by an
exclusion constraint.

There is no derived-rate column. The salary calculator derives the daily rate
as the monthly rate ÷ 22, the 22-working-day divisor of RA No. 6758, sec. 7. It
does not prorate a partial month of a monthly-paid Employee: no rule is
recorded for that case, and it blocks until an authority is found
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
  value numeric(19,8) NOT NULL,
  payment_schedule text NOT NULL
    CHECK (payment_schedule IN ('ONCE','EACH_REGULAR_PERIOD')),
  authority_document_version_id uuid NOT NULL,
  source_reference text NOT NULL,
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
  CHECK ((status = 'APPROVED') = (approved_at IS NOT NULL)),
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
```

Applicability records for one component and one scope target must not overlap:
add an exclusion constraint over `(agency_id, pay_component_id, employee_id,
daterange)`. A trigger requires the component to be conditional and, for a
GAA-revalidated component, an `effective_to` no later than 31 December of the
year of `effective_from`. After insert, only `effective_to` may move, and only
earlier.

A trigger requires an authorized input's component to accept one. An approved
input changes only by an earlier `effective_to` or by its `ONCE` consumption.
National ceilings, such as the 20% night-shift rate, are checked by the service
that records the input (#43).

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
  CHECK ((input_kind = 'MONETIZATION_EARNING') = (amount IS NOT NULL)),
  CHECK ((input_kind = 'OVERTIME_HOURS') = (source_module = 'OVERTIME')),
  CHECK ((status = 'CONSUMED') = (consumed_by_payroll_period_id IS NOT NULL)),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, consumed_by_payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, replaces_payroll_input_id)
    REFERENCES payroll_inputs (agency_id, id),
  UNIQUE (agency_id, source_module, source_key),
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
only the status change and `consumed_by_payroll_period_id`, which the
finalization transaction sets. Consumed inputs are immutable, apart from the
return to `PENDING` when their payroll is voided.

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

For a Leave Monetization input, Payroll resolves the authoritative salary source
and computes `amount`; Leave may not supply either as an unrestricted value. The
immutable `payload_snapshot` must bind the exact Monetization Posting, approved
per-account credit quantities, stable effect key, valuation date, fixed
calculator and authority-bound factor, policy and authority Document Versions,
funding determination, Approval Decisions, resolved salary source and value,
calculation steps, and evidence-backed rounding rule and result. The live
`payroll_monetization_earning_inputs` table folds into this one in #339.

For leave without pay, `payload_snapshot` holds the day quantity for each Work
Date of the allocation line. Payroll values each calendar month's days at the
monthly salary in effect on those Work Dates, ÷ 22 (CSC MC No. 8, s. 2014;
#328).

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

A special period carries Payroll Adjustments only with `carries_adjustments`.
The trigger accepts that in place of a named component. A regular period
always carries them (section 10).

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
lists every rule version in effect on any date of the period, plus the
applicability and authorized-input records used. Items are references, not
copies. Snapshots and their items are immutable.

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

Loan lines use a separate table because multiple deductions may exist.

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

A negative adjustment stays `OPEN`, and no period carries it, until #661
records how an Agency may recover an overpayment. Voiding the original period
cancels its open adjustments, and voiding a period that carried one returns it
to `OPEN`.

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
