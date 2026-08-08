# Philippine Public-Sector HRIS MVP
## Conceptual Entity-Relationship Diagram

**Document status:** Draft for review  
**Source documents:** Public-Sector HRIS BRD v1.0, Workflow Specification v1.0, Controls Specification v1.0  
**Primary profile:** Civilian National Government Agency  
**Version:** 1.0  
**Date:** August 6, 2026

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
    EMPLOYEE ||--o{ ATTENDANCE_DAY : summarized_into
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
|---|---|
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
|---|---|
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
    REQUEST_TO_FILL ||--o{ VACANCY_PUBLICATION : results_in

    VACANCY_PUBLICATION ||--o{ APPLICATION : receives
    APPLICANT ||--o{ APPLICATION : submits
    APPLICANT ||--o{ APPLICANT_DOCUMENT : owns

    APPLICATION ||--o{ APPLICATION_SCREENING : screened_by
    APPLICATION ||--o{ ASSESSMENT : evaluated_by
    APPLICATION ||--o{ INTERVIEW : interviewed_in
    INTERVIEW ||--o{ INTERVIEW_FEEDBACK : produces

    VACANCY_PUBLICATION ||--o{ SELECTION_BOARD_SESSION : reviewed_in
    SELECTION_BOARD_SESSION ||--o{ BOARD_MEMBER_PARTICIPATION : attended_by
    AGENCY_MEMBERSHIP ||--o{ BOARD_MEMBER_PARTICIPATION : participates
    BOARD_MEMBER_PARTICIPATION ||--o{ CONFLICT_DECLARATION : declares

    SELECTION_BOARD_SESSION ||--o{ BOARD_RECOMMENDATION : produces
    APPLICATION ||--o{ BOARD_RECOMMENDATION : receives
    APPLICATION ||--o| SELECTION_DECISION : decided_by
```

| Entity | Purpose |
|---|---|
| `REQUEST_TO_FILL` | Approved request to recruit for a vacant item |
| `VACANCY_PUBLICATION` | Official publication cycle |
| `APPLICANT` | Person applying for one or more vacancies |
| `APPLICATION` | Applicant submission for one vacancy |
| `APPLICATION_SCREENING` | Qualification-standard comparison |
| `ASSESSMENT` | Examination or competency assessment |
| `INTERVIEW` | Interview event |
| `INTERVIEW_FEEDBACK` | Structured evaluator feedback |
| `SELECTION_BOARD_SESSION` | HRMPSB or equivalent deliberation |
| `BOARD_MEMBER_PARTICIPATION` | Board attendance and role |
| `CONFLICT_DECLARATION` | Conflict-of-interest record |
| `BOARD_RECOMMENDATION` | Board recommendation |
| `SELECTION_DECISION` | Appointing-authority decision |

---

# 8. Appointment and Assumption Domain

```mermaid
erDiagram
    APPLICATION ||--o| APPOINTMENT : may_result_in
    PLANTILLA_POSITION ||--o{ APPOINTMENT : appointed_to

    APPOINTMENT ||--o{ APPOINTMENT_VERSION : versioned_as
    APPOINTMENT ||--o{ APPOINTMENT_DOCUMENT : supported_by
    APPOINTMENT ||--o{ APPOINTMENT_SUBMISSION : tracked_through

    APPOINTMENT ||--o| OATH_OF_OFFICE : requires
    APPOINTMENT ||--o| ASSUMPTION_TO_DUTY : requires

    ASSUMPTION_TO_DUTY ||--o| EMPLOYEE : activates
    ASSUMPTION_TO_DUTY ||--o| SERVICE_SEGMENT : begins
    ASSUMPTION_TO_DUTY ||--o| POSITION_INCUMBENCY : establishes
```

| Entity | Purpose |
|---|---|
| `APPOINTMENT` | Government appointment transaction |
| `APPOINTMENT_VERSION` | Issued, corrected, returned, or replacement version |
| `APPOINTMENT_DOCUMENT` | Supporting appointment documents |
| `APPOINTMENT_SUBMISSION` | CSC or external submission tracking |
| `OATH_OF_OFFICE` | Oath record |
| `ASSUMPTION_TO_DUTY` | Actual start-of-service certification |

Important lifecycle:

```text
Application
→ Appointment
→ Oath
→ Assumption to Duty
→ Employee Service
```

Selection or appointment issuance alone does not create active service.

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
|---|---|
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
    EMPLOYEE ||--o{ SCHEDULE_ASSIGNMENT : assigned
    WORK_SCHEDULE ||--o{ SCHEDULE_ASSIGNMENT : defines
    WORK_ARRANGEMENT ||--o{ SCHEDULE_ASSIGNMENT : modifies

    AGENCY ||--o{ HOLIDAY_CALENDAR : maintains
    HOLIDAY_CALENDAR ||--o{ HOLIDAY : contains

    EMPLOYEE ||--o{ ATTENDANCE_EVENT : records
    EMPLOYEE ||--o{ ATTENDANCE_DAY : summarized_into
    WORK_SCHEDULE ||--o{ ATTENDANCE_DAY : evaluated_against

    ATTENDANCE_DAY ||--o{ ATTENDANCE_EXCEPTION : identifies
    ATTENDANCE_DAY ||--o{ ATTENDANCE_CORRECTION : corrected_by
    ATTENDANCE_CORRECTION ||--o{ ATTENDANCE_CORRECTION_DOCUMENT : supported_by

    AGENCY ||--o{ ATTENDANCE_PERIOD : processes
    ATTENDANCE_PERIOD ||--o{ ATTENDANCE_DAY : contains
    ATTENDANCE_PERIOD ||--o| DTR_DOCUMENT : produces
```

| Entity | Purpose |
|---|---|
| `WORK_SCHEDULE` | Reusable schedule pattern |
| `WORK_ARRANGEMENT` | Office, hybrid, WFH, field, or other arrangement |
| `SCHEDULE_ASSIGNMENT` | Effective employee schedule |
| `ATTENDANCE_EVENT` | Immutable raw manual or web-clock event |
| `ATTENDANCE_DAY` | Calculated daily attendance |
| `ATTENDANCE_EXCEPTION` | Missing event, tardiness, undertime, or mismatch |
| `ATTENDANCE_CORRECTION` | Correction request and decision |
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

    EMPLOYEE ||--o{ LEAVE_APPLICATION : submits
    LEAVE_TYPE ||--o{ LEAVE_APPLICATION : requested_as
    LEAVE_APPLICATION ||--o{ LEAVE_APPLICATION_DOCUMENT : supported_by
    LEAVE_APPLICATION ||--o| LEAVE_CREDIT_CERTIFICATION : certified_by

    EMPLOYEE ||--o{ LEAVE_MONETIZATION_REQUEST : requests
    LEAVE_ACCOUNT ||--o{ LEAVE_MONETIZATION_REQUEST : funded_by
    LEAVE_MONETIZATION_REQUEST ||--o{ LEAVE_LEDGER_ENTRY : posts
    LEAVE_MONETIZATION_REQUEST ||--o| PAYROLL_INPUT : creates
```

| Entity | Purpose |
|---|---|
| `LEAVE_TYPE` | Government leave category |
| `LEAVE_POLICY_VERSION` | Effective-dated leave rules |
| `LEAVE_ACCOUNT` | Employee account for a leave type |
| `LEAVE_LEDGER_ENTRY` | Immutable credit, debit, adjustment, or reversal |
| `LEAVE_APPLICATION` | Leave request |
| `LEAVE_CREDIT_CERTIFICATION` | HR-certified available credits |
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
|---|---|
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
|---|---|
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
|---|---|
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
|---|---|
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
|---|---|
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
→ VACANCY PUBLICATION
→ APPLICATION
→ SELECTION DECISION
→ APPOINTMENT
→ ASSUMPTION TO DUTY
→ EMPLOYEE SERVICE SEGMENT
```

## 17.4 Immutable ledger model

These entities use immutable entries:

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
5. no position occupancy without valid appointment or personnel action;
6. assumption date cannot precede appointment issuance;
7. service segments must not improperly overlap;
8. certified PDS versions cannot be overwritten;
9. raw attendance events cannot be edited directly;
10. locked attendance requires an adjustment;
11. leave and COC reversals must reference original ledger entries;
12. one payroll-employee result per employee and payroll period;
13. finalized payroll lines cannot be edited;
14. final performance ratings require controlled amendment;
15. effectual separation closes service and occupancy but preserves history;
16. every operational entity is traceable to one agency.

---

# 19. Proposed Module Ownership

| Module | Aggregate roots |
|---|---|
| Identity | User, AgencyMembership, Role |
| Agency | Agency, OrganizationUnit |
| Plantilla | PlantillaPosition, QualificationStandard |
| Recruitment | RequestToFill, VacancyPublication, Application, SelectionBoardSession |
| Appointment | Appointment, AssumptionToDuty |
| Personnel | Employee, PdsVersion, PersonnelAction, ServiceSegment |
| Attendance | WorkSchedule, AttendancePeriod, AttendanceDay |
| Leave | LeaveType, LeaveAccount, LeaveApplication |
| Overtime | OvertimeAuthority, CocAccount, CtoRequest |
| Payroll | SalarySchedule, PayComponent, PayrollPeriod |
| Performance | PerformanceCycle, IndividualCommitment |
| Separation | SeparationCase |
| Workflow | ApprovalRequest |
| Documents | Document |
| Audit | AuditEvent |
| AI | AiRequest |

Cross-module changes should occur through application services and domain events, not direct updates to another module's tables.

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
|---|---|---|---|
| Product Owner |  | Pending |  |
| Government HR / HRMO Reviewer |  | Pending |  |
| Payroll / Accounting Reviewer |  | Pending |  |
| Technical Owner |  | Pending |  |
| Data / Security Reviewer |  | Pending |  |

---

# 23. Change Log

| Version | Date | Description |
|---|---|---|
| 1.0 | August 6, 2026 | Initial conceptual ERD for the Philippine Public-Sector HRIS MVP |
