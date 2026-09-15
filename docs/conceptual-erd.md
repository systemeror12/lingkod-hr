# Philippine Public-Sector HRIS MVP

## Conceptual Entity-Relationship Diagram

**Document status:** Draft for review  
**Source documents:** Public-Sector HRIS BRD v1.0, Workflow Specification v1.0, Controls Specification v1.0  
**Primary profile:** Civilian National Government Agency  
**Version:** 1.2
**Date:** September 15, 2026

---

# 1. Purpose

This document defines the conceptual data model for the Philippine Public-Sector HRIS MVP.

It identifies major entities, domain boundaries, relationships, and cardinalities. It does not yet define PostgreSQL data types, Prisma models, indexes, Row-Level Security policies, or migration scripts.

---

# 2. Modeling Principles

1. `AGENCY` is the tenant and ownership boundary.
2. `USER`, `AGENCY_MEMBERSHIP`, and `EMPLOYEE` are separate concepts.
3. A plantilla position exists independently from its incumbent.
4. Recruitment begins from an authorized vacant position.
5. Appointment issuance is separate from assumption to duty.
6. Personnel history is effective-dated and never silently overwritten.
7. Raw attendance events are separate from calculated attendance days.
8. Leave and COC balances use immutable ledger entries.
9. Finalized payroll lines are immutable.
10. Shared approvals never bypass domain validation.
11. Documents, audit events, notifications, and AI requests are cross-domain services.
12. Biometric-device integrations and biometric-file imports are outside MVP.

---

# 3. Cardinality Legend

```text
||  exactly one
o|  zero or one
|{  one or many
o{  zero or many
```

---

# 4. Consolidated High-Level ERD

```mermaid
erDiagram
    AGENCY ||--o{ ORGANIZATION_UNIT : contains
    AGENCY ||--o{ AGENCY_MEMBERSHIP : grants_access
    USER ||--o{ AGENCY_MEMBERSHIP : holds
    AGENCY_MEMBERSHIP ||--o{ MEMBERSHIP_ROLE : assigned
    ROLE ||--o{ MEMBERSHIP_ROLE : provides

    ORGANIZATION_UNIT ||--o{ PLANTILLA_POSITION : owns
    PLANTILLA_POSITION ||--o{ POSITION_HISTORY : changes_through
    PLANTILLA_POSITION ||--o{ REQUEST_TO_FILL : requested_for

    REQUEST_TO_FILL ||--o{ VACANCY_PUBLICATION : published_as
    VACANCY_PUBLICATION ||--o{ APPLICATION : receives
    APPLICANT ||--o{ APPLICATION : submits
    APPLICATION ||--o{ ASSESSMENT : evaluated_by
    APPLICATION ||--o{ INTERVIEW : interviewed_in
    VACANCY_PUBLICATION ||--o{ SELECTION_BOARD_SESSION : deliberated_in
    APPLICATION ||--o{ BOARD_RECOMMENDATION : receives

    APPLICATION ||--o| APPOINTMENT : may_result_in
    PLANTILLA_POSITION ||--o{ APPOINTMENT : appointed_to
    APPOINTMENT ||--o| OATH_OF_OFFICE : requires
    APPOINTMENT ||--o| ASSUMPTION_TO_DUTY : requires

    ASSUMPTION_TO_DUTY ||--o| EMPLOYEE : activates
    EMPLOYEE ||--o{ SERVICE_SEGMENT : has
    PLANTILLA_POSITION ||--o{ POSITION_INCUMBENCY : occupied_through
    EMPLOYEE ||--o{ POSITION_INCUMBENCY : serves_in
    EMPLOYEE ||--o{ PERSONNEL_ACTION : receives
    EMPLOYEE ||--o{ PDS_VERSION : maintains

    EMPLOYEE ||--o{ ATTENDANCE_EVENT : creates
    EMPLOYEE ||--o{ ATTENDANCE_CONTEXT : receives
    EMPLOYEE ||--o{ ATTENDANCE_DAY : summarized_into
    ATTENDANCE_DAY ||--o{ ATTENDANCE_DAY_SEGMENT : calculated_as
    ATTENDANCE_DAY ||--o{ ATTENDANCE_CORRECTION : corrected_by

    EMPLOYEE ||--o{ LEAVE_ACCOUNT : holds
    LEAVE_ACCOUNT ||--o{ LEAVE_LEDGER_ENTRY : records
    EMPLOYEE ||--o{ LEAVE_APPLICATION : submits

    OVERTIME_AUTHORITY ||--o{ OVERTIME_SERVICE_RECORD : authorizes
    EMPLOYEE ||--o{ OVERTIME_SERVICE_RECORD : renders
    EMPLOYEE ||--o{ COC_ACCOUNT : holds
    COC_ACCOUNT ||--o{ COC_LEDGER_ENTRY : records
    EMPLOYEE ||--o{ CTO_REQUEST : submits

    AGENCY ||--o{ PAYROLL_PERIOD : processes
    PAYROLL_PERIOD ||--o{ PAYROLL_EMPLOYEE : includes
    EMPLOYEE ||--o{ PAYROLL_EMPLOYEE : paid_through
    PAYROLL_EMPLOYEE ||--o{ PAYROLL_LINE : calculated_as
    PAYROLL_EMPLOYEE ||--o| PAYSLIP : produces

    AGENCY ||--o{ PERFORMANCE_CYCLE : runs
    EMPLOYEE ||--o{ INDIVIDUAL_COMMITMENT : owns
    PERFORMANCE_CYCLE ||--o{ INDIVIDUAL_COMMITMENT : contains
    INDIVIDUAL_COMMITMENT ||--o{ ACCOMPLISHMENT : records
    INDIVIDUAL_COMMITMENT ||--o{ PERFORMANCE_REVIEW : reviewed_by
    PERFORMANCE_REVIEW ||--o| PERFORMANCE_RATING : finalizes

    EMPLOYEE ||--o{ SEPARATION_CASE : subject_of
    SEPARATION_CASE ||--o{ CLEARANCE_TASK : requires

    AGENCY ||--o{ APPROVAL_REQUEST : owns
    APPROVAL_REQUEST ||--o{ APPROVAL_STEP : contains
    AGENCY ||--o{ DOCUMENT : owns
    AGENCY ||--o{ AUDIT_EVENT : records
    AGENCY ||--o{ NOTIFICATION : sends
    AGENCY ||--o{ AI_REQUEST : processes
```

---

# 5. Identity and Agency Domain

```mermaid
erDiagram
    AGENCY ||--o{ AGENCY_PROFILE_VERSION : configured_by
    AGENCY ||--o{ AGENCY_MEMBERSHIP : grants_access
    USER ||--o{ AGENCY_MEMBERSHIP : holds

    AGENCY_MEMBERSHIP ||--o{ MEMBERSHIP_ROLE : assigned
    ROLE ||--o{ MEMBERSHIP_ROLE : provides
    ROLE ||--o{ ROLE_PERMISSION : includes
    PERMISSION ||--o{ ROLE_PERMISSION : granted_as

    AGENCY_MEMBERSHIP ||--o{ DELEGATED_AUTHORITY : delegates
    AGENCY_MEMBERSHIP ||--o{ USER_SESSION : authenticates
    USER ||--o{ SECURITY_EVENT : generates
    AGENCY ||--o{ SECURITY_EVENT : owns
```

| Entity | Purpose |
| ------------------------ | -------------------------------------------------- |
| `AGENCY` | Root tenant and government-agency record |
| `AGENCY_PROFILE_VERSION` | Effective-dated agency rules and configuration |
| `USER` | Authenticated identity |
| `AGENCY_MEMBERSHIP` | Connects a user to an agency and optional employee |
| `ROLE` | Reusable role definition |
| `PERMISSION` | Atomic authorization capability |
| `MEMBERSHIP_ROLE` | Assigns roles to agency memberships |
| `ROLE_PERMISSION` | Assigns permissions to roles |
| `DELEGATED_AUTHORITY` | Time-bound acting or delegated authority |
| `USER_SESSION` | Active authenticated session |
| `SECURITY_EVENT` | Login, lockout, role change, or revocation event |

---

# 6. Organization and Plantilla Domain

```mermaid
erDiagram
    AGENCY ||--o{ ORGANIZATION_UNIT : contains
    ORGANIZATION_UNIT ||--o{ ORGANIZATION_UNIT : parent_of
    ORGANIZATION_UNIT ||--o{ ORGANIZATION_UNIT_HISTORY : changes_through

    ORGANIZATION_UNIT ||--o{ PLANTILLA_POSITION : owns
    PLANTILLA_POSITION ||--o{ POSITION_HISTORY : changes_through
    PLANTILLA_POSITION ||--|| QUALIFICATION_STANDARD : governed_by
    PLANTILLA_POSITION ||--o{ POSITION_DOCUMENT : supported_by

    PLANTILLA_POSITION ||--o{ POSITION_INCUMBENCY : occupied_through
    EMPLOYEE ||--o{ POSITION_INCUMBENCY : serves_in
    SERVICE_SEGMENT ||--o| POSITION_INCUMBENCY : establishes
```

| Entity | Purpose |
| --------------------------- | ------------------------------------------------------------------------- |
| `ORGANIZATION_UNIT` | Office, bureau, service, division, section, or unit |
| `ORGANIZATION_UNIT_HISTORY` | Effective-dated reorganizations and name changes |
| `PLANTILLA_POSITION` | Authorized position or item |
| `POSITION_HISTORY` | Position title, grade, office, status, and funding history |
| `QUALIFICATION_STANDARD` | Education, training, experience, eligibility, and competency requirements |
| `POSITION_DOCUMENT` | Position description and staffing authority |
| `POSITION_INCUMBENCY` | Historical relationship between an employee and a position |

Conceptual constraint:

```text
One plantilla position may have many historical incumbencies,
but normally only one active incumbency.
```

---

# 7. Recruitment and Merit Selection Domain

```mermaid
erDiagram
    PLANTILLA_POSITION ||--o{ REQUEST_TO_FILL : requested_for
    ORGANIZATION_UNIT ||--o{ REQUEST_TO_FILL : initiated_by
    AGENCY_MERIT_SELECTION_PLAN_VERSION ||--o{ REQUEST_TO_FILL : governs
    MERIT_SELECTION_CRITERIA_SET ||--o{ REQUEST_TO_FILL : binds
    BOARD_DEFINITION ||--o{ REQUEST_TO_FILL : binds
    REQUEST_TO_FILL ||--o{ APPROVAL_ROUTE_BINDING : requires
    REQUEST_TO_FILL ||--o{ MSP_REBASELINE : preserves
    REQUEST_TO_FILL ||--o{ VACANCY_PUBLICATION : results_in

    VACANCY_PUBLICATION ||--o{ APPLICATION : receives
    APPLICANT ||--o{ APPLICATION : submits
    APPLICANT ||--o{ APPLICANT_DOCUMENT : owns

    APPLICATION ||--o{ APPLICATION_SCREENING : screened_by
    APPLICATION ||--o{ ASSESSMENT : evaluated_by
    APPLICATION ||--o{ INTERVIEW : interviewed_in
    INTERVIEW ||--o{ INTERVIEW_FEEDBACK : produces

    VACANCY_PUBLICATION ||--o{ SELECTION_BOARD_SESSION : reviewed_in
    BOARD_DEFINITION ||--o{ BOARD_APPOINTMENT : designates
    SELECTION_BOARD_SESSION ||--|| BOARD_ROSTER_SNAPSHOT : freezes
    BOARD_ROSTER_SNAPSHOT ||--o{ BOARD_MEMBER_PARTICIPATION : authorizes
    SELECTION_BOARD_SESSION ||--o{ BOARD_MEMBER_PARTICIPATION : attended_by
    AGENCY_MEMBERSHIP ||--o{ BOARD_MEMBER_PARTICIPATION : participates
    BOARD_MEMBER_PARTICIPATION ||--o{ CONFLICT_DECLARATION : declares

    SELECTION_BOARD_SESSION ||--o{ BOARD_RECOMMENDATION : produces
    SELECTION_BOARD_SESSION ||--o| COMPREHENSIVE_CANDIDATE_EVALUATION_REPORT : produces
    APPLICATION ||--o{ BOARD_RECOMMENDATION : receives
    APPLICATION ||--o| SELECTION_DECISION : decided_by
    SELECTION_DECISION ||--o| RECRUITMENT_HANDOFF : hands_off
```

| Entity | Purpose |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `REQUEST_TO_FILL` | Approved request to recruit for a vacant item |
| `AGENCY_MERIT_SELECTION_PLAN_VERSION` | Immutable, effective-dated governing merit-selection plan                 |
| `MERIT_SELECTION_CRITERIA_SET`         | Bound criteria, weights, scales, cutoffs, evidence, and calculation rules |
| `APPROVAL_ROUTE_BINDING`      | Immutable checkpoint-to-route-version binding                             |
| `MSP_REBASELINE`              | Evidence-backed pre-publication replacement of governing bindings         |
| `VACANCY_PUBLICATION`         | Official publication cycle with exact CS Form No. 9 and evidence versions |
| `APPLICANT` | Person applying for one or more vacancies |
| `APPLICATION` | Applicant submission for one vacancy |
| `APPLICATION_SCREENING` | Qualification-standard comparison |
| `ASSESSMENT` | Examination or competency assessment |
| `INTERVIEW` | Interview event |
| `INTERVIEW_FEEDBACK` | Structured evaluator feedback |
| `BOARD_DEFINITION`            | Versioned seats, alternates, and quorum rule                              |
| `BOARD_APPOINTMENT`           | Effective-dated, evidence-backed designation to a board seat              |
| `SELECTION_BOARD_SESSION` | HRMPSB or equivalent deliberation |
| `BOARD_ROSTER_SNAPSHOT`       | Roster frozen when deliberation begins                                    |
| `BOARD_MEMBER_PARTICIPATION`  | Actual attendance, role, conflict, and recusal record                     |
| `CONFLICT_DECLARATION` | Conflict-of-interest record |
| `BOARD_RECOMMENDATION` | Board recommendation |
| `COMPREHENSIVE_CANDIDATE_EVALUATION_REPORT` | Versioned advisory comparative evaluation report                          |
| `SELECTION_DECISION` | Appointing-authority decision |
| `RECRUITMENT_HANDOFF`         | Idempotent immutable selected-candidate package sent to Appointment       |

The server resolves the governing configuration during controlled review. Zero or multiple matches fail closed. Publication freezes every binding, and a material later change requires cancellation and republication rather than mutation.

---

# 8. Appointment and Assumption Domain

```mermaid
erDiagram
    RECRUITMENT_HANDOFF ||--o| APPOINTMENT : may_result_in
    PLANTILLA_POSITION ||--o{ APPOINTMENT : appointed_to

    APPOINTMENT ||--o{ APPOINTMENT_VERSION : versioned_as
    APPOINTMENT_VERSION ||--o{ APPOINTMENT_DOCUMENT_VERSION_LINK : supported_by
    APPOINTMENT_VERSION ||--o{ EXTERNAL_SUBMISSION_EVENT : submitted_through
    APPOINTMENT_VERSION ||--o{ EXTERNAL_APPOINTMENT_ACTION : acted_on

    APPOINTMENT_VERSION ||--o{ OATH_VERSION : acknowledged_by
    APPOINTMENT_VERSION ||--o{ ASSUMPTION_VERSION : effected_by

    ASSUMPTION_VERSION ||--o| SERVICE_ACTIVATION_HANDOFF : publishes
    SERVICE_ACTIVATION_HANDOFF ||--o| EMPLOYEE : activates
    SERVICE_ACTIVATION_HANDOFF ||--o| SERVICE_SEGMENT : begins
    SERVICE_ACTIVATION_HANDOFF ||--o| POSITION_INCUMBENCY : establishes
```

| Entity | Purpose |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `APPOINTMENT` | Government appointment transaction |
| `APPOINTMENT_VERSION`               | Draft or immutable issued or replacement version with separate Employment Status and Nature of Appointment |
| `APPOINTMENT_DOCUMENT_VERSION_LINK` | Exact form or supporting Document Version used by an Appointment Version                                   |
| `EXTERNAL_SUBMISSION_EVENT`         | Append-only submission, receipt, return, or resubmission evidence                                          |
| `EXTERNAL_APPOINTMENT_ACTION`       | Append-only official approval, validation, disapproval, or invalidation evidence                           |
| `OATH_VERSION`                      | Immutable oath evidence version; correction creates a replacement                                          |
| `ASSUMPTION_VERSION`                | Immutable actual start-of-service certification version                                                    |
| `SERVICE_ACTIVATION_HANDOFF`        | Idempotent Assumed Appointment Contract consumed by Personnel and Plantilla                                |

Important lifecycle:

```text
Selection Decision
→ Recruitment handoff
→ Issued Appointment Contract
├── External CSC tracking
└── Oath → Assumption to Duty → Assumed Appointment Contract
                              ├── Personnel service activation
                              └── Plantilla occupancy
```

External CSC tracking and oath or assumption advance independently after issuance. CSC approval or validation is not a prerequisite for oath, assumption, salary entitlement, service activation, or occupancy. A later adverse action is preserved and routed to the applicable personnel response without rewriting prior history.

---

# 9. Personnel Records and Service History Domain

```mermaid
erDiagram
    AGENCY ||--o{ EMPLOYEE : employs
    AGENCY_MEMBERSHIP o|--o| EMPLOYEE : linked_to

    EMPLOYEE ||--o{ PDS_VERSION : maintains
    PDS_VERSION ||--o{ EDUCATION_RECORD : contains
    PDS_VERSION ||--o{ ELIGIBILITY_RECORD : contains
    PDS_VERSION ||--o{ WORK_EXPERIENCE_RECORD : contains
    PDS_VERSION ||--o{ TRAINING_RECORD : contains
    PDS_VERSION ||--o{ FAMILY_RECORD : contains
    PDS_VERSION ||--o{ PDS_REFERENCE : contains

    EMPLOYEE ||--o{ SERVICE_SEGMENT : has
    EMPLOYEE ||--o{ PERSONNEL_ACTION : receives
    PERSONNEL_ACTION ||--o{ PERSONNEL_ACTION_DOCUMENT : supported_by
    PERSONNEL_ACTION ||--o| SERVICE_SEGMENT : creates_or_changes

    EMPLOYEE ||--o{ EMPLOYEE_DOCUMENT : owns
    EMPLOYEE ||--o{ GOVERNMENT_IDENTIFIER : identified_by
    EMPLOYEE ||--o{ BANK_ACCOUNT : paid_to
    EMPLOYEE ||--o{ SALN_COMPLIANCE_RECORD : tracks
```

| Entity | Purpose |
| ------------------------ | ------------------------------------------------------------------- |
| `EMPLOYEE` | Agency personnel master record |
| `PDS_VERSION` | Draft or certified PDS version |
| `SERVICE_SEGMENT` | Effective period of government service |
| `PERSONNEL_ACTION` | Promotion, transfer, reassignment, step increment, separation, etc. |
| `EMPLOYEE_DOCUMENT` | Controlled personnel document |
| `GOVERNMENT_IDENTIFIER` | GSIS, PhilHealth, Pag-IBIG, and TIN identifiers |
| `BANK_ACCOUNT` | Protected payroll account |
| `SALN_COMPLIANCE_RECORD` | Filing status and acknowledgment |

Certified PDS versions and completed service segments must remain historically available.

---

# 10. Attendance and DTR Domain

```mermaid
erDiagram
    WORK_SCHEDULE ||--o{ WORK_SCHEDULE_VERSION : versioned_as
    WORK_SCHEDULE_VERSION ||--|{ DAY_RULE : composed_of
    DAY_RULE ||--o{ BREAK_INTERVAL : excludes
    EMPLOYEE ||--o{ SCHEDULE_ASSIGNMENT : assigned
    WORK_SCHEDULE_VERSION ||--o{ SCHEDULE_ASSIGNMENT : governs_time
    WORK_ARRANGEMENT ||--o{ WORK_ARRANGEMENT_VERSION : versioned_as
    WORK_ARRANGEMENT_VERSION ||--o{ SCHEDULE_ASSIGNMENT : governs_mode

    AGENCY ||--o{ HOLIDAY_CALENDAR : maintains
    HOLIDAY_CALENDAR ||--o{ HOLIDAY_CALENDAR_VERSION : versioned_as
    HOLIDAY_CALENDAR_VERSION ||--o{ HOLIDAY : contains
    WORK_ARRANGEMENT_VERSION }o--|| HOLIDAY_CALENDAR : selects_scope

    EMPLOYEE ||--o{ ATTENDANCE_EVENT : records
    EMPLOYEE ||--o{ ATTENDANCE_CONTEXT : receives
    EMPLOYEE ||--o{ ATTENDANCE_DAY : summarized_into
    SCHEDULE_ASSIGNMENT ||--o{ ATTENDANCE_DAY : evaluated_against
    ATTENDANCE_DAY ||--o{ ATTENDANCE_DAY_SEGMENT : calculated_as

    ATTENDANCE_DAY ||--o{ ATTENDANCE_EXCEPTION : identifies
    ATTENDANCE_DAY ||--o{ ATTENDANCE_CORRECTION : corrected_by
    ATTENDANCE_CORRECTION }o--o| ATTENDANCE_EVENT : may_change
    ATTENDANCE_CORRECTION }o--o| ATTENDANCE_CONTEXT : may_change
    ATTENDANCE_CORRECTION ||--o{ ATTENDANCE_CORRECTION_DOCUMENT : supported_by

    AGENCY ||--o{ ATTENDANCE_PERIOD : processes
    ATTENDANCE_PERIOD ||--o{ ATTENDANCE_DAY : contains
    ATTENDANCE_PERIOD ||--o| DTR_DOCUMENT : produces
```

| Entity | Purpose |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `WORK_SCHEDULE` | Stable identity for a reusable schedule |
| `WORK_SCHEDULE_VERSION` | Immutable effective Day Rules, time zone, event windows, and authority |
| `DAY_RULE` | Fixed, flexible, or rest-day duty rule for one weekday |
| `WORK_ARRANGEMENT_VERSION` | Immutable authorized operating mode and holiday-calendar scope |
| `SCHEDULE_ASSIGNMENT` | Effective binding of eligible Appointed Personnel to schedule and arrangement versions |
| `HOLIDAY_CALENDAR_VERSION` | Immutable scoped holiday and suspension classifications |
| `ATTENDANCE_EVENT` | Immutable raw manual or web-clock event |
| `ATTENDANCE_CONTEXT` | Evidence-backed official business, travel, training, or approved non-leave absence |
| `ATTENDANCE_DAY` | Versioned calculated attendance summary for one Work Date |
| `ATTENDANCE_DAY_SEGMENT` | Immutable interval-level calculation result and provenance |
| `ATTENDANCE_EXCEPTION` | Blocking missing or ambiguous calculation input |
| `ATTENDANCE_CORRECTION` | Approved add, replace, or void request for an event or context |
| `ATTENDANCE_PERIOD` | Review and payroll-locking period |
| `DTR_DOCUMENT` | Generated Daily Time Record |

---

# 11. Leave Administration Domain

```mermaid
erDiagram
    AGENCY ||--o{ LEAVE_TYPE : configures
    LEAVE_TYPE ||--o{ LEAVE_POLICY_VERSION : governed_by

    EMPLOYEE ||--o{ LEAVE_ACCOUNT : holds
    LEAVE_TYPE ||--o{ LEAVE_ACCOUNT : categorizes
    LEAVE_ACCOUNT ||--o{ LEAVE_LEDGER_ENTRY : records
    LEAVE_ACCOUNT ||--o{ LEAVE_CREDIT_COMMITMENT : reserves

    EMPLOYEE ||--o{ LEAVE_APPLICATION : submits
    LEAVE_APPLICATION ||--o{ LEAVE_APPLICATION_VERSION : preserves
    LEAVE_TYPE ||--o{ LEAVE_APPLICATION_VERSION : requested_as
    LEAVE_APPLICATION_VERSION ||--o{ LEAVE_APPLICATION_VERSION_DOCUMENT : supported_by
    DOCUMENT_VERSION ||--o{ LEAVE_APPLICATION_VERSION_DOCUMENT : linked_as
    LEAVE_APPLICATION_VERSION ||--|| APPROVAL_REQUEST : routed_by
    LEAVE_APPLICATION_VERSION ||--|{ LEAVE_CALCULATION_SEGMENT : calculated_as
    LEAVE_POLICY_VERSION ||--o{ LEAVE_CALCULATION_SEGMENT : governs
    LEAVE_APPLICATION_VERSION ||--o{ LEAVE_ELIGIBILITY_ASSESSMENT : evaluated_by
    LEAVE_APPLICATION_VERSION ||--o| LEAVE_CREDIT_CERTIFICATION : certified_by
    APPROVAL_DECISION ||--o| LEAVE_CREDIT_CERTIFICATION : records
    LEAVE_CREDIT_CERTIFICATION ||--|{ LEAVE_CREDIT_CERTIFICATION_LINE : contains
    LEAVE_ACCOUNT ||--o{ LEAVE_CREDIT_CERTIFICATION_LINE : certifies
    LEAVE_APPLICATION_VERSION ||--o{ LEAVE_CREDIT_COMMITMENT : reserves
    LEAVE_CREDIT_COMMITMENT o|--o| LEAVE_CREDIT_COMMITMENT : narrowed_by
    LEAVE_APPLICATION_VERSION ||--o| LEAVE_RECOMMENDATION : recommended_by
    APPROVAL_DECISION ||--o| LEAVE_RECOMMENDATION : records
    LEAVE_APPLICATION_VERSION ||--o| LEAVE_APPROVAL_ALLOCATION : resolved_by
    APPROVAL_DECISION ||--o| LEAVE_APPROVAL_ALLOCATION : authorizes
    LEAVE_APPROVAL_ALLOCATION ||--|{ LEAVE_APPROVAL_ALLOCATION_LINE : contains
    LEAVE_APPLICATION_VERSION ||--o| LEAVE_POSTING : posted_by
    LEAVE_POSTING ||--o{ LEAVE_POSTING_EFFECT : creates
    LEAVE_APPLICATION ||--o{ LEAVE_CANCELLATION : corrected_by
    LEAVE_CANCELLATION ||--|| APPROVAL_REQUEST : routed_by
    LEAVE_CANCELLATION ||--|{ LEAVE_CANCELLATION_SCOPE : targets
    LEAVE_CANCELLATION ||--o{ LEAVE_CANCELLATION_EFFECT : applies

    EMPLOYEE ||--o{ MANDATORY_LEAVE_ASSESSMENT : assessed_for
    LEAVE_POLICY_VERSION ||--o{ MANDATORY_LEAVE_ASSESSMENT : governs

    EMPLOYEE ||--o{ LEAVE_MONETIZATION_REQUEST : requests
    LEAVE_ACCOUNT ||--o{ LEAVE_MONETIZATION_REQUEST : funded_by
    LEAVE_MONETIZATION_REQUEST ||--o{ LEAVE_LEDGER_ENTRY : posts
    LEAVE_MONETIZATION_REQUEST ||--o| PAYROLL_INPUT : creates
```

| Entity | Purpose |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `LEAVE_TYPE` | Government leave category |
| `LEAVE_POLICY_VERSION`         | Immutable agency-scoped effective-dated rules and authority bindings      |
| `LEAVE_ACCOUNT` | Employee account for a leave type |
| `LEAVE_LEDGER_ENTRY`           | Immutable signed posting whose source owns its business meaning |
| `LEAVE_CREDIT_COMMITMENT`      | Unposted claim considered when calculating available credits    |
| `LEAVE_APPLICATION`                  | Stable case preserving the full leave request lifecycle                          |
| `LEAVE_APPLICATION_VERSION`          | Immutable submitted facts, attestation, evidence, assessment, and route binding  |
| `LEAVE_APPLICATION_VERSION_DOCUMENT` | Exact supporting or rendered Document Version linked to one submission           |
| `LEAVE_CALCULATION_SEGMENT`    | Immutable effective-dated quantity calculation within a request |
| `LEAVE_ELIGIBILITY_ASSESSMENT` | Explainable eligible, ineligible, or indeterminate evaluation   |
| `LEAVE_CREDIT_CERTIFICATION`   | HR-certified available credits across affected accounts                  |
| `LEAVE_CREDIT_CERTIFICATION_LINE` | Certified posted, committed, requested, and available quantities for one account |
| `LEAVE_RECOMMENDATION`               | Immutable advisory Supervisor recommendation                                     |
| `LEAVE_APPROVAL_ALLOCATION`          | Authorized exact approved periods and charged, paid, or unpaid quantities        |
| `LEAVE_APPROVAL_ALLOCATION_LINE`     | One exact portion of the authorized allocation                                   |
| `LEAVE_POSTING`                      | Atomic source of ledger, Attendance, and Payroll effects                         |
| `LEAVE_POSTING_EFFECT`               | Stable owner-issued identifier and state for one posting effect                  |
| `LEAVE_CANCELLATION`                 | Authorized whole or partial correction of approved or posted leave               |
| `LEAVE_CANCELLATION_SCOPE`           | Exact approved period and quantity targeted by cancellation                      |
| `LEAVE_CANCELLATION_EFFECT`          | Owner-issued reversal or correction handoff and current state                    |
| `MANDATORY_LEAVE_ASSESSMENT`   | Explainable as-of evaluation of a mandatory-leave obligation    |
| `LEAVE_MONETIZATION_REQUEST` | Monetization request |
| `PAYROLL_INPUT` | Approved HR input consumed by payroll |

---

# 12. Overtime, COC, and CTO Domain

```mermaid
erDiagram
    ORGANIZATION_UNIT ||--o{ OVERTIME_AUTHORITY : requests
    OVERTIME_AUTHORITY ||--o{ OVERTIME_AUTHORITY_EMPLOYEE : covers
    EMPLOYEE ||--o{ OVERTIME_AUTHORITY_EMPLOYEE : included_in

    OVERTIME_AUTHORITY ||--o{ OVERTIME_SERVICE_RECORD : governs
    EMPLOYEE ||--o{ OVERTIME_SERVICE_RECORD : renders
    OVERTIME_SERVICE_RECORD ||--o| OVERTIME_COMPENSATION_DECISION : resolved_by

    OVERTIME_COMPENSATION_DECISION ||--o| PAYROLL_INPUT : may_create
    OVERTIME_COMPENSATION_DECISION ||--o| COC_LEDGER_ENTRY : may_create

    EMPLOYEE ||--o{ COC_ACCOUNT : holds
    COC_ACCOUNT ||--o{ COC_LEDGER_ENTRY : records
    COC_ACCOUNT ||--o{ CTO_REQUEST : funds
    EMPLOYEE ||--o{ CTO_REQUEST : submits
```

| Entity | Purpose |
| -------------------------------- | ------------------------------------------------ |
| `OVERTIME_AUTHORITY` | Prior authorization for overtime |
| `OVERTIME_AUTHORITY_EMPLOYEE` | Covered employee list |
| `OVERTIME_SERVICE_RECORD` | Actual rendered service |
| `OVERTIME_COMPENSATION_DECISION` | OT pay, COC, or non-compensable decision |
| `COC_ACCOUNT` | Compensatory Overtime Credit account |
| `COC_LEDGER_ENTRY` | Earned, used, adjusted, expired, or reversed COC |
| `CTO_REQUEST` | Request to use COC as compensatory time off |

---

# 13. Government Payroll Domain

```mermaid
erDiagram
    AGENCY ||--o{ SALARY_SCHEDULE : adopts
    SALARY_SCHEDULE ||--o{ SALARY_GRADE_RATE : contains

    AGENCY ||--o{ PAY_COMPONENT : configures
    PAY_COMPONENT ||--o{ PAY_COMPONENT_RULE_VERSION : governed_by
    EMPLOYEE ||--o{ EMPLOYEE_COMPENSATION : receives
    PAY_COMPONENT ||--o{ EMPLOYEE_COMPENSATION : classifies

    AGENCY ||--o{ PAYROLL_PERIOD : processes
    PAYROLL_PERIOD ||--o{ PAYROLL_RULE_SNAPSHOT : freezes
    PAYROLL_PERIOD ||--o{ PAYROLL_EMPLOYEE : includes
    EMPLOYEE ||--o{ PAYROLL_EMPLOYEE : paid_through

    PAYROLL_EMPLOYEE ||--o{ PAYROLL_LINE : calculated_as
    PAY_COMPONENT ||--o{ PAYROLL_LINE : categorizes
    PAYROLL_EMPLOYEE ||--o{ CONTRIBUTION_LINE : deducts
    PAYROLL_EMPLOYEE ||--o{ TAX_LINE : deducts
    PAYROLL_EMPLOYEE ||--o{ LOAN_DEDUCTION_LINE : deducts
    PAYROLL_EMPLOYEE ||--o{ PAYROLL_EXCEPTION : flags

    PAYROLL_EMPLOYEE ||--o| PAYSLIP : produces
    PAYROLL_PERIOD ||--o{ PAYROLL_REGISTER : produces
    PAYROLL_PERIOD ||--o{ REMITTANCE_SCHEDULE : produces
    PAYROLL_PERIOD ||--o{ PAYMENT_EXPORT : produces

    PAYROLL_INPUT ||--o{ PAYROLL_LINE : consumed_by
    PAYROLL_PERIOD ||--o{ PAYROLL_ADJUSTMENT : contains
```

| Entity | Purpose |
| ----------------------- | ----------------------------------------------------- |
| `SALARY_SCHEDULE` | Effective government salary schedule |
| `SALARY_GRADE_RATE` | Grade-and-step amount |
| `PAY_COMPONENT` | Earning, deduction, contribution, or adjustment type |
| `EMPLOYEE_COMPENSATION` | Effective employee compensation assignment |
| `PAYROLL_PERIOD` | Payroll run |
| `PAYROLL_RULE_SNAPSHOT` | Frozen rules used by the run |
| `PAYROLL_EMPLOYEE` | Employee-level payroll result |
| `PAYROLL_LINE` | Detailed immutable calculation line |
| `CONTRIBUTION_LINE` | Employee and employer contribution detail |
| `TAX_LINE` | Withholding-tax detail |
| `LOAN_DEDUCTION_LINE` | Loan or authorized deduction |
| `PAYROLL_EXCEPTION` | Warning or blocking issue |
| `PAYSLIP` | Employee payroll statement |
| `PAYROLL_ADJUSTMENT` | Supplemental, correction, refund, or replacement item |

---

# 14. SPMS Performance Domain

```mermaid
erDiagram
    AGENCY ||--o{ PERFORMANCE_CYCLE : runs
    PERFORMANCE_CYCLE ||--o{ ORGANIZATIONAL_GOAL : aligns_to

    ORGANIZATION_UNIT ||--o{ OFFICE_COMMITMENT : owns
    PERFORMANCE_CYCLE ||--o{ OFFICE_COMMITMENT : contains

    EMPLOYEE ||--o{ INDIVIDUAL_COMMITMENT : owns
    PERFORMANCE_CYCLE ||--o{ INDIVIDUAL_COMMITMENT : contains
    INDIVIDUAL_COMMITMENT ||--o{ SUCCESS_INDICATOR : defines

    INDIVIDUAL_COMMITMENT ||--o{ ACCOMPLISHMENT : records
    ACCOMPLISHMENT ||--o{ PERFORMANCE_EVIDENCE : supported_by
    INDIVIDUAL_COMMITMENT ||--o{ COACHING_NOTE : receives
    INDIVIDUAL_COMMITMENT ||--o{ PERFORMANCE_REVIEW : reviewed_by

    PERFORMANCE_REVIEW ||--o{ RATING_COMPONENT : contains
    PERFORMANCE_REVIEW ||--o| PERFORMANCE_RATING : finalizes
    PERFORMANCE_RATING ||--o{ RATING_AMENDMENT : may_have
```

| Entity | Purpose |
| ----------------------- | -------------------------------------------------------- |
| `PERFORMANCE_CYCLE` | SPMS rating cycle |
| `ORGANIZATIONAL_GOAL` | Agency or office goal |
| `OFFICE_COMMITMENT` | OPCR, DPCR, or equivalent |
| `INDIVIDUAL_COMMITMENT` | IPCR or equivalent |
| `SUCCESS_INDICATOR` | Target, measure, weight, quality, efficiency, timeliness |
| `ACCOMPLISHMENT` | Actual result |
| `PERFORMANCE_EVIDENCE` | Supporting file or reference |
| `COACHING_NOTE` | Monitoring and coaching record |
| `PERFORMANCE_REVIEW` | Supervisor or calibration review |
| `PERFORMANCE_RATING` | Final rating |
| `RATING_AMENDMENT` | Controlled correction preserving original rating |

---

# 15. Separation and Clearance Domain

```mermaid
erDiagram
    EMPLOYEE ||--o{ SEPARATION_CASE : subject_of
    SEPARATION_CASE ||--o{ SEPARATION_DOCUMENT : supported_by
    SEPARATION_CASE ||--o{ CLEARANCE_TASK : requires

    CLEARANCE_OFFICE ||--o{ CLEARANCE_TASK : assigned_to
    AGENCY_MEMBERSHIP ||--o{ CLEARANCE_TASK : completed_by
    CLEARANCE_TASK ||--o{ ACCOUNTABILITY_ITEM : may_identify

    SEPARATION_CASE ||--o| SERVICE_SEGMENT : closes
    SEPARATION_CASE ||--o| POSITION_INCUMBENCY : closes
    SEPARATION_CASE ||--o| AGENCY_MEMBERSHIP : deactivates
```

| Entity | Purpose |
| --------------------- | ------------------------------------------------------------------------- |
| `SEPARATION_CASE` | Resignation, retirement, transfer, expiration, death, or other separation |
| `SEPARATION_DOCUMENT` | Acceptance, authority, or supporting evidence |
| `CLEARANCE_OFFICE` | Office participating in clearance |
| `CLEARANCE_TASK` | Individual clearance requirement |
| `ACCOUNTABILITY_ITEM` | Property, cash, document, or other accountability |

---

# 16. Shared Workflow, Documents, Audit, Notifications, and AI

```mermaid
erDiagram
    AGENCY ||--o{ APPROVAL_REQUEST : owns
    APPROVAL_REQUEST ||--o{ APPROVAL_STEP : contains
    AGENCY_MEMBERSHIP ||--o{ APPROVAL_STEP : assigned_to
    APPROVAL_STEP ||--o{ APPROVAL_DECISION : produces

    AGENCY ||--o{ DOCUMENT : owns
    DOCUMENT ||--o{ DOCUMENT_VERSION : versioned_as
    DOCUMENT ||--o{ DOCUMENT_LINK : linked_through

    AGENCY ||--o{ AUDIT_EVENT : records
    AGENCY_MEMBERSHIP ||--o{ AUDIT_EVENT : acts_in
    AUDIT_EVENT ||--o{ AUDIT_CHANGE : contains

    AGENCY ||--o{ NOTIFICATION : sends
    AGENCY_MEMBERSHIP ||--o{ NOTIFICATION : receives
    NOTIFICATION ||--o{ NOTIFICATION_DELIVERY : delivered_through

    AGENCY ||--o{ AI_REQUEST : processes
    AGENCY_MEMBERSHIP ||--o{ AI_REQUEST : initiates
    AI_REQUEST ||--o{ AI_INPUT_REFERENCE : uses
    AI_REQUEST ||--o| AI_OUTPUT : produces
    AI_OUTPUT ||--o{ AI_REVIEW_DECISION : reviewed_by
    AI_REQUEST ||--o{ AI_TOOL_CALL : invokes
```

| Entity | Purpose |
| ----------------------- | -------------------------------------------------- |
| `APPROVAL_REQUEST` | Shared approval workflow linked to a domain entity |
| `APPROVAL_STEP` | Sequential or parallel approval step |
| `APPROVAL_DECISION` | Approve, reject, return, or delegate |
| `DOCUMENT` | Controlled document identity |
| `DOCUMENT_VERSION` | Immutable or draft document version |
| `DOCUMENT_LINK` | Associates a document with domain records |
| `AUDIT_EVENT` | Append-only business or security event |
| `AUDIT_CHANGE` | Field-level before-and-after values |
| `NOTIFICATION` | In-app notification |
| `NOTIFICATION_DELIVERY` | Email or other delivery attempt |
| `AI_REQUEST` | Controlled AI task |
| `AI_INPUT_REFERENCE` | Minimum source records used |
| `AI_OUTPUT` | Validated draft or structured output |
| `AI_REVIEW_DECISION` | Human accept, edit, or reject decision |
| `AI_TOOL_CALL` | Controlled application tool invocation |

A generic approval engine records decisions, but the owning domain service must execute the approved business action.

---

# 17. Cross-Domain Lifecycle Rules

## 17.1 Identity separation

```text
USER
└── AGENCY_MEMBERSHIP
    └── optional EMPLOYEE link
```

A user may:

- belong to multiple agencies;
- be an auditor without being an employee;
- retain identity history after agency membership is deactivated.

## 17.2 Position occupancy

```text
PLANTILLA_POSITION
└── POSITION_INCUMBENCY
    └── EMPLOYEE
```

A position may be vacant, reserved, occupied, frozen, or abolished independently of an employee record.

## 17.3 Recruitment to service

```text
VACANT POSITION
→ REQUEST TO FILL
→ GOVERNING CONFIGURATION BINDINGS
→ VACANCY PUBLICATION
→ APPLICATION
→ SELECTION DECISION
→ RECRUITMENT HANDOFF
→ ISSUED APPOINTMENT CONTRACT
→ ASSUMED APPOINTMENT CONTRACT
→ PERSONNEL SERVICE SEGMENT + PLANTILLA INCUMBENCY
```

## 17.4 Immutable ledger model

These entities use immutable entries:

- finalized governing Recruitment bindings and MSP Rebaselines;
- Assessment Result Versions, Board Roster Snapshots, Board Recommendations, and Selection Decisions;
- issued Appointment Versions, external submission and action events, Oath Versions, and Assumption Versions;
- `LEAVE_LEDGER_ENTRY`;
- `COC_LEDGER_ENTRY`;
- finalized `PAYROLL_LINE`;
- `AUDIT_EVENT`.

Corrections create adjustment or reversal entries.

## 17.5 Effective-dated records

The logical model should effective-date:

- agency profile versions;
- organization and position history;
- qualification standards;
- service segments;
- personnel actions;
- schedules and work arrangements;
- leave policies;
- salary schedules;
- compensation assignments;
- delegated authority.

---

# 18. Conceptual Constraints for Logical Design

The logical ERD must later enforce:

1. one active membership per user and agency;
2. no cycle in the organization-unit hierarchy;
3. unique active item number within an agency;
4. normally one active incumbent per plantilla position;
5. no Recruitment publication unless exactly one governing configuration set is bound;
6. no position occupancy without an Assumed Appointment Contract or effective personnel action;
7. assumption date cannot precede appointment issuance;
8. service segments must not improperly overlap;
9. certified PDS versions cannot be overwritten;
10. raw attendance events cannot be edited directly;
11. locked attendance requires an adjustment;
12. leave and COC reversals must reference original ledger entries;
13. one payroll-employee result per employee and payroll period;
14. finalized payroll lines cannot be edited;
15. final performance ratings require controlled amendment;
16. effectual separation closes service and occupancy but preserves history;
17. every operational entity is traceable to one agency.

---

# 19. Proposed Module Ownership

| Module | Aggregate roots |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Identity | User, AgencyMembership, Role |
| Agency | Agency, OrganizationUnit |
| Plantilla | PlantillaPosition, QualificationStandard |
| Recruitment | RequestToFill, VacancyPublication, Application, SelectionBoardSession, SelectionDecision |
| Appointment | Appointment, ExternalAppointmentAction, OathVersion, AssumptionVersion                   |
| Personnel | Employee, PdsVersion, PersonnelAction, ServiceSegment |
| Attendance | WorkSchedule, AttendancePeriod, AttendanceDay |
| Leave       | LeaveType, LeaveAccount, LeaveApplication, LeaveApplicationVersion, LeavePosting, LeaveCancellation |
| Overtime | OvertimeAuthority, CocAccount, CtoRequest |
| Payroll | SalarySchedule, PayComponent, PayrollPeriod |
| Performance | PerformanceCycle, IndividualCommitment |
| Separation | SeparationCase |
| Workflow | ApprovalRequest |
| Documents | Document |
| Audit | AuditEvent |
| AI | AiRequest |

Cross-module reads and writes occur through owning application services, not direct access to another module's tables. The Recruitment-to-Appointment handoff is idempotent. Personnel service activation and Plantilla occupancy consume the same Assumed Appointment Contract and commit atomically with the originating business event.

---

# 20. Next Logical ERD Files

After approval, split the model into:

```text
docs/data-model/
├── identity-and-agency-logical-erd.md
├── organization-and-plantilla-logical-erd.md
├── recruitment-and-selection-logical-erd.md
├── appointment-and-personnel-logical-erd.md
├── attendance-and-leave-logical-erd.md
├── overtime-coc-cto-logical-erd.md
├── payroll-logical-erd.md
├── spms-logical-erd.md
├── separation-logical-erd.md
└── approvals-documents-audit-ai-logical-erd.md
```

Each logical ERD will add:

- primary and foreign keys;
- candidate columns;
- uniqueness;
- nullability;
- tenant keys;
- status constraints;
- effective dates;
- deletion behavior;
- immutable-record rules.

---

# 21. Review Checklist

- [ ] Agency is the root tenant.
- [ ] User, membership, and employee are separate.
- [ ] Organization units support hierarchy and history.
- [ ] Positions are separate from incumbents.
- [ ] Recruitment begins from an authorized vacancy.
- [ ] Application, appointment, assumption, and employee are separate.
- [ ] PDS versions and service segments preserve history.
- [ ] Raw and calculated attendance are separate.
- [ ] Leave and COC use ledgers.
- [ ] Payroll stores employee-level and line-level results.
- [ ] Finalized payroll can be immutable.
- [ ] SPMS commitments, evidence, reviews, and ratings are separated.
- [ ] Separation closes service without deleting history.
- [ ] Generic approval cannot bypass domain rules.
- [ ] Documents and audit records are cross-domain.
- [ ] AI output remains subject to human review.
- [ ] No biometric import entity exists in MVP.

---

# 22. Approval

| Role | Name | Decision | Date |
| ----------------------------- | ---- | -------- | ---- |
| Product Owner |  | Pending |  |
| Government HR / HRMO Reviewer |  | Pending |  |
| Payroll / Accounting Reviewer |  | Pending |  |
| Technical Owner |  | Pending |  |
| Data / Security Reviewer |  | Pending |  |

---

# 23. Change Log

| Version | Date | Description |
| ------- | -------------- | ---------------------------------------------------------------- |
| 1.0 | August 6, 2026 | Initial conceptual ERD for the Philippine Public-Sector HRIS MVP |
