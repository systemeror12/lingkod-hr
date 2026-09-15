# Philippine Public-Sector HRIS MVP

## Business Process Workflow Specification

**Document status:** Draft for review  
**Source:** Philippine Public-Sector HRIS MVP BRD v1.0  
**Primary implementation profile:** Civilian National Government Agency  
**Version:** 1.0  
**Date:** August 5, 2026  

---

# 1. Purpose

This document defines the core public-sector HR workflows that will drive the ERD, status models, permission matrix, API design, and acceptance tests.

The workflow set differs materially from a private-sector HRIS because the public-sector lifecycle begins with an authorized position and continues through merit selection, appointment, assumption to duty, service records, government attendance and leave, salary-grade payroll, SPMS, and formal separation.

---

# 2. Workflow Principles

1. Recruitment for a plantilla appointment begins with a valid vacant position.
2. Appointment issuance does not by itself establish actual service; assumption to duty must be recorded.
3. Every personnel action must preserve history.
4. Attendance, leave, overtime, payroll, and performance use effective-dated rules.
5. Payroll preparation, certification, approval, and payment responsibilities may be separated.
6. Finalized payroll and issued personnel records are not silently edited.
7. Government forms and rule versions are traceable.
8. AI output is advisory and requires human validation.
9. Biometric-device integrations and biometric file imports are outside MVP.
10. Agency profiles control differences among NGAs, LGUs, SUCs, and GOCCs with original charters.

---

# 3. Workflow Index

| ID | Workflow |
| ------ | -------------------------------------------------- |
| WF-001 | User Invitation, Login, and Agency Access |
| WF-002 | Plantilla Position Creation and Vacancy Control |
| WF-003 | Vacancy Publication and Merit Selection |
| WF-004 | Appointment Issuance, CSC Tracking, and Assumption |
| WF-005 | PDS, Employee Onboarding, and Service Record |
| WF-006 | Personnel Action and Position Movement |
| WF-007 | Attendance and Daily Time Record |
| WF-008 | Leave Application and Leave-Credit Ledger |
| WF-009 | Overtime Authority, COC/CTO, and Overtime Pay |
| WF-010 | Government Payroll |
| WF-011 | SPMS Performance Cycle |
| WF-012 | Separation, Clearance, and Access Revocation |
| WF-013 | AI-Assisted HR Action |

---

# 4. WF-001 — User Invitation, Login, and Agency Access

```mermaid
flowchart TD
    A[Agency Administrator invites user] --> B[Assign agency membership and role]
    B --> C[Send single-use activation link]
    C --> D{Link valid?}
    D -- No --> E[Expire or resend invitation]
    D -- Yes --> F[Verify email and create credentials]
    F --> G{MFA required?}
    G -- Yes --> H[Enroll or complete MFA]
    G -- No --> I[Activate account]
    H --> I
    I --> J[User signs in]
    J --> K{Authentication valid?}
    K -- No --> L[Generic error, rate limit, and security audit]
    K -- Yes --> M{Account active?}
    M -- No --> N[Deny protected access]
    M -- Yes --> O[Load agency memberships]
    O --> P{More than one agency?}
    P -- Yes --> Q[Select agency context]
    P -- No --> R[Set trusted agency context]
    Q --> R
    R --> S[Load role, office scope, and permissions]
    S --> T[Create secure session]
    T --> U[Open authorized dashboard]
```

Key states:

```text
INVITED → ACTIVE → LOCKED | SUSPENDED | DEACTIVATED
```

---

# 5. WF-002 — Plantilla Position Creation and Vacancy Control

```mermaid
flowchart TD
    A[HR or Budget records proposed position action] --> B[Enter item number, title, salary grade, office, funding, and qualification standard]
    B --> C{Action type}
    C -- New or reclassified position --> D[Attach authority and position documents]
    C -- Existing position migration --> E[Reconcile with approved plantilla source]
    D --> F[HR and Budget review]
    E --> F
    F --> G{Authorized and complete?}
    G -- No --> H[Return for correction]
    H --> B
    G -- Yes --> I[Activate authorized position]
    I --> J{Current incumbent?}
    J -- Yes --> K[Link active incumbent and set OCCUPIED]
    J -- No --> L[Set VACANT]
    L --> M[Position becomes eligible for request-to-fill]
```

Position states:

```text
PROPOSED
AUTHORIZED
VACANT
RESERVED
OCCUPIED
FROZEN
ABOLISHED
```

Controls:

- one active incumbent per item unless an approved exception exists;
- effective-dated title, grade, office, and status;
- abolition never deletes position history.

---

# 6. WF-003 — Vacancy Publication and Merit Selection

```mermaid
flowchart TD
    A[Requesting office selects vacant position] --> B[Submit request to fill]
    B --> C[HR validates Recruitable Vacancy and resolves governing configuration]
    C --> D{Exactly one MSP, criteria set, board, and required route set?}
    D -- No --> E[Reject or return request]
    D -- Yes --> F[Bind configuration to Recruitment Case]
    F --> G[Prepare CS Form No. 9 and publication evidence]
    G --> H[Obtain approvals through bound route versions]
    H --> I[Publish and freeze governing bindings]
    I --> J[Accept applications]
    J --> K[Validate documents and PDS-compatible data]
    K --> L[Screen against bound Qualification Standard Version]
    L --> M{Meets minimum requirements?}
    M -- No --> N[Record non-qualification reason]
    M -- Yes --> O[Assess using bound criteria set]
    O --> P{Publication period elapsed and screening complete?}
    P -- No --> Y[Block deliberation]
    P -- Yes --> Q[Freeze board roster and applicant-specific quorum]
    Q --> R[Record participation, conflicts, recusals, and results]
    R --> S[Board recommendation and comparative report]
    S --> T[Appointing authority reviews advisory records]
    T --> U{Action}
    U -- Select --> V[Record Selection Decision and send idempotent package to Appointment]
    U -- Return --> W[Return for authorized further review]
    U -- No selection --> X[Record Selection Decision and close or republish vacancy]
    W --> Q
```

Required audit:

- publication;
- screening;
- assessment;
- board attendance and recommendation;
- appointing-authority decision;
- conflict-of-interest declaration.

AI may summarize credentials but cannot make the final decision.

---

# 7. WF-004 — Appointment Issuance, CSC Tracking, and Assumption

```mermaid
flowchart TD
    A[Receive immutable Recruitment selection package] --> B[Revalidate Plantilla reservation]
    B --> C[Prepare Appointment Version and exact form package]
    C --> D[Validate evidence, classification, signature authority, and reservation]
    D --> E{Complete and valid?}
    E -- No --> F[Return for correction]
    F --> C
    E -- Yes --> G[Route for HR and legal or authorized review]
    G --> H[Route to appointing authority]
    H --> I{Signed by authorized authority?}
    I -- No --> J[Return or cancel]
    I -- Yes --> K[Freeze Issued Appointment Contract]
    K --> L[Furnish Appointment and record acknowledgment]
    L --> M[External CSC tracking branch]
    L --> N[Oath and assumption branch]
    M --> O[Append submission, receipt, return, or resubmission event]
    O --> P[Append evidenced CSC action when received]
    P --> Q{Adverse action?}
    Q -- Yes --> R[Route to applicable personnel response]
    Q -- No --> S[Retain external standing]
    N --> T[Record versioned oath]
    T --> U[Record evidenced Assumption to Duty]
    U --> V{Actual assumption certified?}
    V -- No --> W[Keep reservation or record evidenced failure or cancellation]
    V -- Yes --> X[Publish Assumed Appointment Contract]
    X --> Y[Personnel activates service]
    X --> Z[Plantilla creates incumbency]
    Y --> AA[Close Recruitment Case after atomic handoff]
    Z --> AA
```

Appointment states:

```text
DRAFT
FOR_REVIEW
FOR_SIGNATURE
ISSUED
CANCELLED
```

`SUBMITTED`, `RETURNED`, `VALIDATED`, and `INVALIDATED` describe external events or a derived external standing, not Appointment workflow states. CSC tracking does not gate the oath or assumption branch. Selection and issuance do not activate service.

---

# 8. WF-005 — PDS, Employee Onboarding, and Service Record

```mermaid
flowchart TD
    A[Appointment assumed] --> B[Create or update employee master record]
    B --> C[Import selected applicant data]
    C --> D[Employee reviews PDS sections]
    D --> E[Upload eligibility, education, training, license, and identity evidence]
    E --> F[HR verifies submitted records]
    F --> G{Complete?}
    G -- No --> H[Request missing or corrected information]
    H --> D
    G -- Yes --> I[Assign employee number and agency account]
    I --> J[Confirm office, position, supervisor, salary grade, and step]
    J --> K[Set GSIS, PhilHealth, Pag-IBIG, tax, and bank information]
    K --> L[Assign schedule and work arrangement]
    L --> M[Assign onboarding and clearance-accountability tasks]
    M --> N{Required tasks complete?}
    N -- No --> O[Notify employee and task owners]
    O --> N
    N -- Yes --> P[Set employee ACTIVE]
    P --> Q[Generate initial service-record segment]
```

Personnel records preserve versions and evidence. PDS corrections do not overwrite prior certified versions.

---

# 9. WF-006 — Personnel Action and Position Movement

```mermaid
flowchart TD
    A[HR initiates personnel action] --> B[Select action type]
    B --> C[Load employee, current appointment, and position]
    C --> D[Enter proposed effectivity and supporting authority]
    D --> E[Validate qualification, position, compensation, and action rules]
    E --> F{Valid?}
    F -- No --> G[Return with deficiencies]
    G --> D
    F -- Yes --> H[Route through required review and approval]
    H --> I{Approved?}
    I -- No --> J[Close as rejected or cancelled]
    I -- Yes --> K[Create new effective-dated personnel action]
    K --> L[Close or modify prior service segment]
    L --> M{Position movement?}
    M -- Yes --> N[Release old item and occupy new item]
    M -- No --> O[Keep current item]
    N --> P[Update employee current assignment]
    O --> P
    P --> Q[Update salary grade or step when applicable]
    Q --> R[Create notice, service-record entry, and audit event]
```

Action types include promotion, transfer, reappointment, reassignment, detail, designation, salary adjustment, step increment, and separation.

---

# 10. WF-007 — Attendance and Daily Time Record

```mermaid
flowchart TD
    A[Attendance period opens] --> B[Resolve Attendance Applicability and exact effective configuration]
    B --> C{Configuration complete and unambiguous?}
    C -- No --> D[Create blocking Attendance Exception]
    C -- Yes --> E[Load Day Rule, holiday classification, Attendance Context, and posted leave]
    E --> F[Receive attendance event]
    F --> G{Source}
    G -- Employee web clock --> H[Validate Appointed Personnel, session, enabled source, and timestamp]
    G -- Authorized manual entry --> I[Validate permission, timestamp, and reason]
    H --> J[Store immutable semantic event]
    I --> J
    J --> K[Match event collection window and Work Date]
    K --> L{Sequence and match unambiguous?}
    L -- No --> D
    L -- Yes --> M[Build non-overlapping Attendance Day Segments]
    M --> N[Calculate worked, coverage, tardiness, undertime, and absence minutes]
    N --> O[Classify outside-schedule and statutory-night-window minutes]
    O --> P{Blocking exception?}
    P -- Yes --> D
    P -- No --> Q[Mark CALCULATED]
    D --> R[Notify employee or supervisor]
    R --> S[Employee or administrator may request correction]
    S --> T[Supervisor or HR reviews]
    T --> U{Approved?}
    U -- No --> V[Reject with reason]
    U -- Yes --> W[Add, replace, or void the event or context]
    W --> X[Create a new Attendance Day calculation version]
    Q --> Y[Generate DTR view]
    X --> Y
    Y --> Z{Payroll cutoff reached?}
    Z -- No --> B
    Z -- Yes --> AA[Approve and lock attendance period]
    AA --> AB[Publish payroll inputs]
```

An ordinary daytime DTR presents semantic events through the familiar AM In, AM Out, PM In, and PM Out slots. Overnight duty remains one Work Date beginning on the local date of `TIME_IN`; its view uses duty and break labels with actual dates and times. Complete events on a rest day create Unscheduled Service, not approved overtime or COC. No biometric import exists in MVP.

---

# 11. WF-008 — Leave Application and Leave-Credit Ledger

```mermaid
flowchart TD
    A[Employee starts leave application] --> B[Select leave type, dates, location or details, and supporting document]
    B --> C[Load eligibility, schedule, holidays, and leave balance]
    C --> D[Calculate requested leave units]
    D --> E{Eligible and complete?}
    E -- No --> F[Show deficiency or policy explanation]
    E -- Yes --> G[Submit application]
    G --> H[HR certifies leave credits]
    H --> I{Credits or authority sufficient?}
    I -- No --> J[Route as leave without pay or reject according to policy]
    I -- Yes --> K[Route to supervisor recommendation]
    K --> L{Recommended?}
    L -- No --> M[Reject with reason]
    L -- Yes --> N[Route to approving official]
    N --> O{Approved?}
    O -- No --> M
    O -- Yes --> P[Create leave-ledger deduction]
    P --> Q[Update attendance calendar]
    Q --> R[Create payroll impact]
    R --> S[Notify employee]
```

### Leave monetization

```mermaid
flowchart TD
    A[Employee requests monetization] --> B[HR validates leave balance and eligibility]
    B --> C[Check minimum retention, annual limit, reason, and funding]
    C --> D{Eligible and fund-supported?}
    D -- No --> E[Reject with reason]
    D -- Yes --> F[Route for agency-head or authorized approval]
    F --> G{Approved?}
    G -- No --> E
    G -- Yes --> H[Create leave-ledger deduction]
    H --> I[Create payroll earning input]
    I --> J[Record approval and rule version]
```

---

# 12. WF-009 — Overtime Authority, COC/CTO, and Overtime Pay

```mermaid
flowchart TD
    A[Office identifies need for overtime service] --> B[Prepare overtime authority]
    B --> C[Specify employees, dates, purpose, expected hours, and compensation method]
    C --> D[Validate necessity, eligibility, and funding]
    D --> E{Approved before service?}
    E -- No --> F[No compensable authority unless exceptional rule applies]
    E -- Yes --> G[Employees render authorized service]
    G --> H[Capture attendance and accomplishment certification]
    H --> I[Compare authorized and actual hours]
    I --> J[Apply applicable CSC-DBM and agency rules]
    J --> K{Approved outcome}
    K -- Overtime pay --> L[Create payroll input]
    K -- COC --> M[Create COC ledger credit]
    K -- Non-compensable --> N[Record reason]
    M --> O[Employee later requests CTO]
    O --> P[Check COC balance and service needs]
    P --> Q{Supervisor and authorized official approve?}
    Q -- No --> R[Reject CTO request]
    Q -- Yes --> S[Create COC usage entry]
    S --> T[Update attendance as approved CTO]
```

Requested, authorized, actual, credited, used, and paid values are stored separately.

---

# 13. WF-010 — Government Payroll

```mermaid
flowchart TD
    A[Create payroll period] --> B[Set personnel profile, cutoff, and payment date]
    B --> C[Snapshot salary schedule, contribution rules, and payroll configuration]
    C --> D[Collect active service and salary-grade data]
    D --> E[Collect locked DTR, leave, OT pay, monetization, and adjustments]
    E --> F[Collect GSIS, PhilHealth, Pag-IBIG, tax, loan, and agency deductions]
    F --> G[Set CALCULATING and queue payroll job]
    G --> H[Calculate basic salary and authorized compensation]
    H --> I[Calculate absence, tardiness, undertime, and leave effects]
    I --> J[Calculate contributions, taxes, loans, and other deductions]
    J --> K[Calculate employee and employer shares]
    K --> L[Store detailed payroll lines]
    L --> M[Run variance, negative-pay, missing-data, and duplicate checks]
    M --> N{Blocking exception?}
    N -- Yes --> O[Return to payroll preparer]
    O --> P[Correct source or create authorized adjustment]
    P --> G
    N -- No --> Q[Set FOR_REVIEW]
    Q --> R[HR certifies personnel and attendance inputs]
    R --> S[Budget or fund check where required]
    S --> T[Accounting or payroll reviewer reconciles]
    T --> U{Review complete?}
    U -- No --> O
    U -- Yes --> V[Route to authorized approver]
    V --> W{Approved?}
    W -- No --> O
    W -- Yes --> X[Set APPROVED]
    X --> Y[Finalization transaction verifies unchanged approved version]
    Y --> Z{Verification passed?}
    Z -- No --> Q
    Z -- Yes --> AA[Set FINALIZED and make payroll lines immutable]
    AA --> AB[Generate payslips, registers, and remittance schedules]
    AB --> AC[Queue PDF generation and employee notification]
```

Correction after finalization:

```mermaid
flowchart TD
    A[Error found after finalization] --> B[Create correction case]
    B --> C{Correction method}
    C -- Supplemental or adjustment payroll --> D[Create linked adjustment]
    C -- Void and replace --> E[Request void approval]
    E --> F{Approved?}
    F -- No --> G[Keep original payroll]
    F -- Yes --> H[Mark original VOIDED without deleting it]
    H --> I[Create replacement payroll]
    D --> J[Run normal review and approval]
    I --> J
```

---

# 14. WF-011 — SPMS Performance Cycle

```mermaid
flowchart TD
    A[Agency opens rating cycle] --> B[Load agency and office goals]
    B --> C[Office prepares OPCR or equivalent commitments]
    C --> D[Supervisors cascade targets to employees]
    D --> E[Employee and supervisor agree on IPCR targets]
    E --> F[Approve performance commitments]
    F --> G[Monitoring period]
    G --> H[Record accomplishments, evidence, and coaching]
    H --> I{Mid-cycle review required?}
    I -- Yes --> J[Review progress and approved target changes]
    J --> G
    I -- No --> K[End-of-cycle employee self-assessment]
    K --> L[Supervisor evaluates outputs and competencies]
    L --> M[Review or calibration]
    M --> N{Rating approved?}
    N -- No --> O[Return for correction or additional evidence]
    O --> L
    N -- Yes --> P[Finalize performance rating]
    P --> Q[Generate signed performance record]
    Q --> R[Provide input to selection, development, and recognition processes]
```

Finalized ratings require controlled amendment, not direct editing.

---

# 15. WF-012 — Separation, Clearance, and Access Revocation

```mermaid
flowchart TD
    A[Employee or agency initiates separation] --> B[Record mode, reason, and proposed effectivity]
    B --> C[Validate required authority or acceptance]
    C --> D[Create clearance workflow]
    D --> E[Route property, records, cash, HR, IT, and office accountabilities]
    E --> F{Clearance complete?}
    F -- No --> G[Track pending liabilities and reminders]
    G --> F
    F -- Yes --> H[Close active service segment]
    H --> I[Release or update plantilla item]
    I --> J[Stop future schedule and payroll inclusion]
    J --> K[Preserve leave, payroll, performance, and service records]
    K --> L[Generate or update service record]
    L --> M[Deactivate agency membership on approved date]
    M --> N[Revoke active sessions]
    N --> O[Record separation and access audit events]
```

Retirement-benefit calculation remains outside MVP.

---

# 16. WF-013 — AI-Assisted HR Action

```mermaid
flowchart TD
    A[Authorized user starts AI feature] --> B[Check agency, permission, and feature policy]
    B --> C{Authorized?}
    C -- No --> D[Deny and audit]
    C -- Yes --> E[Select minimum necessary source data]
    E --> F[Redact unnecessary sensitive data]
    F --> G[Send versioned request through AI service]
    G --> H{Provider succeeded?}
    H -- No --> I[Use manual fallback]
    H -- Yes --> J[Validate structured output]
    J --> K{Valid?}
    K -- No --> L[Reject output and log failure]
    K -- Yes --> M[Display as Draft or Recommendation]
    M --> N{User decision}
    N -- Reject --> O[Discard and record outcome]
    N -- Edit --> P[User edits result]
    N -- Accept --> Q[User confirms]
    P --> Q
    Q --> R{Authoritative action needed?}
    R -- No --> S[Save approved draft or summary]
    R -- Yes --> T[Call normal HRIS workflow]
    T --> U[Recheck permission, rule, and approval]
    U --> V{Approved and valid?}
    V -- No --> W[Reject action]
    V -- Yes --> X[Execute controlled transaction and audit]
```

---

# 17. Status and Entity Implications

The workflow set requires at least these major domains:

```text
Identity and Agency
- users
- agencies
- memberships
- roles
- permissions
- sessions
- security_events

Organization and Plantilla
- organization_units
- positions
- position_histories
- qualification_standards
- position_documents

Recruitment and Appointment
- requests_to_fill
- vacancy_publications
- applicants
- applications
- assessments
- selection_board_sessions
- recommendations
- appointments
- appointment_submissions
- oaths
- assumptions

Personnel Records
- employees
- pds_versions
- eligibilities
- education_records
- training_records
- work_experiences
- service_segments
- personnel_actions
- employee_documents
- saln_compliance_records

Attendance and Leave
- work_schedules
- work_schedule_versions
- work_schedule_day_rules
- work_arrangements
- work_arrangement_versions
- schedule_assignments
- holiday_calendar_versions
- attendance_events
- attendance_contexts
- attendance_days
- attendance_day_segments
- attendance_exceptions
- attendance_corrections
- leave_types
- leave_accounts
- leave_ledger_entries
- leave_applications

Overtime
- overtime_authorities
- overtime_service_records
- coc_ledger_entries
- cto_requests
- overtime_pay_inputs

Payroll
- salary_schedules
- pay_components
- employee_compensation
- payroll_periods
- payroll_employees
- payroll_lines
- deductions
- contribution_lines
- payslips

Performance
- performance_cycles
- office_commitments
- individual_commitments
- success_indicators
- accomplishments
- performance_reviews
- ratings

Shared
- approval_requests
- approval_steps
- notifications
- audit_events
- documents
- ai_requests
```

---

# 18. Approval

| Role | Name | Decision | Date |
| ----------------------------- | ---- | -------- | ---- |
| Product Owner |  | Pending |  |
| Government HR / HRMO Reviewer |  | Pending |  |
| Payroll / Accounting Reviewer |  | Pending |  |
| Technical Owner |  | Pending |  |

---

# 19. Change Log

| Version | Date | Description |
| ------- | -------------- | ---------------------------------------------------------------------------- |
| 1.0 | August 5, 2026 | Replaced private-sector workflows with Philippine public-sector HR workflows |
