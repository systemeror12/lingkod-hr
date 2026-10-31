# Overtime, COC, and CTO Physical Schema

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---

## 1. Overtime Authorities

```sql
CREATE TABLE overtime_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  requesting_unit_id uuid NOT NULL,
  authority_no citext NOT NULL,
  purpose text NOT NULL,
  work_date_from date NOT NULL,
  work_date_to date NOT NULL,
  compensation_method text NOT NULL
    CHECK (compensation_method IN ('COC','OVERTIME_PAY')),
  funding_reference text,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','FOR_REVIEW','APPROVED','REJECTED','CANCELLED')),
  approved_by_membership_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_date_to >= work_date_from),
  CHECK (compensation_method = 'COC' OR funding_reference IS NOT NULL),
  CHECK (status <> 'APPROVED' OR (approved_by_membership_id IS NOT NULL AND approved_at IS NOT NULL)),
  FOREIGN KEY (agency_id, requesting_unit_id)
    REFERENCES organization_units (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, authority_no),
  UNIQUE (agency_id, id)
);

CREATE TABLE overtime_authority_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  overtime_authority_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  authorized_hours numeric(12,4) NOT NULL CHECK (authorized_hours > 0),
  task_description text,
  eligibility_snapshot jsonb,
  FOREIGN KEY (agency_id, overtime_authority_id)
    REFERENCES overtime_authorities (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (overtime_authority_id, employee_id),
  UNIQUE (agency_id, id)
);
```

`compensation_method` is proposed in the draft and fixed when the Approving Official approves. Approval refuses `OVERTIME_PAY` until #347. An approved authority is in effect from the later of its Asia/Manila approval date and its first Work Date, through its last Work Date, and has ended after that; neither is a stored status. `authorized_hours` is the Employee's total across the authority. `eligibility_snapshot` is written once at approval and holds the system-derived facts and the reviewer's attestations listed in `hris-controls.md` §5.16. Approved authorities and their covered Employees are immutable; an `APPROVED` authority's status can only move to `CANCELLED`, and a snapshot is filled only while its authority is `FOR_REVIEW`.

Review records its attestations on the `OVERTIME_AUTHORITY_REVIEWED` Audit Event and opens the authority's Approval Request (subject type `OVERTIME_AUTHORITY`, route code `OVERTIME_AUTHORITY`, exactly one step); the event also stores that request's id. Approval copies the attestations from the event into each snapshot, and approve and reject decide only that request ([ADR 0010](../../adr/0010-overtime-review-result-on-its-audit-event.md)). The preparers and submitter that review and approval exclude are the actors of the authority's create, update, and submit Audit Events, so no column records them; review is refused when the route step its request resolves is assigned to one of them. The generic Approval API cannot create, approve, reject, or cancel the request. Each snapshot holds `service` (one entry per Service Segment over the Work Dates: appointment status, salary grade, position item number, and the title and employment category of the `ACTIVE` or `SUPERSEDED` Plantilla Position Version in effect on the segment's first covered Work Date), `workArrangements` (one entry per Schedule Assignment over the Work Dates), and `attestation`.

---

## 2. Overtime Service Records

```sql
CREATE TABLE overtime_service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  overtime_authority_employee_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  claimed_hours numeric(12,4) NOT NULL CHECK (claimed_hours > 0),
  accomplishment text NOT NULL,
  actual_minutes integer CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  source_attendance_day_id uuid,
  day_classification text,
  certified_minutes integer CHECK (certified_minutes IS NULL OR certified_minutes >= 0),
  decline_reason text,
  status text NOT NULL
    CHECK (status IN ('RENDERED','FOR_CERTIFICATION','CERTIFIED','NOT_CERTIFIED')),
  recorded_by_membership_id uuid NOT NULL,
  certified_by_membership_id uuid,
  certified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'RENDERED'
         OR (actual_minutes IS NOT NULL AND source_attendance_day_id IS NOT NULL AND day_classification IS NOT NULL)),
  CHECK ((status = 'CERTIFIED') = (certified_minutes IS NOT NULL)),
  CHECK (certified_minutes IS NULL OR certified_minutes <= actual_minutes),
  CHECK ((status = 'NOT_CERTIFIED') = (decline_reason IS NOT NULL)),
  FOREIGN KEY (agency_id, overtime_authority_employee_id)
    REFERENCES overtime_authority_employees (agency_id, id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, source_attendance_day_id)
    REFERENCES attendance_days (agency_id, id),
  FOREIGN KEY (agency_id, recorded_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, certified_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX overtime_service_one_live_per_date_uq
ON overtime_service_records (agency_id, employee_id, work_date)
WHERE status <> 'NOT_CERTIFIED';
```

Actual and certified time are whole minutes, as Attendance counts them, so the COC award needs no rounding (ADR 0009). Submitting reads `actual_minutes`, `day_classification`, and `source_attendance_day_id` through Attendance's application service from the latest locked Attendance Period Version covering the Work Date; `day_classification` is the Work Date's holiday classification when it has one, else `WORKDAY` or `REST_DAY` from its Day Rule. Certifying re-reads them and is refused if the source day version has changed. The Employee's certified minutes across one authority may not exceed `authorized_hours` × 60; the certify service checks this under a lock on the `overtime_authority_employees` row.

---

## 3. Certificates of COC Earned

```sql
CREATE TABLE coc_earned_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  earned_month date NOT NULL CHECK (earned_month = date_trunc('month', earned_month)::date),
  status text NOT NULL
    CHECK (status IN ('DRAFT','FOR_APPROVAL','APPROVED','DISCARDED')),
  prepared_by_membership_id uuid NOT NULL,
  approved_by_membership_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'APPROVED') = (approved_by_membership_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (approved_by_membership_id IS DISTINCT FROM prepared_by_membership_id),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, prepared_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE coc_earned_certificate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  coc_earned_certificate_id uuid NOT NULL,
  overtime_service_record_id uuid NOT NULL,
  certified_minutes integer NOT NULL CHECK (certified_minutes > 0),
  credited_minutes numeric(12,1) CHECK (credited_minutes IS NULL OR credited_minutes >= 0),
  excess_minutes numeric(12,1) CHECK (excess_minutes IS NULL OR excess_minutes >= 0),
  released_at timestamptz,
  FOREIGN KEY (agency_id, coc_earned_certificate_id)
    REFERENCES coc_earned_certificates (agency_id, id),
  FOREIGN KEY (agency_id, overtime_service_record_id)
    REFERENCES overtime_service_records (agency_id, id),
  UNIQUE (coc_earned_certificate_id, overtime_service_record_id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX coc_earned_certificate_lines_one_active_uq
ON coc_earned_certificate_lines (overtime_service_record_id)
WHERE released_at IS NULL;
```

The Overtime module owns certificates. Each line is a `CERTIFIED` record of the certificate's Employee, under a `COC` authority, with a Work Date in `earned_month`. Discarding a draft sets `released_at` on its lines. Approval calls the COC module once, keyed by the certificate, which applies the ratio, caps, and validity, writes the earned COC with the certificate as its source, and returns each line's `credited_minutes` and `excess_minutes`, which are COC after the ratio. Approval is refused when the certificate's Valid Until, December 31 of the year after `earned_month`, has already passed. An approved certificate and its lines are immutable. A repeat call for an awarded certificate writes nothing and returns only its stored entries, refused if they belong to another Employee or name a line the call lacks; the certificate's `FOR_APPROVAL` to `APPROVED` transition is what makes the award happen once. There is no per-record compensation decision.

---

## 4. COC Ledger

```sql
CREATE TABLE coc_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','CLOSED')),
  opened_at date NOT NULL,
  closed_at date,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX coc_accounts_one_active_uq
ON coc_accounts (agency_id, employee_id)
WHERE status = 'ACTIVE';
```

An account covers one continuous period of employment in the Agency. The first certificate approval opens it. Forfeiture on separation or transfer out closes it, and a later reemployment opens a new one.

```sql
CREATE TABLE coc_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  coc_account_id uuid NOT NULL,
  minutes numeric(12,1) NOT NULL CHECK (minutes <> 0),
  effective_date date NOT NULL,
  valid_until date NOT NULL,
  earned_month date,
  source_type citext NOT NULL CHECK (btrim(source_type::text) <> ''),
  source_id uuid NOT NULL,
  source_posting_key citext NOT NULL
    CHECK (btrim(source_posting_key::text) <> ''),
  rule_code text NOT NULL,
  reason text,
  supporting_document_version_id uuid,
  reverses_entry_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by_membership_id uuid,
  CHECK (valid_until = make_date(extract(year FROM valid_until)::int, 12, 31)),
  CHECK (earned_month IS NULL OR (
    earned_month = date_trunc('month', earned_month)::date
    AND valid_until = make_date(extract(year FROM earned_month)::int + 1, 12, 31)
    AND minutes > 0 AND reverses_entry_id IS NULL)),
  CHECK (minutes < 0 OR earned_month IS NOT NULL OR reverses_entry_id IS NOT NULL),
  FOREIGN KEY (agency_id, coc_account_id)
    REFERENCES coc_accounts (agency_id, id),
  FOREIGN KEY (agency_id, supporting_document_version_id)
    REFERENCES document_versions (agency_id, id),
  FOREIGN KEY (agency_id, reverses_entry_id)
    REFERENCES coc_ledger_entries (agency_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, posted_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (
    agency_id, coc_account_id,
    source_type, source_id, source_posting_key
  ),
  UNIQUE (agency_id, id)
);

CREATE UNIQUE INDEX coc_ledger_entries_one_reversal_uq
ON coc_ledger_entries (agency_id, reverses_entry_id)
WHERE reverses_entry_id IS NOT NULL;
```

Attach immutable mutation-prevention triggers. A reviewed trigger requires a reversal to use the same account, `valid_until`, and exact opposite minutes as its original. There is no entry-type enum; the source names what an entry is (ADR 0009):

| Source                    | Sign | Effective date            | Posting key                 |
| ------------------------- | ---- | ------------------------- | --------------------------- |
| Certificate of COC Earned | +    | Approval date             | Certificate line            |
| CTO Request approval      | −    | CTO Work Date             | Work Date and `valid_until` |
| CTO cancellation          | +    | CTO Work Date             | Reversed entry              |
| COC adjustment            | −    | Adjustment date           | Adjustment                  |
| COC reversal              | +    | Original's effective date | Original entry              |
| Expiry run                | −    | Day after `valid_until`   | `valid_until`, then `#2`... |
| Separation Case           | −    | Separation effective date | `valid_until`               |

`rule_code` names the national rule version applied; adjustments and reversals record `HRIS_CONTROL_COC_CORRECTION` because no national rule applies. `earned_month` is set only on a certificate award, so the monthly cap counts the month's credited COC from the ledger under the account lock, without reading certificates. Adjustments and reversals require `reason` and `supporting_document_version_id`. Only a certificate posts new credit; an adjustment is negative, and a reversal may only negate a negative entry.

Every balance-sensitive command locks the account, recomputes within the transaction, and writes no entry that would make the balance for any `valid_until` negative. A use draws from the earliest `valid_until` on or after its Work Date. An adjustment's `source_type` is `COC_ADJUSTMENT`, and it draws from one `valid_until` still valid on its date. A reversal's is `COC_REVERSAL`, with the original as its `source_id` and posting key; only `COC_ADJUSTMENT` and `COC_EXPIRY` entries are reversible, on an `ACTIVE` account. A reversal restoring COC whose `valid_until` has passed is followed by an expiry entry in the same transaction. The expiry job is idempotent through its posting key: its `source_type` is `COC_EXPIRY`, its `source_id` is the account, and `posted_by_membership_id` is null because System posts it. Restored COC can expire again, so the first expiry's key is the `valid_until` and each later one adds its ordinal (`2025-12-31#2`); under the account lock, a retry finds nothing remaining. `post_coc_expiry` is the one command, run in the caller's transaction and Agency Context. `coc_expiries_due`, the only cross-Agency read, is a `SECURITY DEFINER` function that returns identifiers. It is granted to `hris_app` as a deliberate exception to Agency isolation, because the worker sweep must find due expiries in every Agency; each posting still runs in its Agency's context.

A balance as of a date states its cutoff. It counts entries effective on or before the cutoff whose `valid_until` is on or after it, so COC past its Valid Until never counts, even before its expiry entry is posted:

```sql
SELECT valid_until, SUM(minutes) AS minutes
FROM coc_ledger_entries
WHERE agency_id = $1 AND coc_account_id = $2
  AND effective_date <= $3 AND valid_until >= $3
GROUP BY valid_until;
```

The 120-hour cap reads it as of the certificate's approval date. A certificate approval dated before the account's latest certificate entry is refused, so a back-dated award cannot raise the balance under a later award's cap. Service on or before a `CLOSED` account's `closed_at` belongs to the forfeited period and is refused rather than opening a new account. The balance available for a CTO date reads all entries, including future-dated uses, for `valid_until` on or after that date.

---

## 5. CTO Requests

```sql
CREATE TABLE cto_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  coc_account_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('DRAFT','SUBMITTED','FOR_APPROVAL','APPROVED','REJECTED','CANCELLED')),
  approved_by_membership_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((approved_at IS NULL) = (approved_by_membership_id IS NULL)),
  CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL),
  FOREIGN KEY (agency_id, employee_id)
    REFERENCES employees (agency_id, id),
  FOREIGN KEY (agency_id, coc_account_id)
    REFERENCES coc_accounts (agency_id, id),
  FOREIGN KEY (agency_id, approved_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE cto_request_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  cto_request_id uuid NOT NULL,
  work_date date NOT NULL,
  unit text NOT NULL CHECK (unit IN ('WHOLE','HALF')),
  starts_at timestamptz,
  ends_at timestamptz,
  charged_minutes integer NOT NULL CHECK (charged_minutes > 0),
  attendance_cto_input_id uuid,
  cancelled_by_cto_cancellation_id uuid,
  CHECK (
    (unit = 'WHOLE' AND starts_at IS NULL AND ends_at IS NULL)
    OR (unit = 'HALF' AND ends_at > starts_at)
  ),
  FOREIGN KEY (agency_id, cto_request_id)
    REFERENCES cto_requests (agency_id, id),
  UNIQUE (cto_request_id, work_date),
  UNIQUE (agency_id, id)
);

CREATE TABLE cto_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  cto_request_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('RECALL','EMPLOYEE_REQUEST')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  cancelled_by_membership_id uuid NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, cto_request_id)
    REFERENCES cto_requests (agency_id, id),
  FOREIGN KEY (agency_id, cancelled_by_membership_id)
    REFERENCES agency_memberships (agency_id, id),
  UNIQUE (agency_id, id)
);

ALTER TABLE cto_request_dates
ADD FOREIGN KEY (agency_id, cancelled_by_cto_cancellation_id)
  REFERENCES cto_cancellations (agency_id, id);
```

`charged_minutes` is the Work Date's expected-duty minutes for `WHOLE`, or half of them for `HALF`, read from the Employee's Work Schedule Version through Attendance at submission and rechecked at approval. A `HALF` interval lies inside expected duty. A request holds at most five consecutive Work Dates, and an Employee has at most one uncancelled date per Work Date across requests in `SUBMITTED`, `FOR_APPROVAL`, or `APPROVED`; the owning service enforces both.

Approval locks the COC Account, rechecks the balance valid on each Work Date, posts one negative entry per Work Date and `valid_until` drawn, and creates one Attendance CTO input per Work Date, retaining `attendance_cto_input_id`, all in one transaction. A Work Date in a locked Attendance Period refuses approval.

A cancellation names the request's dates it cancels. It reverses each cancelled date's entries and asks Attendance for a zero successor input, or for a `CTO_INPUT` locked correction when the date's period is locked. The request becomes `CANCELLED` when no uncancelled date remains.
