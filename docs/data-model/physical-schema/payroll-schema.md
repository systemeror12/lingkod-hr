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
only, and the `hris_operator` load command is the only writer.
`payroll_export_contract_versions` (section 12) is platform-wide the same way,
written only by migration. Every other table here is Agency-owned and
isolated by RLS.

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
                         'YEAR_END_BONUS_AND_CASH_GIFT','PERA','COMMUTABLE_RATA',
                         'OVERTIME_PAY',
                         'CLOTHING_ALLOWANCE',
                         'PHILHEALTH_CONTRIBUTION','PAGIBIG_CONTRIBUTION',
                         'NIGHT_SHIFT_DIFFERENTIAL',
                         'COMPENSATION_WITHHOLDING_TAX','DE_MINIMIS_BENEFITS')),
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
from the categories that section names, the `priorityPayeeCategories` whose
obligations are satisfied first, in order, and `monthlyNetTakeHomeFloor`
(section 9). `GSIS_CONTRIBUTION`
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
`grantsSeparatedBeforeAsOf` (section 8). `PERA` is one fiscal year's PERA rule
(FY 2026 GAA sec. 63; DBM BC No. 2009-3 as amended); its parameters are
`monthlyAmount` and the circular's `dailyAmount` (section 8).
`COMMUTABLE_RATA` is one fiscal year's commutable RATA rule (FY 2026 GAA
sec. 71; DBM NBC No. 593); its parameters are `ranks`, each with its `rank`,
the eligible `positionTitles`, and the monthly `representationAllowance` and
`transportationAllowance`, and `actualWorkSchedule`, NBC 593's bands of
`minimumDays` and `share`, rising to a share of 1 (section 8).
`OVERTIME_PAY` is the Overtime Pay rule of CSC-DBM JC No. 2, s. 2015, which
no GAA restates; its parameters are `workingDaysPerMonth` and
`workHoursPerDay`, the hourly rate's divisors (item 9.3), `workdayPremium` and
`nonWorkdayPremium` (item 9.4), `nonWorkdayPaidHoursLimit` (item 10.5), and
`employeeAnnualCapShare` and `agencyAnnualCapShare` (items 10.6 and 10.7)
(section 8).
`CLOTHING_ALLOWANCE` is one fiscal year's cash uniform/clothing allowance rule
(FY 2026 GAA sec. 64; DBM BC No. 2024-1); its parameters are the
`annualAmount` for full-time service and the `minimumServiceDays` of service
in the fiscal year, 180 for six months (section 8).
`PHILHEALTH_CONTRIBUTION` (RA No. 11223, sec. 10; PhilHealth Circular No.
2020-0005, Rev. 1) holds `employeeRate`, `employerRate`, `monthlyIncomeFloor`,
and `monthlyIncomeCeiling`, with the floor below the ceiling.
`PAGIBIG_CONTRIBUTION` (RA No. 9679, sec. 7) holds `employeeRate`,
`lowerBandEmployeeRate` for an Employee earning not more than
`lowerBandMonthlyCompensation`, `employerRate`, and `maximumFundSalary`.
Neither is established for 2027
([R19, R21](../../research/national-payroll-rule-versions-2027.md)), so
neither is loaded until its issuance is read (section 9).
`NIGHT_SHIFT_DIFFERENTIAL` is RA No. 11701, sec. 1, which has no expiry and
whose funding alone rests on the GAA
([R12](../../research/national-payroll-rule-versions-2027.md)); its parameters
are `rateCeiling`, the highest share of the hourly basic rate the agency head
may set, and `workingDaysPerMonth` and `workHoursPerDay`, the hourly basic
rate's divisors. It carries no default rate (sections 3 and 8).
`COMPENSATION_WITHHOLDING_TAX` (BIR RR No. 11-2018, sec. 2.79 and Annex E;
[R24](../../research/national-payroll-rule-versions-2027.md)) holds
`monthlyTable`, Annex E's monthly table, which a regular period of one month
takes: brackets of `compensationLevel`, `baseTax`, and
`rateOverCompensationLevel`. The first bracket starts at 0, levels rise, and
each base tax is what the bracket before it reaches at its level, so the
table is continuous. It may hold `annualTable`, the schedule of sec.
2.79(B)(5)(b) step 3 in the same shape, which the year-end adjustment takes
(#633); a version without it blocks that adjustment. It also holds
`thirteenthMonthAndOtherBenefitsExclusion`,
the most 13th-month pay and other benefits paid in a tax year that is
excluded from tax, ₱90,000 under RR No. 11-2018 sec. 2.78.1(B)(11)
([R26](../../research/national-payroll-rule-versions-2027.md)). `DE_MINIMIS_BENEFITS` (RR No. 2-98 sec. 2.78.1(A)(3), as
amended by RR No. 29-2025; [R25](../../research/national-payroll-rule-versions-2027.md))
holds `benefits`, each a `benefit` a calculator pays, `MONETIZED_LEAVE_CREDITS`,
`UNIFORM_AND_CLOTHING`, or `CHRISTMAS_GIFT`, with its `annualCeiling`, null
where the regulation sets none (section 9).

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

A cash uniform/clothing allowance grant is an applicability record of the
`CLOTHING_ALLOWANCE` component for the whole Agency or one named Employee,
whose authority is the Agency's internal guideline on the grant's form,
qualification, and payment schedule (BC No. 2024-1 item 12.1; #631). Migration
0171 adds it to the catalogue as a conditional, GAA-revalidated `EARNING`. An
Agency that procures uniforms records none.

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

National ceilings are checked by the service that records the input (#43). No
National Payroll Rule Version kind carries the RATA ceiling yet, so the service
refuses every reimbursable RATA input (catalogue code `REIMBURSABLE_RATA`)
until one is loaded.

Migration 0177 adds `NIGHT_SHIFT_DIFFERENTIAL` to the catalogue (#627): an
`EARNING` that is not conditional, since its input carries its own authority
and population (#328 decision 23), not GAA-revalidated, and the first
component that accepts an authorized input. Its input is the agency head's
rate: value kind `RATE`, a share such as `0.10` for 10%, paid
`EACH_REGULAR_PERIOD`; the service refuses any other kind or schedule. The
rate may not exceed the `rateCeiling` of any `NIGHT_SHIFT_DIFFERENTIAL` version
in effect during the input's effective period, 20% under RA No. 11701, sec. 1;
with no such version in effect the service refuses the input, since its
ceiling cannot be checked. There is no default rate.

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

An input belongs to no period when accepted. Acceptance holds the Agency's
payroll input acceptance lock in shared mode, which a calculation start takes
exclusively (section 5), and stamps `accepted_at` from the clock while holding
it, not from its transaction's start. An input therefore commits before a
start fixes its cutoff, or is accepted after that cutoff, and every
calculation version at one cutoff takes the same inputs (ADR 0014). A
withdrawal takes the same shared lock before it locks the open periods. After
acceptance a trigger allows
only the status change, `consumed_by_payroll_period_id`, which the
finalization transaction sets, and `source_correction_key`, which a withdrawal
sets. Consumed inputs are immutable, apart from the
return to `PENDING` when their payroll is voided. Migration 0184 admits
`CONSUMED` only in the transaction that finalizes the period it names. The migration that creates
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

`withdrawInTransaction` builds the first case (#357) and the second (#649).
It writes the correction key with the cancellation, so a retry with the key
answers `ALREADY_WITHDRAWN`, the key cannot withdraw another input, and
another key cannot withdraw a cancelled one. Inputs cancelled before migration
0166 have no key. Per ADR 0014, a live calculation uses the input when a
period past `DRAFT` has a `cutoff_at` at or after its `accepted_at`. No
recorded rule maps an input kind to a special period's components, so a live
special period counts too. The withdrawal locks the Agency's open periods
`FOR SHARE`, so a calculation cannot start, and no period can change status,
until it commits; a running calculation is waited out, and the withdrawal
marks what it committed. A cancelled input stays readable with its key.

In the second case the withdrawal answers `WITHDRAWN`, and in the same
transaction writes a `PAYROLL_INPUT_WITHDRAWN` blocking exception on the
current calculation version of each live period (section 10). The input's
payload is never edited, and no correction record links to it: the next
calculation version reads only `PENDING` inputs. Until #650 builds the third
case, Payroll refuses it as `RETRYABLE_FAILURE` with
`PAYROLL_INPUT_CONSUMED_CORRECTION_UNAVAILABLE`, and changes nothing.

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
  finalized_by_membership_id uuid,
  void_requested_by_membership_id uuid,
  void_requested_at timestamptz,
  void_reason text,
  void_document_version_id uuid,
  voided_by_membership_id uuid,
  voided_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (period_to >= period_from),
  CHECK (NOT carries_adjustments OR run_type = 'SPECIAL'),
  CHECK (finalized_by_membership_id IS NULL OR finalized_at IS NOT NULL),
  CHECK ((void_requested_at IS NULL) = (void_requested_by_membership_id IS NULL)),
  CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CHECK (status <> 'VOIDED'
         OR (voided_by_membership_id IS NOT NULL AND btrim(void_reason) <> '')),
  CHECK (void_requested_by_membership_id IS NULL
         OR void_requested_by_membership_id <> voided_by_membership_id),
  FOREIGN KEY (agency_id, finalized_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
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
Payroll Preparer's `PREPARATION` function (#621). It first takes the Agency's
payroll input acceptance lock exclusively, so Payroll Inputs being accepted
commit first (section 4). In one transaction it moves
the period from `DRAFT` to `CALCULATING`, advances `calculation_version`, and
freezes that version's rule snapshot (section 6); a missing required rule
refuses the start and changes nothing. A special period is refused unless it
names a component and a calculator exists for each one it names; it runs only
those calculators. A second start at the same
`row_version` finds the period moved and is refused.

A recalculation is the same start from `DRAFT`, after the calculation or a
reviewer returned the period (#624). It takes the next version and a fresh
snapshot, so it uses every rule version loaded since, and every earlier
version's results, lines, exceptions, and snapshot stay readable and
unchanged. From `FOR_REVIEW` onward the start is refused with what must come
first: a return for correction, a revoked certification, or a return before
finalization. A certified or approved version stands, and a `FINALIZED` period
is corrected only by a Payroll Adjustment (#328).

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
always carries them (section 10). The create command sets it only on a special
period, which may then name no component, and refuses it on a regular one
with `PAYROLL_PERIOD_REGULAR_CARRIES_ADJUSTMENTS` (#356). Starting such a
period's calculation needs no named component.

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

```sql
CREATE TABLE payroll_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  calculation_version integer NOT NULL CHECK (calculation_version > 0),
  calculation_hash text NOT NULL CHECK (calculation_hash ~ '^[0-9a-f]{64}$'),
  certified_by_membership_id uuid NOT NULL,
  certified_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_membership_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  approved_by_membership_id uuid,
  approved_at timestamptz,
  CHECK ((approved_at IS NULL) = (approved_by_membership_id IS NULL)),
  CHECK (
    (revoked_at IS NULL AND revoked_by_membership_id IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_membership_id IS NOT NULL
        AND btrim(revocation_reason) <> '')
  ),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, revoked_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX payroll_certifications_one_current_key
  ON payroll_certifications (payroll_period_id)
  WHERE revoked_at IS NULL;
```

A Payroll Certification records that the HR Certifier certified one
calculation version and its calculation hash (#334). The certification's
`calculation_hash` is the SHA-256 of the canonical JSON of that version's
Payroll Employee Results, each as its `employee_id` and `calculation_hash`, in
Employee order. The certify command takes the version and hash the certifier
reviewed and refuses either when it is no longer the period's, and refuses
while the version has an open blocking exception.

A period has at most one certification in force. Revoking it records the
actor, time, and reason on the row, once; a trigger admits a row only while
its period is `FOR_REVIEW` at the version it names, unapproved and unrevoked.
An `UPDATE` may set the approval columns once, while the row is in force and
its period is `CERTIFIED` at that version, and the revocation columns once; a
revoked row never changes again, and every `DELETE` is rejected. Migration
0168 creates the table, and migration 0193 adds the approval columns. The
Certified Payroll Review Export (#636) binds the certification in force, and
revoking it supersedes that export and revokes its checkpoint reviews.

The Payroll Approver approves a `CERTIFIED` period (#638) with
`payroll.periods.approve`, at the `row_version` they read. Approval is refused
unless the Budget and Accounting checkpoint reviews are both confirmed on the
current export (section 12), with `PAYROLL_CHECKPOINT_REVIEWS_UNCONFIRMED`,
and while the version has an open blocking exception. In the same transaction
it sets `approved_by_membership_id` and `approved_at` on the certification in
force, which already binds the approved version and hash (#639). An
`APPROVED` period cannot be certified, reviewed, or recalculated, so the
version stays locked until finalization or a return. The
`PAYROLL_PERIOD_APPROVED` Audit Event names the certification, version, hash,
export and its checksum, and the two reviews.

Return before finalization (`APPROVED → FOR_REVIEW`) needs
`payroll.periods.return_approved` and a reason. In one transaction it revokes
the certification in force with the approver as the revoker and that reason,
supersedes the export, and so revokes its reviews. The revoked certification
keeps its approval as history. The
`PAYROLL_PERIOD_RETURNED_BEFORE_FINALIZATION` Audit Event names what it
revoked. Both commands claim `APPROVAL`. Migration 0183 adds the two
permissions and grants them to the Payroll Approver, Agency-wide. The
Accounting Reviewer's configurable grant of `payroll.periods.approve` is not
seeded.

Finalization (`APPROVED → FINALIZED`, #335) needs `payroll.periods.finalize`,
takes the `row_version` the approver read, claims `APPROVAL`, and runs section
11 in one transaction. It sets `finalized_at` and `finalized_by_membership_id`
(#639), which a trigger requires together on that move and keeps fixed on
every other update. Every refusal rolls the
transaction back, so the period stays `APPROVED` with nothing finalized:

| Code                                | Refused when                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `PAYROLL_PERIOD_NOT_APPROVED`       | The period is not `APPROVED`                                                                     |
| `PAYROLL_PERIOD_STALE`              | The `row_version` is not the period's                                                            |
| `PAYROLL_PERIOD_BLOCKING_EXCEPTION` | The version has an open blocking exception                                                       |
| `PAYROLL_CALCULATION_HASH_CHANGED`  | The version's results no longer hash to the certification in force                               |
| `PAYROLL_TOTALS_UNRECONCILED`       | A result's totals differ from its line sums                                                      |
| `PAYROLL_FUNCTION_CONFLICT`         | The person holds another payroll function on the period                                          |
| `PAYROLL_SOURCE_CONSUMED`           | A Payroll Input a line rests on is no longer `PENDING`, or another payroll consumed a fact first |

A retry by the person who finalized, at the `row_version` they sent, returns
the finalized period and writes nothing. Anyone else then finds the period
`FINALIZED` and is refused, so of two concurrent finalizations one is refused.
The `PAYROLL_PERIOD_FINALIZED` Audit Event names the certification, version,
hash, result count, and the consumed inputs and facts, under the idempotency
key `finalized`. Migration 0184 adds the permission and grants it to the
Payroll Approver, Agency-wide.

The period read (`payroll.periods.read`) names each review step's actor and
time: the certifier, the Budget and Accounting checkpoint reviewers, the
approver, and the finalizer, each by membership and display name (#639). No
record holds who started a calculation, so the read names no calculator.

Migration 0193 backfills the approver and finalizer of existing rows from their
`PAYROLL_PERIOD_APPROVED` and `PAYROLL_PERIOD_FINALIZED` Audit Events. A
finalized period with no such event keeps a null finalizer, so the table CHECK
only requires a time beside a finalizer; the trigger requires both on every
finalization.

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
  payroll_adjustment_id uuid,
  CHECK (num_nonnulls(national_payroll_rule_version_id,
                      agency_payroll_applicability_id,
                      authorized_payroll_component_input_id,
                      payroll_adjustment_id) = 1),
  FOREIGN KEY (agency_id, payroll_rule_snapshot_id)
    REFERENCES payroll_rule_snapshots (agency_id, id),
  FOREIGN KEY (agency_id, agency_payroll_applicability_id)
    REFERENCES agency_payroll_applicabilities (agency_id, id),
  FOREIGN KEY (agency_id, authorized_payroll_component_input_id)
    REFERENCES authorized_payroll_component_inputs (agency_id, id),
  FOREIGN KEY (agency_id, payroll_adjustment_id)
    REFERENCES payroll_adjustments (agency_id, id),
  UNIQUE (payroll_rule_snapshot_id, national_payroll_rule_version_id),
  UNIQUE (payroll_rule_snapshot_id, agency_payroll_applicability_id),
  UNIQUE (payroll_rule_snapshot_id, authorized_payroll_component_input_id),
  UNIQUE (payroll_rule_snapshot_id, payroll_adjustment_id)
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

A snapshot and a National Payroll Rule Version load serialize on one advisory
lock, which the snapshot holds shared and the load exclusively (migration
0170, #624). A snapshot frozen first is on a period the load then marks
(section 10); one frozen after references the loaded version.

Migration 0157 adds `authorized_payroll_component_input_id` with its foreign
key and UNIQUE, and replaces `payroll_rule_snapshot_items_one_source_check`
with one that counts it beside `national_payroll_rule_version_id` (#346).
Migration 0159 adds `agency_payroll_applicability_id` with its foreign key and
UNIQUE, and replaces the CHECK again (#618). The snapshot references every
applicability record of the Agency whose effective period overlaps the period.

Migration 0190 adds `payroll_adjustment_id` with its foreign key and UNIQUE,
and replaces the CHECK again (#356). The snapshot of a regular period, and of
a special period with `carries_adjustments`, names every `OPEN` Payroll
Adjustment of the Agency, which that calculation version carries, and
references the rule versions, Authorized Payroll Component Inputs, and
applicability records in effect on each original period's dates. None of
them is required, since the original period was calculated with them, and
the carrying period's own dates keep the required-kind check. An adjustment
opened after the snapshot is carried by the next calculation.

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

Migration 0162 creates `payroll_employees` (#621). Migration 0190 creates
`payroll_holds` (#356), because a `PAYROLL_HOLD` adjustment cause references
it. Its trigger admits a hold only while its period is `DRAFT`, resting on a
`BLOCKING` exception of that period naming its Employee, lets an `UPDATE`
only lift it, once, in `DRAFT`, and rejects every `DELETE`. The place and
lift command is not built yet, so `hris_app` holds only `SELECT`. The
calculation writes no result for an Employee under an active hold. The calculation writes one result for each Employee
with a Service Segment on any date of the period: `CALCULATED` with its lines,
or `EXCEPTION` with a blocking exception, the frozen basis, zero totals, and no
line. A check's blocking exception (§10) names the Employee and leaves the
result `CALCULATED`. A trigger admits a result only while its period is
`CALCULATING` at the result's version, rejects every `DELETE`, and lets an `UPDATE` change only
`status`. `calculation_hash` is the SHA-256 of the canonical JSON of what the
calculation decided: the Employee, the period dates, the compensation basis,
the lines, the exceptions, and the totals. Row ids, times, and the version are
left out, so the same snapshot and inputs reproduce it.

Finalization marks every result of the approved version `FINALIZED` (#335).
Migration 0184 grants `hris_app` `UPDATE ("status")` under an Agency policy.
Its trigger admits one status change, to `FINALIZED`, and only in the
transaction that finalizes the result's period at the result's version, so a
`FINALIZED` or `VOIDED` result never changes. The void command admits
`FINALIZED → VOIDED` when it arrives.

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
`payroll_adjustment_id` with Payroll Adjustments (#330), in migration 0190
(#356). Its insert guard then also requires the adjustment to be `OPEN`, of
the result's Employee, and named by the result's version's snapshot. An
adjustment line rests on no `payroll_line_sources` row: the original period
consumed its sources. There is no
`taxable_amount`: each line records its tax treatment in
`source_snapshot.taxTreatment`, and the Tax Line holds the result's taxable and
non-taxable compensation (section 9).

Migration 0164 creates `payroll_line_sources` and
`payroll_consumed_attendance_facts` (#341). A source joins its line only in the
transaction that wrote the line, and every `UPDATE` and `DELETE` is rejected.
`hris_app` holds `SELECT` on `payroll_consumed_attendance_facts`. Migration
0184 grants `INSERT` under an Agency policy to finalization, its only writer:
a trigger admits a row only in the transaction that finalizes the period it
names, and rejects every `UPDATE` and `DELETE`. The void command grants the
`UPDATE` that sets `released_at` when it arrives.

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

The `LEAVE_MONETIZATION` component, which migration 0171 adds to the
catalogue as an unconditional `EARNING` that is not GAA-revalidated (#626),
pays each `MONETIZATION_EARNING` input the calculation takes as one `EARNING`
line in a regular period: the input's frozen `amount`, its credits in
`quantity`, no `rate`, since the rounded amount is not credits × a rate, and no
`rule_version_id`, since the valuation and its authority are in the input's
`payload_snapshot`, which `source_snapshot.valuation` copies. The line rests on
the input in `payroll_line_sources`. `source_snapshot.taxTreatment` is
`DE_MINIMIS` with `deMinimisBenefit` `MONETIZED_LEAVE_CREDITS` (BIR RR No.
29-2025 sec. 2.78.1(A)(3)(b); [authorities](../../research/native-payroll-component-authorities.md)).
The input stays `PENDING`, so every calculation version until finalization
pays it again (#335).

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
(#351), and the cash gift `DE_MINIMIS`, with `deMinimisBenefit`
`CHRISTMAS_GIFT`. Every case no recorded rule settles
blocks the component and writes no line: no version with the period's window,
service months that turn on leftover days or a month end, a reduced cash gift
under the minimum, a separated Employee where the version grants that case,
because no rule on record prorates the bonus and the record does not show a
separation from government service rather than a transfer, a part-time cash
gift, a casual daily wage bonus, an `INDETERMINATE` basis on October 31, and a
schedule the snapshot did not freeze.

The `PERA` component, which migration 0168 adds to the catalogue with the
`PERA` rule kind (#342), is unconditional, revalidated against each year's GAA,
and paid in a regular period after basic salary and salary for days without
pay ([authorities](../../research/pera-authorities.md)). It writes one
`EARNING` line with the PERA version as `rule_version_id`: the monthly amount
for a full month of full-time service; `22 − days without pay` days at the
daily amount when the period's month has days without pay, resting on the same
sources as that month's `DAYS_WITHOUT_PAY` line; or the monthly amount times
the employment fraction for part-time service. With no basic salary line, or
no day with basic pay, it writes nothing (BC No. 2009-3 item 5.1).
`source_snapshot.taxTreatment` is `NON_TAXABLE` (RR No. 11-2018
sec. 2.79(B)). It blocks and writes no line for no version in effect on every
date of the month or a version that changes inside it, a partial month, days
without pay dated in another month, part-time service with days without pay, a
casual daily wage, and an amount that is not whole centavos.

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

The `OVERTIME_PAY` component, which migration 0172 adds with the
`OVERTIME_PAY` rule kind (#628), pays each `OVERTIME_HOURS` input in a regular
period as one `EARNING` line resting on that input in `payroll_line_sources`
([authorities](../../research/overtime-coc-cto-authorities.md#overtime-pay-limits-for-347)).
`quantity` is the paid minutes, `rate` the monthly salary on the Work Date, and
the amount `minutes ÷ 60 × rate ÷ 22 ÷ 8 × premium`, from the version in effect
on the Work Date. The premium is 125% on a `WORKDAY` or `SPECIAL_WORKING` day
and 150% on a `REST_DAY`, `REGULAR_HOLIDAY`, `SPECIAL_NON_WORKING`, or
`LOCAL_HOLIDAY` day, as the research's day-type map has them. A non-workday
pays at most 12 hours; the circular compensates the rest through CTO, which
Payroll does not grant, so it is unpaid and the line's result gets an
`OVERTIME_PAY_NON_WORKDAY_HOURS_EXCEEDED` warning. `source_snapshot` records the
certified and paid minutes, the day classification, the authority, and
`taxTreatment` `SUPPLEMENTARY_COMPENSATION` (RR No. 11-2018 secs.
2.78.1(B)(13) and 2.79(A)-(B)). An input is paid once: only `PENDING` inputs
are read, each gives at most one line, and finalization consumes it. Every
case no recorded rule settles blocks and writes no line: no version in effect
on the Work Date, a payload that disagrees with its input, a `WORK_SUSPENSION`
or unmapped classification, an `INDETERMINATE` basis, part-time service, a
casual daily wage, and an amount that is not whole centavos. The annual caps
are checks (below).

The `NIGHT_SHIFT_DIFFERENTIAL` component, which migration 0177 adds with its
rule kind (#627), pays the `NIGHT_DUTY` Attendance Payroll Facts a regular
period takes by cutoff: worked scheduled-duty minutes between 18:00 and 06:00,
overtime excluded (#328 decision 8). A fact counts as its delta,
`corrected − prior`, and a fact a finalized payroll consumed is not read
again (ADR 0014). Each Work Date's rate is the approved `RATE` input of the
component the rule snapshot froze that is in effect on it, the Employee's own
before the Agency-wide one. The calculation writes one `EARNING` line per rate
input, rule version, and salary: `quantity` the night minutes, `rate` the
monthly salary on their Work Dates, and the amount
`minutes ÷ 60 × rate ÷ 22 ÷ 8 × night-shift rate`, from the version in effect
on each Work Date. The line rests in `payroll_line_sources` on its facts and on
its rate input, and `source_snapshot` records the Work Dates, the rate, its
scope and authority, and `taxTreatment` `SUPPLEMENTARY_COMPENSATION` (RR No.
11-2018 secs. 2.78.1(B)(13) and 2.79(A)-(B)). An Employee with no night-duty
fact gets no line and no exception. Every case no recorded rule settles blocks
and writes no line: no rate in effect on the Work Date, or two of one scope;
no version in effect, or a rate above its ceiling; an `INDETERMINATE` basis,
part-time service, or a casual daily wage, for which RA No. 11701 defines no
hourly basic rate; and an amount that is not whole centavos. Eligibility by
rank (Division Chief and below) is the agency head's to scope through the
input; Payroll holds no rank to check it against.

The `CLOTHING_ALLOWANCE` component, which migration 0173 adds with the
`CLOTHING_ALLOWANCE` rule kind (#631), pays the cash uniform/clothing
allowance in a special period that names it and covers one fiscal year,
January 1 to December 31 ([authorities](../../research/clothing-allowance-authorities.md)).
It pays only an Employee covered by a `CLOTHING_ALLOWANCE` applicability
record in effect on the period's payment date, the Employee's own preferred
over the Agency-wide one; with none, it writes nothing. An Employee whose
Service Segments cover at least `minimumServiceDays` calendar days of the
fiscal year, counting days still to come, gets one `EARNING` line:
`quantity` 1, or the employment fraction for part-time service, `rate` the
annual amount, the applicability record in `source_snapshot`, and
`source_snapshot.taxTreatment` `DE_MINIMIS`, with `deMinimisBenefit`
`UNIFORM_AND_CLOTHING` (RR No. 29-2025 sec. 2.78.1(A)(3)(e)). Under the minimum there is no line. Service that starts
after January 1 counts only under an `ORIGINAL` appointment, which Personnel
supplies. Every case no recorded rule settles blocks and writes no line: a
period that is not one fiscal year; no version in effect on every date of the
year, or one that changes in it; an entry after January 1 by transfer, or
under another appointment or none; a casual daily wage; a pay basis or
employment fraction that changes in the year, or none recorded; and an amount
that is not whole centavos.

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
  year_end_adjustment jsonb
    CHECK (year_end_adjustment IS NULL OR jsonb_typeof(year_end_adjustment) = 'object'),
  -- Only a year-end adjustment refunds.
  CHECK (withholding_tax >= 0 OR year_end_adjustment IS NOT NULL),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  UNIQUE (agency_id, payroll_employee_id)
);
```

Employees' Compensation is employer-only, and there is no `OTHER` contribution
type (#27, #328). A special period writes no contribution lines; it writes
a tax line, as a regular one does (#351).

Migration 0163 creates `contribution_lines` for `GSIS` and
`EMPLOYEES_COMPENSATION` (#348); migration 0174 adds `PHILHEALTH` and
`PAGIBIG` to its type check with their calculators (#632). A line joins its
result only in the transaction that writes the result, every `UPDATE` and `DELETE` is rejected,
and RLS is forced. Each share is also a Payroll Line, so the totals and the
payslip carry it: `GSIS_PERSONAL_SHARE` is a `DEDUCTION`, and
`GSIS_GOVERNMENT_SHARE` and `EMPLOYEES_COMPENSATION` are `EMPLOYER_SHARE`
lines, which never reduce pay. PhilHealth and Pag-IBIG write
`PHILHEALTH_EMPLOYEE_SHARE` and `PAGIBIG_EMPLOYEE_SHARE` as `DEDUCTION` and
`PHILHEALTH_EMPLOYER_SHARE` and `PAGIBIG_EMPLOYER_SHARE` as `EMPLOYER_SHARE`
lines. Each line's quantity is the base and its rate
the version's, so quantity × rate is the amount.

The base is the month's `BASIC_SALARY` line, so `payroll_lines` has no
`contribution_base` column: one column cannot carry a base per contribution
type, and basic salary is the only line any base rests on yet. GSIS takes the
version's member and government rates of it. Employees' Compensation takes the
employer rate of the monthly salary credit, the basic salary up to the
version's ceiling. PhilHealth takes the version's employee and employer rates
of the basic salary held between its income floor and ceiling; the basic
salary line is the Monthly Basic Salary, since days without pay are their own
deduction line (Circular 2020-0005 sec. IV.F). Pag-IBIG takes them of the fund
salary, the basic salary up to the version's Maximum Fund Salary, with the
lower band's employee rate when the basic salary is not more than the band.
Each reads the one version of its kind that the rule
snapshot froze for every date of the month. No contribution kind is required
to freeze a snapshot, so every case the recorded rules do not settle is a
blocking exception on the Employee and no line: no version in effect on every
date, a version that changes inside the month, service for only part of the
month, a GSIS base above the AMC limit, where RA 8291 sets another member
share (research open question 3), and a share that is not whole centavos.
With no basic salary line, none writes anything, because basic salary's
own exception already blocks the Employee. A blocked result keeps no
contribution line, as it keeps no Payroll Line (section 7).

Personnel records no GSIS or Employees' Compensation coverage fact. RA No.
8291 covers compensated government employees irrespective of appointment
status; its exclusions are special-regime populations and contractuals
without an employer-employee relationship, both outside the Reference Agency
Profile (BRD PAY-001;
`research/reference-agency-personnel-compensation-boundaries.md`). So an
Employee with a Service Segment in the month is treated as covered, and one
without is not in the calculation. PhilHealth and Pag-IBIG cover the same
Employees, since both apply to appointed personnel through compulsory employee
coverage (the same research file). A recorded coverage fact, when Personnel
adds one, replaces this.

Migration 0176 creates `tax_lines` (#350), with the same insert guard,
immutability, and forced RLS as `contribution_lines`, and adds the
`WITHHOLDING_TAX` component, an unconditional `DEDUCTION`. The withholding tax
runs last in a regular period and reads each earlier line's
`source_snapshot.taxTreatment`
([authorities](../../research/native-payroll-component-authorities.md#tax-treatment)):
`REGULAR_COMPENSATION` earnings, less the `DAYS_WITHOUT_PAY` deductions that
carry the same treatment, are taxable; `MANDATORY_CONTRIBUTION` deductions,
the employee's GSIS, PhilHealth, and Pag-IBIG shares, are excluded from that;
`NON_TAXABLE` earnings, PERA and RATA, are not taxable; and `DE_MINIMIS`
earnings are not, up to their benefit's annual ceiling in the
`DE_MINIMIS_BENEFITS` version, counting what the tax year's finalized payrolls
already paid. `SUPPLEMENTARY_COMPENSATION` earnings, overtime and night-shift
differential, are taxable supplementary compensation (#351).
`THIRTEENTH_MONTH_AND_OTHER_BENEFITS` earnings, the year-end bonus, are not
taxable up to what the tax year leaves of the version's
`thirteenthMonthAndOtherBenefitsExclusion` after the benefits its finalized
payrolls already paid; the excess is supplementary compensation. The tax is
the `COMPENSATION_WITHHOLDING_TAX` version's monthly table as RR No. 11-2018
sec. 2.79(B)(3) and its Illustration 9 apply it: the bracket is the one
taxable regular compensation reaches, and its rate taxes the regular
compensation over the bracket's level and all the supplementary compensation
([authorities](../../research/native-payroll-component-authorities.md#supplementary-withholding)).
The tax is a
`WITHHOLDING_TAX` `DEDUCTION` line, zero included, with the version as
`rule_version_id`, no quantity or rate, and the bracket and every line's
treatment, the regular and supplementary compensation, and the benefits'
exclusion in `source_snapshot`. The Tax Line holds the taxable compensation,
regular and supplementary, the non-taxable compensation, which is the
non-taxable earnings, the excluded benefits, and the excluded shares, so the
two add up to the compensation paid, the tax, the version, and
`year_to_date_snapshot`. The tax year is the calendar year of the period's
payment date, and the snapshot holds the sums of the tax lines, the de
minimis benefits, and the 13th-month pay and other benefits of the Agency's
`FINALIZED` periods paid in it, at each one's final calculation version, with
their ids. A special period runs it too, after the components it names. Every
case it does not settle blocks and writes neither line: no version of either
kind in effect on every date of the period, or one that changes in it, the de
minimis version only when a line is de minimis; supplementary compensation
with regular compensation the table does not tax, or with no more regular
than supplementary compensation, as in a special period, where sec.
2.79(B)(5)(a) requires the cumulative average method, which it does not
apply; a line with no treatment, or one its line type does not admit; a de
minimis benefit the version does not list, or one over its ceiling; and a tax
that is not whole centavos, which no recorded rule rounds. With no earning,
it writes nothing and needs no version, so a special period that pays an
Employee nothing does not block them.

Migration 0182 adds the year-end adjustment (#633; BIR RR No. 11-2018 sec.
2.79(B)(5)(b), [authorities](../../research/native-payroll-component-authorities.md#year-end-adjustment)).
A regular period of December makes it, and so does a regular period in which
an Employee's service ends: the Employee has an `EFFECTIVE` Separation Case,
effectuated by the cutoff, whose approved effective date is the day after a
date in the period. The year's taxable compensation is the year to date's
plus the period's, and the version's `annualTable` taxes it. The period's
withholding tax is that tax less the year to date's withholding tax, so the
tax year's tax lines add up to the year's tax: a deficiency is withheld, and
an excess is refunded as a negative `WITHHOLDING_TAX` deduction and a negative
`withholding_tax`, which the table admits only with `year_end_adjustment`.
The monthly table and the cumulative average method play no part then.
`year_end_adjustment`, null in every other period, is the basis: the
authority, `YEAR_END` or `SEPARATION` with the Separation Case, the tax year,
the year to date's, the period's, and the year's taxable compensation, the
annual bracket and tax, the year to date's withholding tax, and the period's;
the line's `source_snapshot` repeats it. It blocks with a version that has no
`annualTable`, in a period paid after the calendar year it closes, and on an
annual tax that is not whole centavos. Sec. 2.79(B)(5)(b) step 2 adds the
taxable compensation of the year's earlier employers, which LingkodHR does
not record, so the adjustment covers only the Agency's own payrolls.

```sql
CREATE TABLE contribution_billings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  contribution_type text NOT NULL
    CHECK (contribution_type IN ('GSIS','PHILHEALTH','PAGIBIG','EMPLOYEES_COMPENSATION')),
  employee_share numeric(19,4) NOT NULL CHECK (employee_share >= 0),
  employer_share numeric(19,4) NOT NULL CHECK (employer_share >= 0),
  evidence_document_version_id uuid NOT NULL,
  supersedes_contribution_billing_id uuid UNIQUE,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contribution_type <> 'EMPLOYEES_COMPENSATION' OR employee_share = 0),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, supersedes_contribution_billing_id)
    REFERENCES contribution_billings (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX contribution_billings_first_key
  ON contribution_billings (payroll_period_id, employee_id, contribution_type)
  WHERE supersedes_contribution_billing_id IS NULL;
```

A Contribution Billing is the issuer's validated billing of one Employee's
contribution for a regular Payroll Period: both shares, and the finalized
Document Version that evidences them (BRD PAY-004, #349). Migration 0175
creates it. Recording one statement, one contribution type for many
Employees, needs `payroll.deductions.manage` held Agency-wide and writes one
Audit Event. It is recorded only while the period is `DRAFT`, with the period
row locked `FOR SHARE`, so the next calculation compares it before the period
can be certified; a trigger enforces the same. Rows are only inserted, and RLS
is forced. Recording an Employee's billing again corrects it: the new row
names the one it supersedes, and the current billing is the one no row
supersedes.

The billing is evidence, never a rule. It writes no line and changes no share;
a difference it shows can support a versioned correction, such as a new rule
version or a Payroll Adjustment, but never replaces the calculated line (#27).
The calculation's `CONTRIBUTION_BILLING_DIFFERENCE` check (section 10)
compares each current billing with the Contribution Line of its type in the
Employee's `CALCULATED` result, or with zero when there is none. An Employee
with no billing, or with no `CALCULATED` result, is not compared.

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
due the BIR, PhilHealth, GSIS, and HDMF are satisfied (GAA sec. 62). A regular
period applies them through `loan_deduction_lines` below.

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

```sql
CREATE TABLE loan_deduction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_employee_id uuid NOT NULL,
  deduction_obligation_id uuid NOT NULL,
  priority integer NOT NULL CHECK (priority > 0),
  amount_due numeric(19,4) NOT NULL,
  deducted_amount numeric(19,4) NOT NULL,
  not_deducted_amount numeric(19,4) NOT NULL,
  rule_version_id uuid NOT NULL REFERENCES national_payroll_rule_versions (id),
  CHECK (amount_due > 0 AND deducted_amount >= 0 AND not_deducted_amount >= 0
         AND deducted_amount + not_deducted_amount = amount_due),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  FOREIGN KEY (agency_id, deduction_obligation_id)
    REFERENCES deduction_obligations (agency_id, id),
  UNIQUE (agency_id, payroll_employee_id, deduction_obligation_id),
  UNIQUE (agency_id, payroll_employee_id, priority)
);
```

A Loan Deduction Line is what one Deduction Obligation was due in a regular
period's result, what was deducted, and what the net-take-home floor stopped
(#634). Migration 0179 creates it. The calculation applies the version of each
obligation in effect on the period's last day as it stood at the cutoff (ADR
0014): one recorded by the cutoff that started by then, has not ended before
it, and has no successor recorded by the cutoff that started by then. An end
recorded after the cutoff is ignored, because ending changes the row in place. It runs after
every tax and contribution, by the `AUTHORIZED_DEDUCTIONS` version in effect on
every date of the month (FY 2026 GAA sec. 62,
[R6](../../research/salary-overpayment-recovery-authorities.md)):

- the obligations of the version's `priorityPayeeCategories`, in that order,
  then the rest in the order incurred; same-day obligations keep a fixed order
  by payee name and issuer reference;
- each for its scheduled amount, capped at its outstanding balance;
- none below `monthlyNetTakeHomeFloor`: an obligation takes only what leaves
  net pay at the floor, and the rest is its `not_deducted_amount`.

A deducted amount is also a `LOAN_DEDUCTION` Payroll Line, so the result's
totals include it. A stopped amount raises the `NET_PAY_FLOOR_STOPPED_DEDUCTION`
warning, which lists each obligation and the amount not taken; it stays owed.
No version in effect on every date, a version that changes inside the month,
and an obligation whose payee category the version does not allow block the
Employee instead. A special period applies no obligation.

The line joins its result only in the transaction that writes the result, for
an obligation of the result's Employee, and is never changed or deleted, like a
Contribution Line. RLS is forced.

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
`CALCULATING` at its version, apart from the rule version and withdrawn input
marks below, and rejects every `DELETE`.

A National Payroll Rule Version loaded after a snapshot never recalculates a
period silently (#328). Migration 0170 marks each period the load affects, in
the load's transaction (#624): a period of any Agency, past `DRAFT` and not
`FINALIZED` or `VOIDED`, with a date the version is in effect on. The mark is a
period-wide `RULE_VERSION_LOADED_AFTER_SNAPSHOT` exception on the current
version, naming the version in `details`:

- `CALCULATING` and `FOR_REVIEW`: `BLOCKING`. A queued calculation counts it
  and returns to `DRAFT`, and certification is refused until the period is
  calculated again. The load waits for a running calculation to commit and
  marks what it committed.
- `CERTIFIED` and `APPROVED`: `WARNING`. The snapshot stands and the period is
  flagged.

A `DRAFT` period's next snapshot takes the version, and a `FINALIZED` one is
corrected only by a Payroll Adjustment. An `AFTER INSERT` trigger on
`national_payroll_rule_versions` writes the mark through a `SECURITY DEFINER`
function, whose owner policies expose only those periods, admit only row locks
on them, and admit only this exception type. `hris_app` cannot write the type,
and the insert trigger admits it only on the current version, naming no
Employee, with the severity its status takes.

A source's withdrawal of a `PENDING` input a live calculation uses marks each
such period with a `PAYROLL_INPUT_WITHDRAWN` exception (#649, section 4). It is
`BLOCKING` at every status, `CALCULATING` through `APPROVED`, which is stricter
than the rule version mark: paying a cancelled leave monetization while Leave
restores the credits would pay twice (#330 D11 #15). It names the input's
Employee, and its `details` name the `payrollInputId`, source module, input
kind, and correction key. Migration 0181 lets `hris_app` write it under the
Agency policy, and the insert trigger admits it only on the current version of
a `CALCULATING`, `FOR_REVIEW`, `CERTIFIED`, or `APPROVED` period, as
`BLOCKING`, naming the Employee of a `CANCELLED` input. A queued calculation
counts it and returns to `DRAFT`. A `CERTIFIED` or `APPROVED` period stays as
it is, certification included, until it is returned: a revoked certification
and a return for correction, or a return before finalization, then a
recalculation. The new version never reads the cancelled input, so the mark
lifts with it.

Migration 0181 also refuses every move of a period to `CERTIFIED`, `APPROVED`,
or `FINALIZED` while its current version has an open `BLOCKING` exception, so
the rule holds for approval and finalization before their commands exist. The
certify command refuses first with `PAYROLL_PERIOD_BLOCKING_EXCEPTION`.

After storing the lines, the calculation runs its checks (#623) in the same
transaction and writes what they raise, so a blocking one returns the period
to `DRAFT` and a warning alone does not:

| `exception_type`         | Severity | Raised for                                                                                                             |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NET_PAY_NEGATIVE`       | BLOCKING | A result whose `net_amount` is below zero (the developer's ruling)                                                     |
| `BASIC_SALARY_MISSING`   | BLOCKING | A `CALCULATED` result of a regular period with no `BASIC_SALARY` earning line                                          |
| `PAYROLL_LINE_DUPLICATE` | BLOCKING | Two lines of one result with equal component, line type, rule version, quantity, rate, amount, and `source_snapshot`   |
| `NET_PAY_VARIANCE`       | WARNING  | A `CALCULATED` result of a regular period whose net differs from the Employee's in the last `FINALIZED` regular period |

`CONTRIBUTION_BILLING_DIFFERENCE` blocks a current Contribution Billing whose
employee or employer share differs from the calculated one (#349). Its
`details` store the difference: the billing, the contribution type, and the
billed and calculated shares. A Payroll Preparer explains a difference by
resolving the exception with a reason, and the explanation holds for that
difference only: a later calculation of the period raises nothing while a
`RESOLVED` exception of an earlier version names the same billing and the same
calculated shares. A corrected billing or a changed calculation is a new
difference, and blocks again.

Two more checks block a `CALCULATED` result of a regular period that pays
`OVERTIME_PAY` (#628).
`OVERTIME_PAY_AGENCY_CAP_UNVERIFIED` is raised for every such result: JC 2,
s. 2015 item 10.7 caps the Agency's Overtime Pay for the year at 5% of its
Personnel Services budget and needs the DBM's approval above it, and LingkodHR
records neither. `OVERTIME_PAY_EMPLOYEE_ANNUAL_CAP` is raised when the
Employee's Overtime Pay this period and in the year's `FINALIZED` periods
exceeds 50% of the basic salary, less salary for days without pay, paid in
them (item 10.6). The year's total basic salary, which item 10.6 measures
against, is known only when the year ends, so the employee cap blocks whatever
cannot yet be shown within it rather than project the rest of the year. The
year is the period's own (_reading_: the circular counts pay "in a year"), and
only one regular period is open at a time, so no other period of the year
holds unfinalized pay.

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

Migration 0190 creates both tables (#356) with forced RLS under the Agency
policy. `hris_app` may insert both and update only an adjustment's `status`,
`posted_by_payroll_period_id`, and `posted_at`. A trigger admits an
adjustment only `OPEN` and against a `FINALIZED` period, lets it change only
from `OPEN` to `POSTED`, in the transaction that finalizes a different period
carrying it, and rejects every `DELETE`; cancelling arrives with the void
(#358). A cause joins only an `OPEN` adjustment, which it locks `FOR SHARE`,
so a posting waits for it or it for the posting, and a `PAYROLL_HOLD` cause
only in the finalization of the held period, naming that period's active hold
of the Employee. Causes are immutable. `SOURCE_CORRECTION` arrives with #650.

`RECALCULATION` is the command
`POST /agencies/:agencyId/payroll-periods/:periodId/adjustments`, with a
`reason` and an optional `employeeId`. It needs `payroll.inputs.adjust`
Agency-wide, claims no payroll function, and writes one
`PAYROLL_ADJUSTMENT_RECALCULATION_OPENED` Audit Event on the original period.
It refuses a period that is not `FINALIZED` with
`PAYROLL_PERIOD_NOT_FINALIZED`, and an Employee or period of another Agency
as not found. "All of its Employees" are those with a result in its final
version and those an adjustment against it already names, such as a held
Employee (_reading_). An Employee of the Agency with no result in it may be
named, so a late Personnel record can be paid against an empty original.

How the carrying calculation computes a difference, where the sources are
silent (_readings_, #356):

- The recalculation runs the calculators before the withholding tax for the
  original period's run type and dates, on the compensation basis Personnel
  now records for them, the carrying snapshot's rules for those dates, and
  the Payroll Inputs and Attendance Payroll Facts the original version's own
  lines rest on, whatever their status. It reads no deficit charge, which the
  original's finalization settled. An Employee with no service in those dates
  recalculates to nothing.
- The difference is taken per component and line type, against the original
  version's own lines plus the lines of every `POSTED` adjustment for the same
  Employee and period. `WITHHOLDING_TAX` and `LOAN_DEDUCTION` are left out on
  both sides: the carrying period's own withholding tax and Deduction
  Obligations apply to what it pays. A difference of zero writes no line.
- Each line has no quantity or rate, the recalculated lines' rule version
  when they share one, and in `source_snapshot` the adjustment and original
  period, the recalculated and previous amounts, the recalculated lines, and
  their `taxTreatment`. The lines are written before the carrying period's
  withholding tax, so it taxes them as compensation paid in that period, by
  that treatment. The contributions never read them.
- The contribution calculators run for the original month, so a contribution
  difference is a Payroll Line. No Contribution Line is written for it: the
  carrying result's Contribution Lines hold its own month.
- The direction is the net difference, earnings less deductions. A negative
  one writes no line and a `PAYROLL_ADJUSTMENT_NEGATIVE` warning naming the
  adjustment, so certification and approval are not blocked.
- A recalculation that blocks writes no line and blocks the Employee, its
  exceptions naming the adjustment and original period.
- An Employee with no service in the carrying period gets a result of the
  adjustment lines and their withholding tax only. A special period that
  names no component pays only adjustments: an Employee it owes no positive
  difference gets no result there, and the adjustment waits for the next
  regular period.
- A further cause is refused with `PAYROLL_ADJUSTMENT_IN_PAYROLL` while a
  period's current version past `DRAFT`, and not yet `FINALIZED`, carries the
  adjustment, because that version's difference is already calculated and the
  cause would not be counted. Once that period is finalized, a new cause opens
  a new adjustment against what is then posted.

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
8. mark payroll period finalized, with its finalizer and time;
9. mark its Payroll Inputs and `ONCE` Authorized Payroll Component Inputs
   consumed, and insert `payroll_consumed_attendance_facts`;
10. mark the Payroll Adjustments it carried `POSTED`, and open one for each
    Employee under an active Payroll Hold;
11. append audit/outbox records;
12. commit before generating documents or emails.

Migration 0184 and `PayrollFinalizationService` build every step but 10,
which migration 0190 adds with the Payroll Adjustment tables (#356). The
service refuses each check with the codes of section 5.

- Step 5 compares each result of the version with its lines: `gross_amount`
  the `EARNING` lines, `total_deductions` the `DEDUCTION` lines, and
  `net_amount` their difference, as the calculation stores them.
- Steps 6 and 9 take the sources from `payroll_line_sources` of the version's
  lines (_reading_: what the approved version used is what its lines rest on,
  so a held Employee's sources stay unconsumed). Inputs are marked `CONSUMED`
  only while `PENDING`, and facts are inserted with the live UNIQUE index
  skipping one already consumed, so each write waits for a concurrent
  finalization of another period and then finds the source taken. A
  shortfall refuses with `PAYROLL_SOURCE_CONSUMED` and stores nothing
  (_reading_: the refusal is the blocking exception; the period cannot
  finalize until it is returned and recalculated, so no exception row is
  written).
- No calculator pays a `ONCE` Authorized Payroll Component Input yet, so
  finalization consumes none; the calculator that pays one adds it here.
- Step 10 posts every adjustment the version's snapshot names whose Employee
  has a result in the version and that has no `PAYROLL_ADJUSTMENT_NEGATIVE`
  warning there, zero differences included (_reading_: it was recalculated
  and nothing is owed). An Employee held out of the carrying period has no
  result, so their carried adjustments stay `OPEN`. One another payroll
  posted first refuses with `PAYROLL_SOURCE_CONSUMED`. It then opens an
  adjustment, with a `PAYROLL_HOLD` cause, for each Employee under an active
  hold of the period. The `PAYROLL_PERIOD_FINALIZED` Audit Event names both
  lists.
- Step 11 appends one `PAYROLL_PERIOD_FINALIZED` Outbox Event per period,
  aggregate `PayrollPeriod`, idempotency key `payroll-period-finalized:<id>`,
  with the period, version, hash, certification, and `finalizedAt`. Work after
  the commit, such as Payslips (#336), reads it. The transaction runs with the
  `payroll-transition` capability, which migration 0184 adds to the owners
  `guard_outbox_event_insert` admits.

Lines, line sources, tax, contribution, and loan lines, and rule snapshots and
their items already reject every `UPDATE` and `DELETE` at any status.

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

Migration 0185 creates the table with forced RLS, a foreign key from
`(agency_id, document_id)` to `documents`, and a check that only a
`GENERATING` or `SUPERSEDED` Payslip lacks a Document (#336). A trigger admits
a Payslip only for a `FINALIZED` result, inserted `GENERATING` with nothing
released or withheld, rejects every `DELETE`, and admits one change:
`GENERATING → READY`, naming its Document once. `hris_app` holds `SELECT`,
`INSERT`, and `UPDATE ("status", "document_id")`.

Migration 0191 (#640) adds release, withholding, and the Employee's read.
`hris_app` may also `UPDATE` the release and withholding columns, and the
trigger admits three more changes, each writing only its own columns, once:
`READY → RELEASED` and `WITHHELD → RELEASED` set `released_at` and
`released_by_membership_id`, and `READY → WITHHELD` sets `withheld_at`,
`withheld_by_membership_id`, and `withhold_reason`. Each needs the result's
period `FINALIZED` and the named person to hold `APPROVAL` on it in
`payroll_period_actors`. A released Payslip keeps its withholding on record.
Supersession is left to the void command.

Every command locks the period first, then claims `APPROVAL` in its own
transaction (hris-controls.md §5.20), so a person who holds another function
on the period is refused with `PAYROLL_FUNCTION_CONFLICT`:

- `POST .../payroll-periods/:periodId/payslips/release` needs
  `payroll.payslips.release` held Agency-wide and releases every `READY`
  Payslip of a `FINALIZED` period. It leaves a `WITHHELD` one withheld and
  counts those still `GENERATING`, so releasing again later takes them.
  With nothing `READY` it writes only the claim.
- `POST .../payslips/:payslipId/withhold` needs `payroll.payslips.withhold`
  held Agency-wide and a reason, and applies only to a `READY` Payslip
  (`PAYSLIP_NOT_READY` otherwise).
- `POST .../payslips/:payslipId/release` needs `payroll.payslips.release`
  held Agency-wide and a reason, and applies only to a `WITHHELD` Payslip
  (`PAYSLIP_NOT_WITHHELD` otherwise).

Each released Payslip gets a `PAYSLIP_RELEASED` Audit Event (idempotency key
`released`) and a `PAYSLIP_RELEASED` Outbox Event naming the Payslip, period,
result, and Employee, which notifies the Employee after commit. Withholding
is a `PAYSLIP_WITHHELD` Audit Event with its reason (key `withheld`).

`GET .../payslips` and `GET .../payslips/:payslipId` need
`payroll.payslips.read` at any scope and reach only the Employee linked to
the caller's Agency Membership, whatever the scope, so another Employee's
Payslip, or one not `RELEASED`, is `PAYSLIP_NOT_FOUND`. The list states each
Payslip's period and totals; the single read adds a signed link to its PDF
through the shared document service. Migration 0191 grants release and
withhold Agency-wide to the Payroll Approver and the read `OWN` to the
Employee. The matrix's Agency-wide read for the payroll officers has no read
built yet, so it is not seeded.

`PayslipGenerationJob` in the API process consumes the
`PAYROLL_PERIOD_FINALIZED` Outbox Event (section 11). On start and a minute
after each pass, `payslips_due()`, a `SECURITY DEFINER` function like
`payroll_calculations_due()`, returns each finalized period with a
`FINALIZED` result whose Payslip is missing or still `GENERATING`. For each,
in the Agency's context:

1. one transaction inserts a `GENERATING` Payslip for every `FINALIZED`
   result, skipping those that have one, so a held Employee, who has no
   result, gets none;
2. each `GENERATING` Payslip's PDF is rendered from the finalized result and
   its lines and stored through the shared document service under
   `payslips/<agency>/<payslip>/<sha256>.pdf`, before any transaction;
3. one transaction locks the Payslip and, only while it is still
   `GENERATING`, records an `APPROVED`, issued, `CONFIDENTIAL` Document of
   type `PAYSLIP` for that object, created by the Payroll Approver who
   finalized the period, marks the Payslip `READY`, and appends a
   `PAYSLIP_READY` Audit Event with actor `SYSTEM`.

A failed store or transaction leaves the Payslip `GENERATING`, and the next
pass retries it under the same row. Of two runs at once, one records the
Document and the other finds the Payslip `READY`. The job only reads
finalized payroll rows.

The PDF is LingkodHR's own Printable System View (#617): it carries no form
number, form title, or conformance claim, and says it states one finalized
result and is not proof of payment. It names the Agency, the Employee, the
period, its payment date and finalization time, and the result's version and
calculation hash. It lists each Payroll Line by line type with its amount and
how it was reached: quantity and unit, rate, the `formula` and `authority`
the calculation recorded in `source_snapshot`, and its National Payroll Rule
Version. Then come gross, total deductions, and net. The same result always
renders the same bytes (_reading_: no format is prescribed, and the payroll
ERD records the Payslip as a rendered PDF, so it is plain text in Helvetica
on A4).

```sql
CREATE TABLE payroll_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL UNIQUE,
  calculation_version integer NOT NULL,
  document_id uuid NOT NULL,
  result_count integer NOT NULL CHECK (result_count >= 0),
  gross_amount numeric(19,4) NOT NULL,
  total_deductions numeric(19,4) NOT NULL,
  net_amount numeric(19,4) NOT NULL,
  generated_by_membership_id uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (net_amount = gross_amount - total_deductions),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, document_id)
    REFERENCES documents (agency_id, id),
  FOREIGN KEY (agency_id, generated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);
```

A Payroll Register (PAY-009, #353) is generated from a `FINALIZED` Payroll
Period by `POST .../payroll-periods/:periodId/register`, which needs
`payroll.registers.generate` held Agency-wide and claims no payroll function.
It reads the period's `FINALIZED` results at the finalized calculation
version and their lines, and proves them with the Payroll Export
Reconciliation the Certified Payroll Review Export uses: the results still
hash to the certification in force, every line names a catalogued component
of its line type, each result's earning and deduction lines sum to its gross
and total deductions, and net is gross less deductions. A failure refuses
with `PAYROLL_REGISTER_RECONCILIATION_FAILED`, naming each mismatch, and
stores nothing; a period not `FINALIZED` refuses with
`PAYROLL_REGISTER_PAYROLL_NOT_FINALIZED`.

The PDF is rendered from those rows and stored through the shared document
service under `payroll-registers/<agency>/<period>/<sha256>.pdf` before any
write. One transaction then locks the period and, only while it has no
register, records an `APPROVED`, issued, `CONFIDENTIAL` Document of type
`PAYROLL_REGISTER` created by the generating person, the register with the
reconciled totals, and a `PAYROLL_REGISTER_GENERATED` Audit Event
(idempotency key `generated`) naming the Document Version, its content hash,
the calculation hash, and the totals. A period has one register: generating
again, by anyone permitted, returns the stored one and writes nothing, and of
two at once one records it and the other returns it.

Migration 0187 creates the table with forced RLS. Its trigger rejects every
`UPDATE` and `DELETE`, admits a register only for a `FINALIZED` period at its
calculation version, and only when its count and totals equal that version's
`FINALIZED` results and the sums of their `EARNING` and `DEDUCTION` lines.
`hris_app` holds `SELECT` and `INSERT` only. The migration grants
`payroll.registers.generate` Agency-wide to the Payroll Preparer, the HR
Certifier, the Budget Officer, the Accounting Reviewer, the Payroll Approver,
and the Cashier; the HR Administrator's `C` and the Auditor's `R` are not
seeded.

The PDF is LingkodHR's own Printable System View (#617), with no form number,
form title, or conformance claim. It says it lists the finalized results of
one period and is not proof of payment, and names the Agency, the period,
its payment date and finalization time, and the calculation version and
hash. It lists each result by agency employee number with the Employee's
name, gross, total deductions, and net; then each pay component's total and
line count, by line type; then gross, total deductions, net, employer
shares, and informational totals (_reading_: no register layout is
prescribed, so it carries what the finalized results and lines hold, in the
Payslip's plain-text PDF). The same finalized period always renders the
same bytes. A voided payroll's supersession of its register arrives with the
void command (#643).

```sql
CREATE TABLE payroll_export_contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (btrim(code) <> ''),
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE certified_payroll_review_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  payroll_certification_id uuid NOT NULL UNIQUE,
  payroll_export_contract_version_id uuid NOT NULL
    REFERENCES payroll_export_contract_versions (id),
  content text NOT NULL,
  checksum text NOT NULL
    CHECK (checksum = encode(sha256(convert_to(content, 'UTF8')), 'hex')),
  generated_by_membership_id uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, payroll_certification_id)
    REFERENCES payroll_certifications (agency_id, id),
  FOREIGN KEY (agency_id, generated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX certified_payroll_review_exports_one_current_key
  ON certified_payroll_review_exports (payroll_period_id)
  WHERE superseded_at IS NULL;
```

A Payroll Export Contract Version is the immutable definition of one payroll
Structured Export: its fields, meanings, formats, and control rules. It is
platform-wide, with no `agency_id` and no row-level security; `hris_app`
holds `SELECT` only, a trigger rejects every `UPDATE` and `DELETE`, and a
change is a successor version added by migration. Migration 0178 adds
`CERTIFIED_PAYROLL_REVIEW_EXPORT` version 1 (#636).

A Certified Payroll Review Export is the artifact of one Payroll
Certification. `Certify HR inputs` generates it in the certifying transaction,
so a period has its current export the moment it is `CERTIFIED` (#29, #636). `content` is canonical
JSON: object keys sorted at every depth, amounts as four-place decimal
strings. It carries the contract, a statement that it asserts no fund
validation, obligation, posting, or receipt, the period, the certification
and its calculation hash, the Classified Payroll Export Lines, and the
Payroll Export Reconciliation. `checksum` is the SHA-256 of `content`'s
bytes, and the CHECK keeps the two together.

Contract version 1 has one Classified Payroll Export Line per pay component
and component kind, summed over every Payroll Line of the certified
version's results. It carries the component's code, name, kind, Payroll
Effect, and reporting category. A Payroll Line carries no funding,
organization, or cost-center reference yet, so version 1 does not classify
by them.

After certify records the certification and moves the period to
`CERTIFIED`, it classifies the certified version's lines and proves the
reconciliation:

- the results still hash to the certification's `calculation_hash`;
- every line belongs to an exported result, names a catalogued component,
  and has that component's category as its line type;
- each result's earning lines sum to its gross, its deduction lines to its
  total deductions, and gross less deductions is its net;
- the classified lines' source counts sum to the source line count, and
  their amounts by kind equal the source lines' and the results' totals.

A failure refuses certification with `PAYROLL_EXPORT_RECONCILIATION_FAILED`
and stores nothing: no certification, no export, and the period stays
`FOR_REVIEW`. Generation is idempotent for one certification: called again,
it returns the stored export. The `PAYROLL_PERIOD_CERTIFIED` Audit Event
names the export and its checksum. The period detail names the current
export as `certification.reviewExportId`, and any export, current or
superseded, is read with `payroll.periods.read` held Agency-wide.

A trigger admits an export only for the certification in force on its
period, while the period is `CERTIFIED` or `APPROVED` at the certified
version. It rejects every `DELETE`, and lets an `UPDATE` only set
`superseded_at`, once. Revoking the certification supersedes its export in
the same transaction; a returned checkpoint review (#637) revokes the
certification and so supersedes it the same way. A later certification of
the same version gets its own export.

```sql
CREATE TABLE payroll_export_checkpoint_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  certified_payroll_review_export_id uuid NOT NULL,
  checkpoint text NOT NULL CHECK (checkpoint IN ('BUDGET','ACCOUNTING')),
  outcome text NOT NULL CHECK (outcome IN ('CONFIRMED','RETURNED')),
  external_reference text CHECK (external_reference IS NULL OR btrim(external_reference) <> ''),
  evidence_document_version_id uuid,
  reason text,
  reviewed_by_membership_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome <> 'CONFIRMED'
         OR (external_reference IS NOT NULL AND evidence_document_version_id IS NOT NULL)),
  CHECK ((outcome = 'RETURNED') = (reason IS NOT NULL)
         AND (reason IS NULL OR btrim(reason) <> '')),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, certified_payroll_review_export_id)
    REFERENCES certified_payroll_review_exports (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, reviewed_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (certified_payroll_review_export_id, checkpoint)
);
```

A Budget Officer and an Accounting Reviewer each record one immutable Payroll
Export Checkpoint Review against the current Certified Payroll Review Export,
in either order (#29, #330, #637). Approval needs both confirmed. Each names
the exact export it reviewed in its route, and is refused with
`PAYROLL_REVIEW_EXPORT_SUPERSEDED` when that export is no longer current. A
reviewer who is only waiting records nothing.

- `POST .../review-exports/:exportId/budget-review` needs
  `payroll.periods.review_funding` and claims `BUDGET_REVIEW`.
- `POST .../review-exports/:exportId/accounting-review` needs
  `payroll.periods.review_accounting` and claims `ACCOUNTING_REVIEW`.

A confirmation names the external reference, such as the ORS or JEV number,
and the exact finalized Document Version of the Agency that evidences it. A
return gives its reason and may name either. Neither asserts that funds were
obligated or an entry posted. A confirmation keeps the period `CERTIFIED`. A
return, in the same transaction, revokes the certification in force with the
reviewer as the revoker and the review's reason, supersedes the export, and
moves the period to `FOR_REVIEW`. Each outcome is an Audit Event on the
period; a return's names the revoked certification, the superseded export,
and the other review it revoked.

A review is in force while its export is current, so superseding the export
revokes its reviews and nothing on the review changes: revoking the
certification, a returned review, and a return before finalization all
revoke them that way. The period detail lists the reviews of its current
export as `certification.checkpointReviews`. A trigger admits a review only
against the current export of its period while the period is `CERTIFIED`, and
rejects every `UPDATE` and `DELETE`. Migration 0180 creates the table and
grants `payroll.periods.review_funding` to the Budget Officer and
`payroll.periods.review_accounting` to the Accounting Reviewer, Agency-wide.

```sql
CREATE TABLE payment_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL UNIQUE,
  calculation_version integer NOT NULL,
  payment_date date NOT NULL,
  payroll_export_contract_version_id uuid NOT NULL
    REFERENCES payroll_export_contract_versions (id),
  currency text NOT NULL CHECK (currency = 'PHP'),
  generated_by_membership_id uuid NOT NULL,
  generated_at timestamptz NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  summary_content text NOT NULL,
  summary_checksum text NOT NULL
    CHECK (summary_checksum = encode(sha256(convert_to(summary_content, 'UTF8')), 'hex')),
  source_result_count integer NOT NULL,
  source_net_total numeric(19,2) NOT NULL,
  instruction_count integer NOT NULL,
  instruction_total numeric(19,2) NOT NULL,
  excluded_result_count integer NOT NULL,
  excluded_result_total numeric(19,2) NOT NULL,
  CHECK (instruction_count >= 0 AND excluded_result_count >= 0
         AND source_result_count = instruction_count + excluded_result_count
         AND instruction_total >= 0 AND excluded_result_total <= 0
         AND source_net_total = instruction_total + excluded_result_total),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, generated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE payment_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payment_export_id uuid NOT NULL,
  payroll_employee_id uuid NOT NULL,
  payroll_bank_account_id uuid NOT NULL,
  agency_employee_number text NOT NULL,
  payee_legal_name text NOT NULL,
  destination_type text NOT NULL CHECK (destination_type = 'BANK_ACCOUNT'),
  institution_identifier_scheme text NOT NULL
    CHECK (institution_identifier_scheme = 'AGENCY_BANK_CODE'),
  institution_identifier text NOT NULL,
  institution_name text NOT NULL,
  masked_account_identifier text NOT NULL,
  account_holder_name text NOT NULL,
  amount numeric(19,2) NOT NULL CHECK (amount > 0),
  payment_reference text NOT NULL,
  FOREIGN KEY (agency_id, payment_export_id)
    REFERENCES payment_exports (agency_id, id),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  FOREIGN KEY (agency_id, payroll_bank_account_id)
    REFERENCES payroll_bank_accounts (agency_id, id),
  UNIQUE (payment_export_id, payroll_employee_id),
  UNIQUE (agency_id, id)
);
```

A Payment Export (#28, #337) is generated from a `FINALIZED` Payroll Period
by `POST .../payroll-periods/:periodId/payment-exports`, which needs
`payroll.payment_exports.generate` held Agency-wide and claims no payroll
function. It locks the period, reads the period's `FINALIZED` results at the
finalized calculation version, and writes the export, its instructions, and a
`PAYMENT_EXPORT_GENERATED` Audit Event (idempotency key `generated`) in one
transaction. A period has one export: generating again, by anyone permitted,
returns the stored one, its checksums unchanged, and writes nothing.
Migration 0186 adds `PAYMENT_EXPORT` version 1 to the contract versions, and
its definition names every CSV column, the row order, and the control rules.

Each positive-net-pay result gets one instruction to its Employee's
designated destination: the `ACTIVE` Payroll Bank Account (so `VERIFIED`)
whose effective dates cover the generation date in Asia/Manila (_reading_:
#28 snapshots the destination designated "at generation", not on the payment
date). The bank code is the institution identifier under the
`AGENCY_BANK_CODE` scheme and, since the HRIS keeps no bank catalogue, also
the institution name. The account name is the account-holder name, the
Employee's legal name the payee's, and the payment reference is the period
code and the agency employee number joined by a hyphen. A zero- or
negative-net-pay result gets no instruction and is counted in the
`excluded_result_*` controls. Generation refuses the whole export, storing
nothing, with:

- `PAYMENT_EXPORT_PAYROLL_NOT_FINALIZED` when the period is not `FINALIZED`;
- `PAYMENT_EXPORT_RECONCILIATION_FAILED` when a result's earning or deduction
  lines differ from its totals, its net is not gross less deductions, its net
  is not whole centavos (the export never rounds), or the controls do not
  account for every result;
- `PAYMENT_EXPORT_DESTINATION_BLOCKED` when any positive-net-pay result's
  destination is missing, ineffective, or unverified, naming every Employee
  affected.

The CSV is UTF-8 without a byte order mark, RFC 4180, every field
double-quoted, CRLF line endings, one row per instruction. It carries the full
account number, so it is not stored: `GET .../payment-exports/:exportId/csv`
renders it again from the export, its instructions, the period's fixed code,
run type, and dates, and the destination's account number, decrypted from
the immutable ciphertext of `payroll_bank_accounts`. It refuses with
`PAYMENT_EXPORT_CHECKSUM_MISMATCH` unless the bytes hash to `checksum`
(_reading_: this keeps account numbers encrypted at rest; the logical ERD's
`document_id` and `summary_document_id` are not used). The summary holds
masked account numbers only, the last four characters visible, and is stored
as `summary_content`, so it keeps the excluded results' names as they were;
`GET .../payment-exports/:exportId/summary` returns it. It names the CSV's
checksum, so the two artifacts are tied. Both downloads need the same
permission, and each is a `PAYMENT_EXPORT_DOWNLOADED` Audit Event naming the
artifact and its checksum.

Triggers keep both tables immutable, even for the database owner. An export
is admitted only for a `FINALIZED` period at its calculation version. An
instruction is admitted only in the transaction that writes its export, for
a `FINALIZED` result of that period and version, for exactly the result's
net, to that Employee's `ACTIVE` account effective that day. `hris_app` holds
`SELECT` and `INSERT` only. Migration 0186 adds the `cashier` role and grants
`payroll.payment_exports.generate` Agency-wide to the Accounting Reviewer,
the Payroll Approver, and the Cashier; the Payroll Preparer's `C` and the
Auditor's `R` are not seeded.

A superseding export, its retry linkage, and a voided payroll's supersession
(#643) are not built yet, so the tables have no
`supersedes_payment_export_id`, `prior_payment_instruction_id`, or
`retry_reason`, and `payroll_period_id` is UNIQUE.

```sql
CREATE TABLE disbursement_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payment_instruction_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  outcome text NOT NULL
    CHECK (outcome IN ('SUBMITTED','ACCEPTED','REJECTED','SETTLED','RETURNED')),
  external_reference text CHECK (external_reference IS NULL OR btrim(external_reference) <> ''),
  evidence_document_version_id uuid,
  reason text,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome IN ('REJECTED','RETURNED')) = (reason IS NOT NULL)
         AND (reason IS NULL OR btrim(reason) <> '')),
  FOREIGN KEY (agency_id, payment_instruction_id)
    REFERENCES payment_instructions (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (payment_instruction_id, sequence),
  UNIQUE (agency_id, id)
);
```

A Disbursement Outcome is external evidence of one Payment Instruction's
progress or result after handoff (#28, #642). The Cashier records it with
`POST .../payment-exports/:exportId/instructions/:instructionId/disbursement-outcomes`,
which needs `payroll.disbursement.update` held Agency-wide and claims the
`DISBURSEMENT` function on the instruction's Payroll Period (section 5), so
the period's Payroll Approver, or anyone holding another function there, is
refused with `PAYROLL_FUNCTION_CONFLICT`. The command locks the period row,
which must be `FINALIZED`, and writes the outcome and a
`DISBURSEMENT_OUTCOME_RECORDED` Audit Event on the instruction, naming the
previous and new outcome, in one transaction.

An instruction's outcomes are numbered from 1 in the order recorded, and its
latest outcome is the one with the highest `sequence`. The request names the
`sequence` it takes, one more than the outcomes the Cashier read, and a stale
or repeated request is refused with `DISBURSEMENT_OUTCOME_STALE`. Any outcome
may follow any other (_reading_: #28 lists the outcomes but no order between
them), so a wrong outcome is answered by a later one. `ACCEPTED` does not
imply `SETTLED`, and one export's instructions may hold mixed outcomes. The
external reference, such as the bank's batch number, and the evidence, an
exact finalized Document Version of the Agency, are optional; `REJECTED` and
`RETURNED` need a reason, and only they take one. Recording an outcome
changes no export, instruction, or payroll row.

`instructionsBlockingVoid` in `apps/api/src/payment-exports` returns the
period's instructions whose latest outcome is `SUBMITTED`, `ACCEPTED`, or
`SETTLED`; the void request and approval (section 5) refuse while it returns
any. They call it after locking the period row, which recording an outcome
also locks, so the answer holds until the void commits.

A trigger rejects every `UPDATE` and `DELETE`, even for the database owner,
and admits an outcome only on an instruction of a `FINALIZED` period, as the
next `sequence` of its instruction. `hris_app` holds `SELECT` and `INSERT`
only. Migration 0192 creates the table with forced RLS and grants
`payroll.disbursement.update` Agency-wide to the Cashier; the Accounting
Reviewer's and the Payroll Approver's `C` and the Auditor's `R` are not
seeded.

```sql
CREATE TABLE contribution_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL UNIQUE,
  calculation_version integer NOT NULL,
  payroll_export_contract_version_id uuid NOT NULL
    REFERENCES payroll_export_contract_versions (id),
  generated_by_membership_id uuid NOT NULL,
  generated_at timestamptz NOT NULL,
  content text NOT NULL,
  checksum text NOT NULL
    CHECK (checksum = encode(sha256(convert_to(content, 'UTF8')), 'hex')),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, generated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE remittance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  contribution_summary_id uuid NOT NULL,
  contribution_type text NOT NULL
    CHECK (contribution_type IN ('GSIS','PHILHEALTH','PAGIBIG','EMPLOYEES_COMPENSATION')),
  line_count integer NOT NULL CHECK (line_count >= 0),
  employee_share_total numeric(19,4) NOT NULL,
  employer_share_total numeric(19,4) NOT NULL,
  total_amount numeric(19,4) NOT NULL,
  content text NOT NULL,
  checksum text NOT NULL
    CHECK (checksum = encode(sha256(convert_to(content, 'UTF8')), 'hex')),
  CHECK (total_amount = employee_share_total + employer_share_total),
  CHECK (contribution_type <> 'EMPLOYEES_COMPENSATION' OR employee_share_total = 0),
  FOREIGN KEY (agency_id, contribution_summary_id)
    REFERENCES contribution_summaries (agency_id, id),
  UNIQUE (contribution_summary_id, contribution_type),
  UNIQUE (agency_id, id)
);
```

A Contribution Summary and its four Remittance Schedules, one each for GSIS,
PhilHealth, Pag-IBIG, and Employees' Compensation, are Structured Exports for
review of one `FINALIZED` payroll's contributions (PAY-009, #354). They file
and remit nothing (PAY-010), and carry no form number, form title, or
issuer's layout (#617). `POST .../payroll-periods/:periodId/contribution-remittances`
generates them; it needs `payroll.registers.generate` held Agency-wide and
claims no payroll function. It locks the period, reads every Contribution
Line (section 9) of the period's `FINALIZED` results at the finalized
calculation version, and writes the summary, its schedules, and a
`CONTRIBUTION_REMITTANCE_GENERATED` Audit Event (idempotency key
`generated`) in one transaction. A period has one summary: generating again,
by anyone permitted, returns the stored artifacts unchanged and writes
nothing. `GET .../contribution-remittances/:summaryId` reads them with the
same permission. A period that is not `FINALIZED` is refused with
`CONTRIBUTION_REMITTANCE_PAYROLL_NOT_FINALIZED`. Migration 0188 adds
`CONTRIBUTION_REMITTANCE` version 1 to the contract versions; its definition
names every field, the line order, and the control rules.

Each artifact is canonical JSON, like the Certified Payroll Review Export:
keys sorted at every depth, amounts as four-place decimal strings, as the
Contribution Lines store them. Every artifact carries the contract, its
statement that it is not a filing or a remittance and follows no issuer's
format, the Agency, the summary's id, the generation time, and the period
with its finalized version and finalization time. A schedule lists each
Contribution Line of its type by agency employee number: the Employee's
name, the base, the Employee's share, the Agency's share as employer, their
sum, and the National Payroll Rule Version's id and code. Its totals are the
line count and the sums of those lines. A type with no line, such as every
type of a special period (section 9), still has a schedule, with no lines
and zero totals. The summary lists each schedule's id, checksum, line count,
and totals, then the totals over every type, so the five artifacts are
tied. `checksum` is the SHA-256 of `content`, and a CHECK keeps the two
together.

Triggers keep both tables immutable, even for the database owner. A summary
is admitted only for a `FINALIZED` period at its calculation version, and a
deferred trigger refuses to commit one without a schedule of each of the four
types. A schedule is admitted only in the transaction that writes its
summary, and only when its line count and Employee and employer share totals
equal the count and sums of the Contribution Lines of its type in the
summary's `FINALIZED` results, so a schedule's totals always equal its
lines. `hris_app` holds `SELECT` and `INSERT` only, and RLS is forced.
Both need `payroll.registers.generate` held Agency-wide, which migration
0187 seeds for the Payroll Register (#353).

- _Reading_: hris-controls.md §6.10 names no permission for remittance
  schedules, and #12's story 10 has the Payroll Preparer produce "the
  register, variance report and remittance schedules" together, so they share
  `payroll.registers.generate`.
- _Reading_: "the Agency and Employee contribution summary" is the summary of
  the Employee's share and the Agency's share as employer of each type, the
  two shares a Contribution Line holds; the per-Employee detail is on the
  schedules.
- _Reading_: the artifacts name Employees by agency employee number and legal
  name and carry no government identifier, such as a GSIS, PhilHealth, or
  Pag-IBIG number. No issuer format is claimed, so none is required, and the
  identifiers stay behind their own access controls.
- _Reading_: the artifacts are small JSON and hold no protected value, so
  they are stored as `content` and not through the document service; the
  logical ERD's `document_id` and `status` are not used, and reading them is
  not separately audited, as with the Certified Payroll Review Export. A
  voided payroll's supersession of them arrives with the void transaction.

```sql
CREATE TABLE finalized_payroll_accounting_support_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL UNIQUE,
  calculation_version integer NOT NULL,
  calculation_hash text NOT NULL CHECK (calculation_hash ~ '^[0-9a-f]{64}$'),
  payroll_export_contract_version_id uuid NOT NULL
    REFERENCES payroll_export_contract_versions (id),
  content text NOT NULL,
  checksum text NOT NULL
    CHECK (checksum = encode(sha256(convert_to(content, 'UTF8')), 'hex')),
  employee_detail_content text NOT NULL,
  employee_detail_checksum text NOT NULL
    CHECK (employee_detail_checksum
           = encode(sha256(convert_to(employee_detail_content, 'UTF8')), 'hex')),
  generated_by_membership_id uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, generated_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE payroll_export_external_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  accounting_support_export_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('HANDED_OFF','RECEIVED','RETURNED','POSTED')),
  external_reference text CHECK (external_reference IS NULL OR btrim(external_reference) <> ''),
  evidence_document_version_id uuid,
  reason text,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome = 'HANDED_OFF'
         OR (external_reference IS NOT NULL AND evidence_document_version_id IS NOT NULL)),
  CHECK ((outcome = 'RETURNED') = (reason IS NOT NULL)
         AND (reason IS NULL OR btrim(reason) <> '')),
  FOREIGN KEY (agency_id, accounting_support_export_id)
    REFERENCES finalized_payroll_accounting_support_exports (agency_id, id),
  FOREIGN KEY (agency_id, evidence_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id)
);
```

A Finalized Payroll Accounting Support Export (#29, #355) is generated from a
`FINALIZED` Payroll Period by
`POST .../payroll-periods/:periodId/accounting-support-exports`, which needs
`payroll.accounting_exports.generate` held Agency-wide and claims no payroll
function. It locks the period, reads every result and Payroll Line of the
finalized calculation version, and writes the export and a
`PAYROLL_ACCOUNTING_EXPORT_GENERATED` Audit Event (idempotency key
`generated`) in one transaction. A period has one export: generating again,
by anyone permitted, returns the stored one, its checksums unchanged, with
the outcomes recorded against it, and writes nothing. Migration 0189 adds
`FINALIZED_PAYROLL_ACCOUNTING_SUPPORT_EXPORT` version 1 to the contract
versions.

It reuses #636's Classified Payroll Export Lines and Payroll Export
Reconciliation unchanged, bound to the calculation hash of the certification
the payroll was finalized under (_reading_: finalization verified the results
against that certification, section 11, so it is the hash of the finalized
result). `content` is canonical JSON like the review export's. It carries
the contract, a statement that it is not a journal entry, claims no debit,
credit, or posting, and that neither generating nor downloading it records
that a receiving system received, accepted, or posted it, the period, the
finalization, the classified lines, the reconciliation, and the Employee
Detail Companion's checksum, which ties the two artifacts. It holds no
employee-level detail.

The Employee Detail Companion is `employee_detail_content`: canonical JSON
naming the export, with one entry per result, ordered by agency employee
number, giving the Employee's number and legal name at generation, the
result's gross, deductions, and net, and its own classified lines. Its
`totals`, the employees' classified lines and reconciliations summed, must
equal the export's classified lines and reconciliation, as part of the same
reconciliation (_reading_: the glossary has the reconciliation prove
"companion-detail totals agree before a payroll Structured Export is
generated", so the companion is generated and reconciled with every export,
and what is optional is obtaining it, under its own permission). A
reconciliation failure refuses with `PAYROLL_EXPORT_RECONCILIATION_FAILED` and
stores nothing; a period that is not `FINALIZED` is refused with
`PAYROLL_ACCOUNTING_EXPORT_PAYROLL_NOT_FINALIZED`.

`GET .../accounting-support-exports/:exportId/content` downloads the export
and needs `payroll.accounting_exports.generate`.
`GET .../accounting-support-exports/:exportId/employee-detail` downloads the
companion and needs `payroll.export_detail.read`. Each
download is a `PAYROLL_ACCOUNTING_EXPORT_DOWNLOADED` Audit Event naming the
artifact and its checksum, and records no outcome.

A Payroll Export External Outcome is append-only evidence recorded by hand by
`POST .../accounting-support-exports/:exportId/external-outcomes`, which needs
`payroll.export_outcomes.record` and claims no payroll function.
`HANDED_OFF` records a handoff and may name an external reference and
evidence. `RECEIVED`, `RETURNED`, and `POSTED` are externally evidenced, so
each names the external reference, such as a JEV number, and the exact
finalized Document Version of the Agency that evidences it, refused with
`PAYROLL_EXPORT_OUTCOME_EVIDENCE_INVALID` otherwise. A return also gives its
reason (_reading_: the glossary names a handoff and an externally evidenced
receipt, return, or posting, and #29 lists the external reference, outcome,
evidence, actor, and timestamp; the reason on a return follows the checkpoint
review). Outcomes may come in any order and any number; each is a
`PAYROLL_EXPORT_EXTERNAL_OUTCOME_RECORDED` Audit Event, and none changes the
export. Outcomes are recorded against this export only; the Certified Payroll
Review Export's outcomes are its checkpoint reviews.

Triggers keep the export immutable, even for the database owner, admitting
it only for a `FINALIZED` period at its calculation version, and reject every
`UPDATE` and `DELETE` of an outcome. `hris_app` holds `SELECT` and `INSERT`
on both. Migration 0189 grants the three permissions Agency-wide to the
Accounting Reviewer only. A voided payroll's supersession of its export
(#643) is not built yet, so the table has no `superseded_at` and
`payroll_period_id` is UNIQUE.

```sql
CREATE TABLE legacy_register_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  calculation_version integer NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count > 0),
  compared_by_membership_id uuid NOT NULL,
  compared_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, compared_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (payroll_period_id, content_hash),
  UNIQUE (agency_id, id)
);

CREATE TABLE legacy_register_differences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  legacy_register_comparison_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  pay_component_id uuid NOT NULL REFERENCES pay_components (id),
  legacy_amount numeric(19,4),
  payroll_amount numeric(19,4),
  CHECK (legacy_amount IS DISTINCT FROM payroll_amount),
  FOREIGN KEY (agency_id, legacy_register_comparison_id)
    REFERENCES legacy_register_comparisons (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (legacy_register_comparison_id, employee_id, pay_component_id),
  UNIQUE (agency_id, id)
);
```

A Legacy Register Comparison (#12 story 12, #359) compares a legacy payroll
register with a `FINALIZED` Payroll Period by Employee and pay component. It
only reports differences and decides neither value is right. No document
defines a legacy register's format or which states may be compared, so
(_reading_) the file is LingkodHR's own, and only a `FINALIZED` payroll is
compared, because its lines no longer change.

`POST .../payroll-periods/:periodId/legacy-register-comparisons` takes the file
as the multipart field `file`, at most 5 MiB, and needs
`payroll.legacy_registers.compare` held Agency-wide. It claims no payroll
function. The file is UTF-8 CSV with the header
`employee_number,component_code,amount`, then one row per Employee and
component: the Agency's employee number, a `pay_components` code, both matched
case-insensitively, and a peso amount with up to two decimal places, signed as
the legacy register states it. The import refuses the whole file with
`LEGACY_REGISTER_INVALID` and every reason by line when the file isn't UTF-8,
the header is wrong, there are no rows, a row has the wrong field count, a
value is missing, an amount is malformed, an Employee and component appear
twice, or an employee number or component code is unknown. A refused file
writes nothing. A period that is not `FINALIZED` is refused with
`LEGACY_REGISTER_PAYROLL_NOT_FINALIZED`.

The payroll side of an Employee and component is the sum of its Payroll
Lines in the period's `FINALIZED` results at the finalized calculation
version, adjustment lines included. In one transaction, which holds the
period `FOR SHARE`, the import writes the comparison, one difference for
every Employee and component whose two amounts differ, and a
`LEGACY_REGISTER_COMPARED` Audit Event. A difference stores both values. An
amount is `NULL` where its side has none: the register has no row, or the
payroll no line, for that Employee and component. Matching amounts aren't
stored. The import writes no other table. The file itself is not stored: the
comparison keeps its SHA-256 as `content_hash` and its `row_count`. The same
file compared with the same period gives the same differences, so importing it
again returns the stored comparison and writes nothing.
`GET .../legacy-register-comparisons` lists a period's comparisons with their
difference counts, and `GET .../legacy-register-comparisons/:comparisonId`
reads one with its differences. Both need the same permission.

Migration 0195 creates both tables with forced RLS. Triggers admit a
comparison only for a `FINALIZED` period at its calculation version, admit a
difference only in the transaction that writes its comparison, and reject
every `UPDATE` and `DELETE` of either. `hris_app` holds `SELECT` and `INSERT`
on both. The migration grants the permission Agency-wide to the Payroll
Preparer only.

Files are stored through the shared document service.

---

## 13. RLS and Sensitive Access

RLS isolates agencies on every Agency-owned table. The three platform-wide
tables in sections 1 and 2, and `payroll_export_contract_versions` in section
12, have no Agency policy: their protection is the grant, `SELECT` only for
`hris_app` (ADR 0013).

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
- Payment Exports, whose CSV carries full account numbers, so
  `payroll.payment_exports.generate` is its bank-detail control and each
  download is audited;
- the Finalized Payroll Accounting Support Export, its Employee Detail
  Companion, which holds employee-level pay, and its Payroll Export External
  Outcomes, each under its own permission;
- Disbursement Outcomes;
- Legacy Register Comparisons, which hold employee-level pay.

A permission is not enough on its own: `payroll_period_actors` keeps each
person to one payroll function on a Payroll Period (section 5).
