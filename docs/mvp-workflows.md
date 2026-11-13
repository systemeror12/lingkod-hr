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

| ID     | Workflow                                           |
| ------ | -------------------------------------------------- |
| WF-001 | User Invitation, Login, and Agency Access          |
| WF-002 | Plantilla Position Creation and Vacancy Control    |
| WF-003 | Vacancy Publication and Merit Selection            |
| WF-004 | Appointment Issuance, CSC Tracking, and Assumption |
| WF-005 | PDS, Employee Onboarding, and Service Record       |
| WF-006 | Personnel Action and Position Movement             |
| WF-007 | Attendance and Daily Time Record                   |
| WF-008 | Leave Application and Leave-Credit Ledger          |
| WF-009 | Overtime Authority, COC/CTO, and Overtime Pay      |
| WF-010 | Government Payroll                                 |
| WF-011 | SPMS Performance Cycle                             |
| WF-012 | Separation, Clearance, and Access Revocation       |
| WF-013 | AI-Assisted HR Action                              |

---

# 4. WF-001 — User Invitation, Login, and Agency Access

```mermaid
flowchart TD
    A[Agency Administrator invites user] --> B[Assign agency membership and role]
    B --> C[Send single-use activation link]
    C --> D{Link valid?}
    D -- No --> E[Expire or resend invitation]
    D -- Yes --> F[Verify email]
    F --> FA{First-time User?}
    FA -- Yes --> FB[Set credentials for new User]
    FA -- No --> FC[Existing User authenticates]
    FB --> G{MFA required?}
    FC --> G
    G -- Yes --> H[Enroll or complete MFA]
    G -- No --> I[Activate agency membership]
    H --> I
    I --> J[User signs in]
    J --> K{Authentication valid?}
    K -- No --> L[Generic error, rate limit, and security audit]
    K -- Yes --> M{User ACTIVE?}
    M -- No --> N[Deny protected access]
    M -- Yes --> O[Load agency memberships]
    O --> P{More than one agency?}
    P -- Yes --> Q[Select agency context]
    P -- No --> V{Agency membership ACTIVE in selected agency?}
    Q --> V
    V -- No --> N
    V -- Yes --> R[Set trusted agency context]
    R --> S[Load role, office scope, and permissions]
    S --> T[Create secure session]
    T --> U[Open authorized dashboard]
    U --> W{How does the session end?}
    W -- User signs out --> X[Revoke this session only]
    W -- 30 minutes idle or 8 hours in total --> Y[Session expires]
    W -- Lock, Factor Reset, suspension, or deactivation --> Z[Revoke the affected sessions]
    X --> AA[Return to sign-in]
    Y --> AA
    Z --> AA
```

Sign-out ends only the current session and records a `SESSION_REVOKED` Security
Event with reason `USER_LOGOUT`. `docs/hris-controls.md` §5.1, User Session,
lists every way a session ends.

User states:

```text
ACTIVE
LOCKED
```

Agency Membership states:

```text
INVITED
ACTIVE
SUSPENDED
DEACTIVATED
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
    D --> R[Notify Employee or HR]
    R --> S[Employee or HR Administrator submits evidence-backed correction]
    S --> T[Build impact preview for every affected Work Date and period]
    T --> U[HR Officer reviews factual correction]
    U --> V{Approved?}
    V -- No --> W[Reject or return with reason]
    V -- Yes, open period --> X[Atomically record effect and recalculate affected days]
    V -- Yes, locked period --> XA[Set FOR_AUTHORIZATION]
    XA --> XB[Different HR Administrator authorizes grouped locked adjustment]
    XB --> X
    X --> P
    Q --> Y[Employee reviews Daily Time Record Preview]
    Y --> Z[Employee submits exact Attendance Day versions]
    Z --> AA[HR Officer reviews and approves submission]
    AA --> AB{All applicable submissions and days approved?}
    AB -- No --> B
    AB -- Yes --> AC[Create immutable Attendance Period Version FOR_REVIEW]
    AC --> AD[HR Officer reviews complete period snapshot]
    AD --> AE{Approved?}
    AE -- Returned --> B
    AE -- Yes --> AF[Different HR Administrator runs lock reconciliation]
    AF --> AG{All lock checks pass?}
    AG -- No --> AH[Remain APPROVED with no partial outputs]
    AG -- Yes --> AI[Atomically lock, create finalized DTRs, publish attendance payroll facts, and append audit and outbox records]
    AI --> AJ{Later approved correction?}
    AJ -- No --> AK[Retain locked version and outputs]
    AJ -- Yes --> XA
```

An ordinary daytime DTR presents semantic events through the familiar AM In, AM Out, PM In, and PM Out slots. Overnight duty remains one Work Date beginning on the local date of `TIME_IN`; its view uses duty and break labels with actual dates and times. A preview is explicitly unfinalized. Each lock creates separately retained Finalized Daily Time Records and an idempotent Attendance Payroll Publication. A locked correction produces successor Attendance Day and Attendance Period Versions, corrected DTRs, and a delta publication without changing the predecessor.

Complete events on a rest day create Unscheduled Service, not approved overtime or COC. Outside-schedule and statutory-night-window minutes remain separate factual candidate-hours handoffs to Phase 8. No biometric import exists in MVP.

---

# 11. WF-008 — Leave Application and Leave-Credit Ledger

```mermaid
flowchart TD
    A[Employee or authorized recorder starts Leave Application] --> B[Select Leave Type, date ranges, typed details, and supporting Document Versions]
    B --> C[Load policy, schedule, and holiday versions effective for each requested date]
    C --> D{Required input missing or ambiguous?}
    D -- Yes --> E[Save draft and show structured deficiencies]
    D -- No --> F[Create Leave Calculation Segments]
    F --> G[Create explainable Leave Eligibility Assessment]
    G --> H{Assessment result}
    H -- INELIGIBLE --> I[Show failed rules]
    H -- INDETERMINATE --> E
    H -- ELIGIBLE --> J[Freeze Leave Application Version, attestation, evidence, form, assessment, and Approval Route Version]
    J --> K[Load posted balance and active Leave Credit Commitments under account lock]
    K --> L[HR freezes Leave Credit Certification and creates commitments]
    L --> M{Credits or authority sufficient?}
    M -- No --> N[Route as leave without pay or reject according to policy]
    M -- Yes --> O[Route to supervisor recommendation]
    O --> P[Record immutable Leave Recommendation]
    P --> R[Route to authorized approving official]
    R --> S{Decision}
    S -- Reject --> Q[Record reason, release commitments, notify Employee]
    S -- Approve full or exact subset --> T[Freeze Leave Approval Allocation and narrow commitment if needed]
    T --> U[Post atomically through Leave and owning services]
    U --> V[Insert source-linked Leave Ledger Entries when applicable]
    V --> W[Create Attendance input and Payroll Input when applicable]
    W --> X[Consume commitment, mark POSTED, and notify Employee]
```

Calculation preserves the unit prescribed by the governing source. A statutory
calendar-day benefit is not converted to an ordinary working-day ledger debit,
and a benefit outside vacation and sick leave credits does not create a posting
to those accounts.

The posted balance is derived only from immutable Leave Ledger Entries. HR
certification atomically creates separate Leave Credit Commitments; an unposted
commitment is never represented as a ledger entry, and a commitment raised
earlier the same day still counts as an active commitment. Every allocation kind
is authorized by the bound Leave Policy Version: a charging policy approves
against its certified account and classifies only the quantity the account
cannot cover as leave without pay, while a paid non-ledger policy is non-credit
and an unpaid policy is leave without pay. An authorized partial approval may
replace the certified commitment only with a linked, smaller successor. Charging
a different account, or moving credit-covered quantity to unpaid leave, requires
a successor version and recertification. Posting consumes the active commitment.
Withdrawal, rejection, material return, or supersession releases it. Commitments
do not silently expire.

A material change after submission creates a new immutable Leave Application
Version and restarts evaluation, certification, and routing. Reviewer comments,
assignments, and notifications do not create application versions. Shared
Approval Routes own tasks and immutable Approval Decisions; Leave owns the
domain validations and records the certification, Leave Recommendation, and
Leave Approval Allocation. A negative recommendation remains advisory unless an
evidenced route provides otherwise.

Posting is a separate atomic Leave-owned command. It uses stable effect keys and
owning application services to create every required ledger, Attendance, and
Payroll effect. An authoritative failure rolls back the command and leaves the
application approved for retry. Notifications and document delivery use the
outbox after commit.

### Withdrawal, cancellation, and correction

```mermaid
flowchart TD
    A{Current effect} -->|Unapproved submission| B[Employee withdraws]
    B --> C[Cancel route work and release commitment]
    A -->|Approved or posted| D[Create Leave Cancellation with exact scope and evidence]
    D --> E[Bind cancellation Approval Route Version]
    E --> F{Authorized decision}
    F -->|Reject| G[Retain APPROVED or POSTED application]
    F -->|Approve| H[Apply cancellation atomically]
    H --> I[Release unposted commitment or reverse posted ledger effects]
    I --> J[Create Attendance and Payroll correction handoffs]
    J --> K[Project application CANCELLED and expose downstream status]
```

Whole posted cancellation exactly reverses each original ledger entry. Partial
cancellation fully reverses affected original entries and posts replacements for
the retained effect. Original effective dates and later posting timestamps
preserve both effective history and knowledge history. If Attendance is locked
or a Payroll Input has been consumed, the owning subsystem accepts an idempotent
adjustment handoff rather than rewriting history. Cancellation remains approved
with its original posting effective if the atomic application command fails.

### Mandatory or forced leave

```mermaid
flowchart TD
    A[Leave command or Agency and year evaluation] --> B[Load policy, vacation balance history, and posted vacation leave for the calendar year]
    B --> C{Balance reached ten during the year?}
    C -- No --> D[NOT_SUBJECT]
    C -- Yes --> E[SUBJECT with required and fulfilled quantities]
    B -- Missing policy or account --> F[INDETERMINATE]
    D --> G{Result, quantities, basis, or policy changed?}
    E --> G
    F --> G
    G -- Yes --> H[Record Mandatory Leave Assessment]
    G -- No --> I[Keep latest assessment]
    H --> J[Show remaining days in the Leave workspace]
    J --> K[Employee files ordinary VL or Mandatory/Forced Leave application]
    K --> L[Post against vacation Leave Account when approved]
    L --> A
```

The ordinary civilian NGA baseline is five working days for an Employee whose
vacation balance reached ten during the calendar year (MC41 section 25). Any
posted vacation leave dated in that year counts, whether filed as vacation
leave or as mandatory or forced leave, and may be continuous or intermittent.
Leave posting, applied cancellation, policy activation, and vacation ledger
entries re-evaluate in the same transaction; a Leave Administrator evaluates
the Agency for a new year. The Leave workspace prompts the Employee; Phase 7
sends no notification. An assessment never posts forfeiture, and Phase 7 does
not post forfeiture at all, so the section 25 exigency cancellation and
retirement or resignation exceptions are not evaluated.

### Leave monetization

```mermaid
flowchart TD
    A[Employee submits Leave Monetization Request Version] --> B[Create explainable eligibility assessment]
    B --> C{Eligible and determinate?}
    C -- No --> D[Block or reject with reasons]
    C -- Yes --> E[HR certifies credits under all account locks]
    E --> F[Create per-account Leave Credit Commitments]
    F --> G[Budget Officer records funding determination]
    G --> H{Funded and determinate?}
    H -- No --> D
    H -- Yes --> I[Route exact version for authorized approval]
    I --> J{Decision}
    J -- Reject --> K[Release commitments and preserve decision]
    J -- Approve full or smaller same-account allocations --> L[Record approval without posting]
    L --> M[Post atomically through Leave and Payroll]
    M --> N{Payroll handoff result}
    N -- Rejected or retryable failure --> O[Keep approval and commitments with truthful result]
    N -- Accepted or matching duplicate --> P[Create source-owned negative ledger entries]
    P --> Q[Consume commitments and mark posted]
```

Payroll resolves and freezes the authoritative salary source, fixed calculator,
factor, evidence-backed valuation and rounding configuration, and calculated
amount in its Monetization Earning Input. Leave never supplies a free-form
salary or payout amount. Missing authority or configuration is indeterminate and
blocks the ledger deduction.

Withdrawal, rejection, material return, supersession, invalid eligibility, or
invalid funding releases commitments. An approved Monetization Adjustment uses
one atomic owner-service command. Pending Payroll Inputs are cancelled or
replaced; consumed inputs receive a linked adjustment. Leave restores credits
only after Payroll accepts the correction handoff, and finalized payroll remains
immutable. A failed handoff leaves the original posting effective for retry.

### Terminal-leave input preservation

```mermaid
flowchart TD
    A[Separation takes effect] --> B[Complete required Leave postings through last service date]
    B --> C[Separation requests terminal-leave input preservation]
    C --> D[Evaluate separation, service, account, authority, clearance, and salary-source facts]
    D --> E{Assessment result}
    E -- INDETERMINATE --> F[Preserve missing or conflicting facts without a consumable snapshot]
    E -- READY --> G[Freeze Terminal Leave Input Snapshot]
    G --> H[Return stable snapshot reference to Separation]
    H --> I{Separation handoff outcome}
    I -- Accepted or duplicate --> J[Retain accepted reference]
    I -- Rejected or retryable --> K[Retain reason for correction or retry]
    K --> D
```

The snapshot uses the effective separation or last service date for its balance
cutoff and states a separate ledger-knowledge cutoff. A corrected source creates
a reasoned successor rather than rewriting history. Phase 7 does not compute a
terminal benefit, create a terminal ledger posting, or send a terminal Payroll
Input.

---

# 12. WF-009 — Overtime Authority, COC/CTO, and Overtime Pay

```mermaid
flowchart TD
    A[Office identifies need for overtime service] --> B[Prepare overtime authority]
    B --> C[Specify Appointed Personnel, Work Dates, purpose, authorized hours, and proposed method]
    C --> D[Review necessity and eligibility; attest facts the system does not hold]
    D --> E{Approved before service?}
    E -- No --> F[No service can be recorded]
    E -- Yes --> E2[Approving Official fixes COC or overtime pay and snapshots eligibility]
    E2 --> G[Employees render authorized service]
    G --> H[Record claimed hours and accomplishment]
    H --> I[Read Actual Overtime Hours from locked Attendance]
    I --> J{Certifier certifies?}
    J -- No --> N[Record reason; NOT_CERTIFIED]
    J -- Yes --> K{Method}
    K -- Overtime pay --> L[Payroll Input, refused until Payroll supports it]
    K -- COC --> M1[HR prepares monthly Certificate of COC Earned]
    M1 --> M2[Approving Official approves certificate]
    M2 --> M[COC module credits COC, applying ratio, caps, and validity]
    M --> O[Employee later requests CTO]
    O --> P[Check COC balance and service needs]
    P --> Q{Supervisor and authorized official approve?}
    Q -- No --> R[Reject CTO request]
    Q -- Yes --> S[Approval posts COC usage by Valid Until]
    S --> T[Same transaction creates Attendance CTO inputs]
```

Claimed, authorized, actual, certified, credited, used, and paid values are stored separately.

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

| Role                          | Name | Decision | Date |
| ----------------------------- | ---- | -------- | ---- |
| Product Owner                 |      | Pending  |      |
| Government HR / HRMO Reviewer |      | Pending  |      |
| Payroll / Accounting Reviewer |      | Pending  |      |
| Technical Owner               |      | Pending  |      |

---

# 19. Change Log

| Version | Date           | Description                                                                  |
| ------- | -------------- | ---------------------------------------------------------------------------- |
| 1.0     | August 5, 2026 | Replaced private-sector workflows with Philippine public-sector HR workflows |
