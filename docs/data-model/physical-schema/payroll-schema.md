# Government Payroll Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---


## 1. Salary Schedules

```sql
CREATE TABLE salary_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  issuance_reference text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE salary_grade_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  salary_schedule_id uuid NOT NULL,
  salary_grade integer NOT NULL CHECK (salary_grade > 0),
  salary_step integer NOT NULL CHECK (salary_step > 0),
  monthly_rate numeric(19,4) NOT NULL CHECK (monthly_rate > 0),
  daily_rate_rule jsonb,
  FOREIGN KEY (agency_id, salary_schedule_id)
    REFERENCES salary_schedules (agency_id, id),
  UNIQUE (salary_schedule_id, salary_grade, salary_step),
  UNIQUE (agency_id, id)
);
```

Add an exclusion constraint for overlapping active salary schedules in the same payroll profile if the agency can maintain multiple profiles.

---

## 2. Pay Components and Rules

```sql
CREATE TABLE pay_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  name text NOT NULL,
  category text NOT NULL
    CHECK (category IN ('EARNING','DEDUCTION','EMPLOYER_SHARE','INFORMATIONAL')),
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  current_rule_version_id uuid,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id)
);

CREATE TABLE pay_component_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  pay_component_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  calculation_method text NOT NULL
    CHECK (calculation_method IN ('FIXED','RATE','FORMULA','TABLE','MANUAL')),
  tax_treatment jsonb NOT NULL,
  contribution_treatment jsonb NOT NULL,
  accounting_category text,
  rule_definition jsonb NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL
    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (agency_id, pay_component_id)
    REFERENCES pay_components (agency_id, id),
  UNIQUE (pay_component_id, version_no),
  UNIQUE (agency_id, id)
);
```

Rule definitions are validated and executed by a safe payroll rule engine, never by arbitrary SQL or JavaScript evaluation.

---

## 3. Employee Compensation

```sql
CREATE TABLE employee_compensations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  pay_component_id uuid NOT NULL,
  source_service_segment_id uuid,
  amount numeric(19,4),
  rate numeric(19,8),
  quantity_basis text,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (amount IS NOT NULL OR rate IS NOT NULL),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, pay_component_id)
    REFERENCES pay_components (agency_id, id),
  FOREIGN KEY (agency_id, source_service_segment_id)
    REFERENCES service_segments (agency_id, id),
  UNIQUE (agency_id, id)
);
```

Use exclusion constraints for single-instance components that must not overlap.

---

## 4. Payroll Input Inbox

```sql
CREATE TABLE payroll_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  source_module text NOT NULL
    CHECK (source_module IN ('ATTENDANCE','LEAVE','OVERTIME','PERSONNEL','MANUAL')),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  pay_component_id uuid NOT NULL,
  effective_date date NOT NULL,
  quantity numeric(12,4),
  amount numeric(19,4),
  status text NOT NULL
    CHECK (status IN ('PENDING','CONSUMED','CANCELLED','REVERSED')),
  payload_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, pay_component_id)
    REFERENCES pay_components (agency_id, id),
  UNIQUE (agency_id, source_module, source_type, source_id, pay_component_id),
  UNIQUE (agency_id, id)
);
```

Consumed inputs are immutable.

---

## 5. Payroll Periods

```sql
CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  code citext NOT NULL,
  payroll_profile text NOT NULL
    CHECK (payroll_profile IN ('PLANTILLA','CASUAL','CONTRACTUAL','JO_COS')),
  period_from date NOT NULL,
  period_to date NOT NULL,
  cutoff_at timestamptz NOT NULL,
  payment_date date NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','CALCULATING','FOR_REVIEW','CERTIFIED','APPROVED','FINALIZED','VOIDED')),
  calculation_version integer NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
  finalized_at timestamptz,
  voided_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (period_to >= period_from),
  UNIQUE (agency_id, code, calculation_version),
  UNIQUE (agency_id, id)
);
```

---

## 6. Rule Snapshots

```sql
CREATE TABLE payroll_rule_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  calculation_version integer NOT NULL,
  salary_schedule_id uuid NOT NULL,
  tax_rule_version text NOT NULL,
  contribution_rule_versions jsonb NOT NULL,
  pay_component_rule_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, salary_schedule_id)
    REFERENCES salary_schedules (agency_id, id),
  UNIQUE (payroll_period_id, calculation_version),
  UNIQUE (agency_id, id)
);
```

Snapshots are immutable.

---

## 7. Employee Payroll Results

```sql
CREATE TABLE payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  service_segment_id uuid,
  salary_grade_rate_id uuid,
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
  FOREIGN KEY (agency_id, service_segment_id)
    REFERENCES service_segments (agency_id, id),
  FOREIGN KEY (agency_id, salary_grade_rate_id)
    REFERENCES salary_grade_rates (agency_id, id),
  UNIQUE (payroll_period_id, employee_id),
  UNIQUE (agency_id, id)
);
```

---

## 8. Payroll Lines

```sql
CREATE TABLE payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_employee_id uuid NOT NULL,
  pay_component_id uuid NOT NULL,
  rule_version_id uuid,
  payroll_input_id uuid,
  line_type text NOT NULL
    CHECK (line_type IN ('EARNING','DEDUCTION','EMPLOYER_SHARE','INFORMATIONAL')),
  quantity numeric(12,4),
  rate numeric(19,8),
  amount numeric(19,4) NOT NULL,
  taxable_amount numeric(19,4) NOT NULL DEFAULT 0,
  contribution_base numeric(19,4) NOT NULL DEFAULT 0,
  source_snapshot jsonb NOT NULL,
  is_manual_override boolean NOT NULL DEFAULT false,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_manual_override OR override_reason IS NOT NULL),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  FOREIGN KEY (agency_id, pay_component_id)
    REFERENCES pay_components (agency_id, id),
  FOREIGN KEY (agency_id, rule_version_id)
    REFERENCES pay_component_rule_versions (agency_id, id),
  FOREIGN KEY (agency_id, payroll_input_id)
    REFERENCES payroll_inputs (agency_id, id),
  UNIQUE (agency_id, id)
);
```

A trigger prevents update/delete when the parent payroll period is `FINALIZED` or `VOIDED`.

---

## 9. Contributions, Tax, and Loans

```sql
CREATE TABLE contribution_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_employee_id uuid NOT NULL,
  contribution_type text NOT NULL,
  employee_share numeric(19,4) NOT NULL,
  employer_share numeric(19,4) NOT NULL,
  compensation_base numeric(19,4) NOT NULL,
  rule_version text NOT NULL,
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
  rule_version text NOT NULL,
  year_to_date_snapshot jsonb NOT NULL,
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  UNIQUE (payroll_employee_id)
);
```

Loan lines use a separate table because multiple deductions may exist.

---

## 10. Exceptions and Adjustments

```sql
CREATE TABLE payroll_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  payroll_period_id uuid NOT NULL,
  payroll_employee_id uuid,
  exception_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('WARNING','BLOCKING')),
  status text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','WAIVED')),
  details jsonb NOT NULL,
  resolved_by_membership_id uuid,
  FOREIGN KEY (agency_id, payroll_period_id)
    REFERENCES payroll_periods (agency_id, id),
  FOREIGN KEY (agency_id, payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id)
);
```

```sql
CREATE TABLE payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  original_payroll_employee_id uuid NOT NULL,
  target_payroll_period_id uuid,
  adjustment_type text NOT NULL
    CHECK (adjustment_type IN ('SUPPLEMENTAL','REFUND','RECOVERY','VOID_REPLACEMENT')),
  reason text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','APPROVED','POSTED','CANCELLED')),
  approved_by_membership_id uuid,
  FOREIGN KEY (agency_id, original_payroll_employee_id)
    REFERENCES payroll_employees (agency_id, id),
  FOREIGN KEY (agency_id, target_payroll_period_id)
    REFERENCES payroll_periods (agency_id, id)
);
```

---

## 11. Finalization Transaction

The database transaction must:

1. lock the payroll period;
2. verify status `APPROVED`;
3. verify `row_version` and approved calculation hash;
4. reject unresolved blocking exceptions;
5. verify totals against line sums;
6. mark employee results finalized;
7. mark payroll period finalized;
8. mark consumed payroll inputs;
9. append audit/outbox records;
10. commit before generating documents or emails.

---

## 12. Outputs

Create metadata tables for:

- payslips;
- payroll registers;
- remittance schedules;
- payment exports.

Files are stored through the shared document service.

---

## 13. RLS and Sensitive Access

RLS isolates agencies.

Application permissions separately control:

- compensation access;
- payroll preparation;
- certification;
- approval;
- finalization;
- payslip self-service;
- payment exports.
