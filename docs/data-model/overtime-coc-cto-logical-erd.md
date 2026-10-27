# Overtime, COC, and CTO Logical ERD

**Document status:** Draft for review  
**Model level:** Logical ERD  
**Primary profile:** Civilian Philippine National Government Agency  
**Version:** 1.0  
**Date:** August 6, 2026

---

## Shared logical conventions

- Primary keys use UUIDs.
- All agency-owned operational records carry `agency_id`.
- Timestamps are stored in UTC and displayed in Philippine Standard Time by default.
- Status values are constrained enums or reference values, never unrestricted text.
- Effective-dated records use `effective_from` and nullable `effective_to`.
- `created_at`, `created_by_membership_id`, `updated_at`, and `updated_by_membership_id` are included where a record is mutable.
- Ledger, issued, certified, finalized, and audit records are append-only after posting.
- Sensitive values are encrypted or tokenized and are omitted from ordinary logs.
- Normal application deletion is restricted. Historical transactions are voided, superseded, deactivated, or archived.
- PostgreSQL Row-Level Security and physical indexes will be specified in the physical-schema phase.
- Cross-module actions go through owning application services rather than direct table updates.


## Relationship diagram

```mermaid
erDiagram
    OVERTIME_AUTHORITIES ||--o{ OVERTIME_AUTHORITY_EMPLOYEES : covers
    EMPLOYEES ||--o{ OVERTIME_AUTHORITY_EMPLOYEES : included
    OVERTIME_AUTHORITY_EMPLOYEES ||--o{ OVERTIME_SERVICE_RECORDS : renders
    OVERTIME_SERVICE_RECORDS ||--o{ COC_EARNED_CERTIFICATE_LINES : credited_by
    COC_EARNED_CERTIFICATES ||--|{ COC_EARNED_CERTIFICATE_LINES : contains
    EMPLOYEES ||--o{ COC_ACCOUNTS : holds
    COC_ACCOUNTS ||--o{ COC_LEDGER_ENTRIES : records
    COC_ACCOUNTS ||--o{ CTO_REQUESTS : funds
    COC_EARNED_CERTIFICATES ||--o{ COC_LEDGER_ENTRIES : awards
```

# Entity definitions

## `overtime_authorities`

Prior authorization for overtime service

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | Authority |
| agency_id | uuid | No | FK agencies | Tenant |
| requesting_unit_id | uuid | No | FK organization_units | Office |
| authority_no | string | No |  | Reference |
| purpose | string | No |  | Necessity |
| work_date_from | date | No |  | First Work Date |
| work_date_to | date | No |  | Last Work Date |
| compensation_method | enum | No |  | COC, OVERTIME_PAY; proposed in draft, fixed at approval |
| funding_reference | string | Yes |  | Required for OVERTIME_PAY |
| status | enum | No |  | DRAFT, SUBMITTED, FOR_REVIEW, APPROVED, REJECTED, CANCELLED |
| approved_by_membership_id | uuid | Yes | FK agency_memberships | Approver |
| approved_at | datetime | Yes |  | Approval |

**Constraints and indexes**

- Unique `(agency_id, authority_no)`.
- Last Work Date on or after the first.
- Approval refuses `OVERTIME_PAY` until Payroll supports it (#347).
- In effect and ended are derived from the Work Dates, not stored.

**Deletion behavior:** Retain.
## `overtime_authority_employees`

Employees covered by authority

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | Coverage |
| agency_id | uuid | No | FK agencies | Tenant |
| overtime_authority_id | uuid | No | FK overtime_authorities | Authority |
| employee_id | uuid | No | FK employees | Employee |
| authorized_hours | decimal | No |  | Total across the authority |
| task_description | string | Yes |  | Assigned work |
| eligibility_snapshot | json | Yes |  | System-derived facts and reviewer attestations, written at approval |

**Constraints and indexes**

- Unique `(overtime_authority_id, employee_id)`.

**Deletion behavior:** Retain.
## `overtime_service_records`

Actual overtime rendered

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | Service |
| agency_id | uuid | No | FK agencies | Tenant |
| overtime_authority_employee_id | uuid | No | FK overtime_authority_employees | Coverage |
| employee_id | uuid | No | FK employees | Employee |
| work_date | date | No |  | Work Date |
| claimed_hours | decimal | No |  | Claim |
| accomplishment | string | No |  | Output |
| actual_hours | decimal | Yes |  | Actual Overtime Hours, from locked Attendance at submission |
| source_attendance_day_id | uuid | Yes | FK attendance_days | Locked day version read |
| day_classification | string | Yes |  | From the source day version |
| certified_hours | decimal | Yes |  | Certified Overtime Hours |
| decline_reason | string | Yes |  | Required when not certified |
| status | enum | No |  | RENDERED, FOR_CERTIFICATION, CERTIFIED, NOT_CERTIFIED |
| recorded_by_membership_id | uuid | No | FK agency_memberships | Recorder |
| certified_by_membership_id | uuid | Yes | FK agency_memberships | Certifier |

**Constraints and indexes**

- One record per Employee and Work Date that is not `NOT_CERTIFIED`, across authorities.
- Certified hours do not exceed actual hours; an Employee's certified hours across an authority do not exceed authorized hours.

**Deletion behavior:** Retain.
## `coc_earned_certificates`

Monthly award of COC for one Employee, owned by Overtime

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | Certificate |
| agency_id | uuid | No | FK agencies | Tenant |
| employee_id | uuid | No | FK employees | Employee |
| earned_month | date | No |  | First day of the month |
| status | enum | No |  | DRAFT, FOR_APPROVAL, APPROVED, DISCARDED |
| prepared_by_membership_id | uuid | No | FK agency_memberships | Preparer |
| approved_by_membership_id | uuid | Yes | FK agency_memberships | Approver |
| approved_at | datetime | Yes |  | Approval and award |

**Constraints and indexes**

- Approver is neither the preparer nor the covered Employee.
- Approval awards COC through the COC module in the same transaction, keyed by the certificate.

**Deletion behavior:** Retain; an approved certificate is corrected only by COC adjustment or reversal.
## `coc_earned_certificate_lines`

One certified service record on a certificate

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | Line |
| agency_id | uuid | No | FK agencies | Tenant |
| coc_earned_certificate_id | uuid | No | FK coc_earned_certificates | Certificate |
| overtime_service_record_id | uuid | No | FK overtime_service_records | Certified service |
| certified_hours | decimal | No |  | Hours submitted for credit |
| credited_hours | decimal | Yes |  | Returned by the COC module at approval |
| excess_hours | decimal | Yes |  | Certified but not credited because of a cap |
| released_at | datetime | Yes |  | Set when a draft is discarded |

**Constraints and indexes**

- One unreleased line per service record.
- Lines are the Employee's `CERTIFIED` records under `COC` authorities with Work Dates in the certificate's month.

**Deletion behavior:** Retain.
## `coc_accounts`

Employee COC account

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | COC account |
| agency_id | uuid | No | FK agencies | Tenant |
| employee_id | uuid | No | FK employees | Employee |
| status | enum | No |  | ACTIVE, FROZEN, CLOSED |
| opened_at | date | No |  | Open |
| closed_at | date | Yes |  | Close |

**Constraints and indexes**

- Unique active account per employee.

**Deletion behavior:** Close.
## `coc_ledger_entries`

Immutable COC transaction

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | Entry |
| agency_id | uuid | No | FK agencies | Tenant |
| coc_account_id | uuid | No | FK coc_accounts | Account |
| entry_type | enum | No |  | EARNED, USED, ADJUSTMENT, EXPIRATION, REVERSAL |
| quantity_hours | decimal | No |  | Signed hours |
| effective_date | date | No |  | Date |
| source_type | string | No |  | Source |
| source_id | uuid | No |  | Source ID |
| reverses_entry_id | uuid | Yes | FK coc_ledger_entries | Original |
| expires_at | date | Yes |  | Expiry |
| posted_at | datetime | No |  | Posted |

**Constraints and indexes**

- Unique source key for idempotency.
- Reversal references same account.

**Deletion behavior:** Never delete.
## `cto_requests`

Use COC as compensatory time off

| Column | Logical type | Null? | Key / rule | Description |
| --- | --- | --- | --- | --- |
| id | uuid | No | PK | Request |
| agency_id | uuid | No | FK agencies | Tenant |
| employee_id | uuid | No | FK employees | Employee |
| coc_account_id | uuid | No | FK coc_accounts | Account |
| date_from | datetime | No |  | Start |
| date_to | datetime | No |  | End |
| requested_hours | decimal | No |  | Hours |
| approved_hours | decimal | Yes |  | Approved |
| status | enum | No |  | DRAFT, SUBMITTED, FOR_RECOMMENDATION, FOR_APPROVAL, APPROVED, REJECTED, POSTED, CANCELLED |
| posted_ledger_entry_id | uuid | Yes | FK coc_ledger_entries | Usage entry |
| attendance_day_id | uuid | Yes | FK attendance_days | Attendance effect |

**Constraints and indexes**

- Approved/posting requires available COC balance.
- No overlap with incompatible attendance or leave.

**Deletion behavior:** Retain.

# Domain invariants

- Prior authority is separate from actual service and compensation.
- Claimed, authorized, actual, certified, credited, and paid hours remain distinct.
- COC is awarded only by an approved Certificate of COC Earned; there is no per-record compensation decision.
- COC is an immutable ledger.
- CTO posting consumes COC and creates an attendance effect through owning services.
