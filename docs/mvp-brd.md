# Business Requirements Document (BRD)

## Philippine Public-Sector HRIS MVP

**Document status:** Draft for approval  
**Product profile:** Philippine civilian public-sector HRIS  
**Primary implementation profile:** National Government Agency (NGA)  
**Extensible profiles:** Local Government Unit (LGU), State University and College (SUC), and GOCC with original charter  
**Architecture:** Multi-tenant SaaS, with optional dedicated-agency deployment  
**Primary objective:** Digitize and control government human resource management processes  
**Version:** 1.0  
**Date:** August 5, 2026

---

# 1. Executive Summary

This document replaces the earlier private-sector HRIS assumptions with requirements designed for the Philippine public sector.

A public-sector HRIS is not merely a private HRIS with different payroll deductions. It must manage government positions, plantilla items, qualification standards, merit selection, appointments, assumption to duty, personnel actions, service records, government leave credits, Daily Time Records, salary grades and steps, government payroll, GSIS-related deductions, Civil Service forms, performance records, and regulatory reporting.

The MVP will support the employee lifecycle from an authorized plantilla position through vacancy publication, merit selection, appointment, personnel administration, attendance, leave, overtime or compensatory time, payroll, performance review, and separation.

The initial implementation profile is for a civilian National Government Agency. LGUs, SUCs, and GOCCs with original charters have additional rules and forms, so the product will use configurable agency profiles rather than assuming that every public institution operates identically.

---

# 2. Public- and Private-Sector Product Separation

The public-sector product profile shall be maintained separately from a private-sector HRIS profile.

| Area              | Private-sector HRIS                      | Public-sector HRIS                                                                                           |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Position control  | Company-defined jobs and headcount       | Authorized organizational structure, plantilla, item number, salary grade, and step                          |
| Hiring            | Company recruitment policy               | Publication, qualification standards, merit selection, appointing authority, and CSC appointment rules       |
| Employee record   | Company employee profile                 | PDS, eligibility, appointment, oath, assumption, service record, and personnel actions                       |
| Employment status | Regular, probationary, contractual, etc. | Career/non-career and government appointment statuses under applicable rules                                 |
| Performance       | Company appraisal                        | Agency SPMS, OPCR/IPCR, targets, ratings, and review cycle                                                   |
| Leave             | Company policy and labor law             | Government leave credits, CSC leave rules, Form 6, mandatory leave, monetization, and special leave          |
| Overtime          | Company-authorized OT pay                | Prior-authorized overtime service, overtime pay or COC/CTO, subject to applicable rules and funds            |
| Payroll           | Company pay structure and SSS            | Salary grade/step, DBM salary schedule, GSIS, government allowances, and agency-specific deductions          |
| Audit             | Management and statutory audit           | CSC, DBM, COA, agency internal control, records, and public accountability requirements                      |
| Separation        | Company clearance/final pay              | Acceptance of resignation, clearance, service record, retirement or separation action, and access revocation |

The system shall not mix public- and private-sector rule engines within one organization profile.

---

# 3. Regulatory and Policy Baseline

The public-sector HRIS shall be designed around official rules and forms, including:

- Civil Service Commission 2025 Omnibus Rules on Appointments and Other Human Resource Actions (ORAOHRA);
- the applicable CSC Personal Data Sheet and Work Experience Sheet;
- CSC Omnibus Rules on Leave, as amended;
- CSC Strategic Performance Management System guidance;
- CSC competency-based HRM and qualification standards;
- DBM position classification, compensation, staffing, and salary schedule issuances;
- CSC-DBM rules on overtime pay and compensatory time;
- GSIS, PhilHealth, Pag-IBIG, and BIR requirements;
- Commission on Audit and government internal-control requirements;
- Data Privacy Act and National Privacy Commission guidance;
- applicable agency Merit Selection Plan, SPMS, PRAISE, and internal policies.

All rates, forms, rule tables, and policy versions shall be effective-dated and configurable. The software shall not hard-code current values as permanent rules.

As of August 2026, CSC has temporarily deferred PRIME-HRM accreditation, validation, assessment, reassessment, maturity determination, and related activities while the program is being upgraded. The HRIS may align its modules with public-sector HRM domains, but the product shall not represent itself as guaranteeing or conferring PRIME-HRM accreditation.

---

# 4. Target Agencies and MVP Boundary

## 4.1 Primary target

The first production profile shall target civilian National Government Agencies.

## 4.2 Future or configurable profiles

The architecture shall permit later support for:

- LGUs;
- SUCs and LUCs;
- GOCCs with original charters;
- constitutional bodies and other agencies with special charters.

## 4.3 Excluded from the first MVP

The first MVP does not fully support:

- military and uniformed personnel;
- elective officials and barangay-specific compensation;
- judiciary-specific appointment and payroll rules;
- GOCCs governed primarily by private-sector labor rules;
- public-school teacher-specific workload and payroll variations;
- medical personnel benefits under every special law;
- direct CSC, DBM, COA, GSIS, PhilHealth, Pag-IBIG, or BIR electronic submission;
- biometric-device integrations or biometric export-file imports;
- vendor-specific attendance parsers;
- full administrative-case adjudication;
- full learning and development management;
- full PRAISE rewards and recognition administration;
- pension or retirement-benefit computation;
- applicant self-service accounts.

Job Order and Contract of Service personnel may be recorded, but their engagement and payment rules shall remain separate from regular plantilla employee payroll.

---

# 5. Business Objectives

The MVP shall:

1. Maintain authorized agency structures, plantilla positions, and position histories.
2. Control recruitment, selection, appointment, and assumption-to-duty workflows.
3. Maintain complete government personnel records and service histories.
4. Automate DTR, attendance exceptions, leave credits, and leave applications.
5. Manage authorized overtime, COC, CTO, and overtime-pay outcomes.
6. Calculate government payroll using salary grade, step, compensation rules, and statutory deductions.
7. Support SPMS performance planning, review, rating, and sign-off.
8. Provide secure employee, supervisor, HR, payroll, and appointing-authority access.
9. Produce traceable forms, registers, reports, and audit records.
10. Preserve historical rule versions and finalized payroll results.
11. Reduce spreadsheet dependence without removing required human review.
12. Use AI only for controlled extraction, drafting, explanation, and exception summarization.

---

# 6. Primary Users and Stakeholders

| Role                                       | Responsibilities                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Agency Administrator                       | Agency profile, security, users, and configuration                                                        |
| HR Administrator                           | Broad HR administration, attendance configuration and locking, and inherited HR Officer attendance access |
| HR Officer                                 | Attendance review and approval within assigned scope, with inherited Employee attendance access           |
| HRMPSB / Selection Board Member            | Candidate evaluation, deliberation, and recommendations                                                   |
| Appointing Authority / Authorized Approver | Appointment and designated high-level approvals                                                           |
| Supervisor / Division Chief                | Leave, overtime, and performance review                                                                   |
| Payroll Preparer                           | Payroll data, calculation, deductions, and reconciliation                                                 |
| Payroll Reviewer / Certifying Officer      | Review, certification, and exception resolution                                                           |
| Payroll Approver / Agency Authority        | Payroll authorization and finalization                                                                    |
| Employee / Official                        | PDS, attendance submission, DTR, leave, payslip, performance commitments, and self-service                |
| Budget Officer                             | Position and personnel-services validation                                                                |
| Accounting Office                          | Payroll obligations, deductions, and accounting reports                                                   |
| Cashier / Disbursing Officer               | Payment processing and remittance support                                                                 |
| Records Officer                            | Retention, document control, and certified records                                                        |
| Internal Audit / COA Auditor               | Audit evidence and control review                                                                         |
| Data Protection Officer                    | Privacy, access, retention, and incident controls                                                         |

---

# 7. MVP Modules

1. Authentication, login, and account lifecycle
2. Agency organization and office structure
3. Plantilla and position control
4. Recruitment, selection, and placement
5. Appointment and assumption to duty
6. Personnel records, PDS, and service record
7. Personnel actions and employment history
8. Attendance and Daily Time Record
9. Leave administration and leave-credit ledger
10. Overtime service, COC, CTO, and overtime pay
11. Government payroll
12. SPMS performance management
13. Employee and supervisor self-service
14. Government forms, documents, and reports
15. Notifications and approvals
16. Audit trail and security events
17. Controlled AI assistance

---

# 8. Authentication and Access Requirements

## AUTH-001 Individual accounts

Every user shall have an individual account. Shared accounts are prohibited.

## AUTH-002 Login

The MVP shall support email and password login owned by LingkodHR. LingkodHR shall verify passwords and second factors itself and issue its own sessions. No managed identity provider or OIDC service shall sit in the login path.

## AUTH-003 Invitation and activation

Authorized administrators shall invite users, assign agency membership and roles, and track activation.

## AUTH-004 Password Reset

The system shall support secure, non-disclosing password-reset workflows.

## AUTH-005 User and Agency Membership statuses

A User and each of the User's Agency Memberships carry separate statuses. Access to an Agency requires both an ACTIVE User and an ACTIVE Agency Membership in that Agency.

User statuses:

```text
ACTIVE
LOCKED
```

Agency Membership statuses:

```text
INVITED
ACTIVE
SUSPENDED
DEACTIVATED
```

## AUTH-006 MFA

MFA shall be supported and may be required for:

- agency administrators;
- HRMO users;
- payroll users;
- appointing authorities;
- users with access to compensation, bank details, or government identifiers.

## AUTH-007 Session controls

The system shall support secure sessions, timeout, logout, session revocation, and reauthentication for sensitive actions.

## AUTH-008 Authorization

Login establishes identity only. Every protected operation shall also check:

- agency membership;
- role and permission;
- office or organizational scope;
- employee-record relationship;
- workflow state;
- sensitive-field access.

## AUTH-009 Login audit

Successful and failed login, invitation, activation, reset, lock, suspension, and revocation events shall be audited.

---

# 9. Agency Organization Requirements

## ORG-001 Agency profile

The system shall store:

- official agency name and acronym;
- agency type;
- department or parent organization;
- agency code and reporting identifiers;
- head of agency;
- appointing authority;
- registered offices and regions;
- default timezone and currency;
- payroll and remittance settings;
- CSC accreditation or agency-profile information where applicable.

## ORG-002 Organization structure

The system shall maintain effective-dated:

- central, regional, field, and satellite offices;
- services, bureaus, divisions, sections, and units;
- reporting relationships;
- cost centers and responsibility centers;
- office heads;
- abolished, merged, renamed, and reorganized units.

## ORG-003 Agency policy profiles

The system shall support versioned internal policies for:

- Merit Selection Plan;
- SPMS;
- attendance and flexible work arrangements;
- leave administration;
- overtime and compensatory time;
- payroll cutoffs and approvals;
- data retention;
- records classification;
- separation of duties.

---

# 10. Plantilla and Position Control Requirements

## POS-001 Authorized position

Each plantilla position shall store:

- unique position or item number;
- position title;
- parenthetical title where applicable;
- salary grade;
- authorized step or incumbent step;
- office and organizational unit;
- employment category;
- funding source;
- position status;
- qualification standard;
- position description form reference;
- creation, reclassification, transfer, abolition, or conversion history.

## POS-002 Position statuses

```text
PROPOSED
AUTHORIZED
VACANT
RESERVED
OCCUPIED
FROZEN
ABOLISHED
```

## POS-003 Position-incumbent relationship

A plantilla item shall have no more than one active incumbent unless a specific lawful exception is configured.

## POS-004 Qualification standards

The system shall maintain requirements for:

- education;
- training;
- experience;
- civil service eligibility;
- competency requirements;
- licenses or special qualifications.

## POS-005 Position history

Changes to title, salary grade, office, funding, or status shall be effective-dated and shall not overwrite history.

## POS-006 Vacancy control

Recruitment for plantilla appointments shall originate from a valid vacant authorized position.

---

# 11. Recruitment, Selection, and Placement Requirements

## RSP-001 Request to fill

HR or the requesting office shall create a request to fill only for a Recruitable Vacancy. During controlled review, the server shall resolve exactly one active Agency Merit Selection Plan Version and its applicable Merit Selection Criteria Set, Board Definition, effective Board Appointments, and required Approval Route Versions. Zero or multiple applicable matches shall block publication.

The resolved bindings shall be agency-scoped and immutable after publication. Before publication, an authorized MSP Rebaseline shall require a reason, authority, evidence, and Audit Event. A material policy change after publication shall require cancellation and republication with lineage.

The Reference Agency Profile shall contain no invented active MSP, criteria, board appointments, approval hierarchy, signatories, or agency procedure. Missing Pilot Agency facts are Configurable Placeholders that block the affected transition.

## RSP-002 Publication

The system shall track:

- exact CS Form No. 9 Document Version;
- posting dates;
- closing date;
- CSC Field Office submission, CSC Job Portal publication, at least three Agency posting places for the required period, supplemental channels, and their available references or timestamps;
- position details;
- the bound Qualification Standard Version;
- application requirements;
- active contact details, posting evidence, and HRMO certification.

Unsupported publication exceptions shall fail closed. Materially incorrect publication data shall be cancelled and republished rather than silently corrected.

Publication remains valid until filled but no longer than nine months unless a separately sourced exception applies.

## RSP-003 Applicant record

The applicant record shall support information needed for government recruitment, including:

- PDS-compatible personal data;
- education;
- training;
- experience;
- eligibility;
- licenses;
- performance ratings where required;
- documents;
- consent and privacy notice;
- applied position.

## RSP-004 Qualification screening

The system shall compare applicant evidence with the Qualification Standard Version bound to the Recruitment Case and identify:

- meets requirements;
- conditionally reviewable;
- does not meet requirements;
- missing evidence.

The system shall not automatically make the final qualification or selection decision. Corrections to screening or assessment results shall create reasoned replacement versions and preserve the original evidence-backed result.

## RSP-005 Merit selection

The system shall support:

- initial screening;
- examination or assessment;
- interview;
- competency assessment;
- comparative evaluation;
- board deliberation;
- ranking or recommendation;
- appointing-authority decision;
- conflict-of-interest disclosure.

Criteria, weights, scales, cutoffs, rounding, tie rules, required evidence, and evaluator eligibility shall come from the bound Merit Selection Criteria Set rather than executable agency-specific workflow code.

## RSP-006 Selection board records

Board Definition, Board Appointment, frozen Board Roster Snapshot, actual participation, attendance, declarations, recusals, applicant-specific quorum, scores, deliberation, and recommendation shall be distinct and auditable. One person shall not fill two voting seats or act as both voting member and secretariat. Conflicted or recused members shall be excluded from the affected applicant's evaluation and quorum.

The Board Recommendation and Comprehensive Candidate Evaluation Report are advisory. The appointing authority's Selection Decision is a separate Recruitment record, not an Approval Decision. A later Appointment return, invalidation, cancellation, or failure to assume shall not alter it.

## RSP-007 Non-selection and applicant status

Decisions and notices shall be recorded without exposing confidential deliberation beyond authorized users.

---

# 12. Appointment and Assumption-to-Duty Requirements

## APP-001 Appointment preparation

Appointment shall accept an immutable selected-candidate package through the Recruitment application service and revalidate the current reservation through the Plantilla application service. It shall prepare appointment data using:

- exact selected Application;
- reserved Plantilla Position;
- Employment Status;
- nature of appointment;
- salary grade and step;
- effectivity;
- appointing authority;
- qualification evidence;
- the applicable exact CS Form No. 33 variant and Document Version;
- required evidence and exact supporting Document Versions.

Supporting records include the applicable PDS and Work Experience Sheet, proof of eligibility, Position Description Form, selection and publication certifications, authority or delegation evidence, and condition-specific attachments.

The Agency's evidenced regulatory or accreditation status shall select exactly one supported form and submission package. The regulated path uses CS Form No. 33-A, Revised 2025 with CS Form No. 1, Revised 2025. The accredited or deregulated path uses CS Form No. 33-B, Revised 2025 with CS Form No. 2, Revised 2025. Missing or unsupported Agency configuration shall block issuance rather than use a Reference Agency default.

Every Appointment shall retain the applicable authority version and date. The 2025 ORAOHRA took effect on August 3, 2025 and shall not be treated as timeless.

## APP-002 Appointment validation

Before issuance, the system shall validate:

- vacant authorized item;
- qualification requirements;
- required publication and selection steps;
- documentary completeness;
- compensation alignment;
- absence of conflicting active incumbency.

Issuance shall also require the authorized appointing authority, a still-valid reservation, the applicable signature contract, and all required evidence. It shall freeze the signed Appointment Version, exact Document Version, issue date, authority, and acknowledgment path. Rubber-stamped signatures and initials are not supported; electronic or digital signatures require their applicable evidenced certification contract.

## APP-003 Appointment workflow statuses

```text
DRAFT
FOR_REVIEW
FOR_SIGNATURE
ISSUED
CANCELLED
```

Employment Status and Nature of Appointment are separate official attributes. A Draft may be edited, but a correction after issuance shall create an authorized linked replacement or successor with reason and evidence.

## APP-004 CSC transaction tracking

The MVP shall append external submission, acknowledgment or receipt, return, resubmission, and official CSC action events against an exact Appointment Version and evidence Document Version. Regulated agencies use approval or disapproval; accredited or deregulated agencies use validation or invalidation. Events shall preserve the external reference, event date and time when available, receiving office, recording actor, and reason or deficiency.

External events are the source of truth and may produce a derived standing for display or command eligibility. Downloading a form, internal approval, elapsed time, or an absent response shall not create an external action. Direct CSC integration is future scope.

Submission deadlines and receiving office shall come from evidenced Agency configuration. The national baseline is within 30 calendar days from issuance for regulated agencies and on or before the 30th day of the succeeding month for accredited or deregulated agencies.

## APP-005 Oath and assumption

The system shall record:

- the oath using the exact SS Porma Blg. 32, Narebisa 2025 Document Version;
- certification using the exact CS Form No. 4, Revised 2025 Document Version;
- actual assumption date;
- administering and certifying authorities;
- certification time, signatures, and supporting evidence;
- appointee receipt or acknowledgment of the issued Appointment;
- failure to assume or lawful pre-assumption cancellation evidence.

CSC approval or validation is not a prerequisite for oath, Assumption to Duty, salary entitlement, or service activation. After issuance, external CSC tracking and oath or assumption may advance independently. Corrections shall preserve the former oath or assumption version, reason, authority, evidence, and dependent recalculation. The conflicting national oath-copy deadline shall remain a Configurable Placeholder while both oath and assumption dates and the actual submission event are preserved.

The period to assume shall run from evidenced receipt of the issued Appointment. `DID_NOT_ASSUME` requires the applicable notice, authority, dates, and evidence; any exception must come from configured authority rather than inference.

## APP-006 Employee creation

Only Appointment's immutable Assumed Appointment Contract shall activate an Employee and Service Segment through Personnel and create Position Incumbency through Plantilla. The owning application services shall apply the handoff idempotently and atomically, then Recruitment may close the Recruitment Case. Selection or issuance alone shall not create service or occupancy.

A later adverse CSC action shall remain external history and route to the applicable evidence-backed personnel-action or separation contract. It shall not erase service already rendered or rewrite the Selection Decision, issued Appointment, oath, or assumption.

---

# 13. Personnel Records and PDS Requirements

## PER-001 PDS

The system shall maintain the applicable CSC Personal Data Sheet structure, including:

- personal information;
- family background;
- education;
- eligibility;
- work experience;
- voluntary work;
- learning and development;
- other information and declarations;
- references;
- government-issued identifiers;
- attachments and version history.

## PER-002 Employee master record

The employee record shall store:

- agency employee number;
- current appointment;
- plantilla item;
- office and supervisor;
- appointment status;
- first government-service date;
- agency-service date;
- current salary grade and step;
- tax, GSIS, PhilHealth, Pag-IBIG, and bank details;
- work arrangement;
- separation or retirement information.

## PER-003 Service record

The system shall generate a service history from effective-dated service segments and personnel actions.

## PER-004 Personnel actions

The system shall support records for:

- original appointment;
- promotion;
- transfer;
- reappointment;
- reinstatement;
- reemployment;
- detail;
- reassignment;
- designation;
- demotion where applicable;
- salary adjustment;
- step increment;
- change of status;
- secondment where applicable;
- separation.

## PER-005 Documents

Documents shall include:

- PDS and WES;
- appointment paper;
- oath of office;
- assumption to duty;
- medical certificate;
- clearances;
- eligibility evidence;
- diplomas and transcripts;
- training certificates;
- licenses;
- performance ratings;
- SALN filing compliance record;
- notices of salary adjustment;
- separation records.

## PER-006 SALN boundary

The system may track filing requirement, submission date, status, repository, and acknowledgment. The MVP shall not expose SALN content broadly or act as a public SALN repository.

## PER-007 Record correction

Corrections shall preserve the original value, supporting document, approving authority, and audit history.

---

# 14. Attendance and Daily Time Record Requirements

## ATT-001 Supported attendance sources

The MVP shall support:

- authorized manual time entry;
- employee web clock-in and clock-out when enabled;
- immutable HR-entered Attendance Context for already-authorized official business, official travel, training, and approved non-leave absence;
- posted leave supplied by the Leave domain without copying the Leave Application into Attendance.

Attendance Context shall not introduce another approval workflow. An authorized HR Administrator records the covered Work Date or exact interval, reason, recorder, and linked source record or supporting Document Version. Attendance Correction is the approval path for adding, replacing, or voiding an Attendance Event or Attendance Context.

The MVP shall not support biometric-device integrations or biometric export-file imports.

## ATT-002 Work schedules

The system shall support:

- a dedicated Attendance configuration section for reusable Work Schedules and their immutable, effective-dated versions;
- seven Day Rules per Work Schedule Version, with fixed or flexible duty, rest days, required whole minutes, unpaid breaks, and event-collection windows;
- regular, authorized flexible, compressed, daytime, overnight, and shifting schedules through the same Day Rule model;
- Work Arrangement Versions that define the authorized place or operating mode separately from expected duty intervals;
- non-overlapping Schedule Assignments that bind eligible Appointed Personnel to one Work Schedule Version and one Work Arrangement Version for an effective period;
- stable, scoped Holiday Calendars with immutable effective-dated versions and categorized source issuances;
- explicit authority evidence for activated schedule, arrangement, calendar, and assignment records.

A duty or break interval may end on the next calendar day. Its Work Date is the local date on which the duty interval begins in the Work Schedule Version's time zone. The system shall seed an authority-backed ordinary Work Schedule Version but shall not silently use it when an explicit Schedule Assignment is missing.

## ATT-003 Raw time events

Original time events shall remain immutable. Raw event types are `TIME_IN`, `BREAK_OUT`, `BREAK_IN`, and `TIME_OUT`; AM In, AM Out, PM In, and PM Out are ordinary daytime DTR presentation slots rather than source-event types. Corrections shall be stored separately and may add, replace, or void a source event without deleting it.

## ATT-004 DTR

The system shall generate:

- an explicitly unfinalized Daily Time Record Preview from an Employee's current approved Attendance Day versions;
- one immutable Finalized Daily Time Record per Employee from each locked Attendance Period Version; and
- an Exact Versioned Form only when a supported national or agency-approved template version and its authority evidence are configured.

The ordinary printable DTR is a Printable System View and shall not imply a universal official form. A corrected successor shall create a new retained DTR linked to its predecessor. Each printable output shall identify its Attendance Period, version, original or corrected classification, lock timestamp, and applicable authoritative template revision. Full source-version lineage shall remain available from the record and audit history.

## ATT-005 Attendance calculations

The system shall calculate:

- expected-duty, worked, covered, and outside-schedule minutes;
- mutually exclusive tardiness, undertime, and absence minutes without double-counting an Attendance Deficit;
- official business, official travel, training, approved non-leave absence, and posted-leave coverage;
- incomplete, duplicate, out-of-order, unmatched, and ambiguous time events as blocking Attendance Exceptions;
- holiday and work-arrangement classification from the exact effective versions;
- factual outside-schedule and statutory-night-window minutes without treating them as authorized overtime, COC, night differential, or compensation.

Calculations shall use exact whole minutes without a default grace period or timestamp rounding. One immutable Attendance Day calculation version shall preserve its governing service applicability, Schedule Assignment, Work Schedule Version, Work Arrangement Version, Holiday Calendar Version, source records, rules, and non-overlapping Attendance Day Segments. Missing or conflicting authoritative input shall fail closed as an Attendance Exception.

For flexible duty, the first qualifying worked or Attendance Context minute within the permitted start window shall anchor the expected interval; earlier coverage clamps to the earliest start, later coverage uses the latest start and produces tardiness, and no coverage uses the latest start only to place the required absent minutes. Scheduled unpaid breaks remain outside expected duty. A fully uncovered expected Work Date is absence; otherwise leading, trailing, and internal uncovered minutes are tardiness, undertime, and absence respectively.

## ATT-006 Correction workflow

An Employee may submit an Attendance Correction for their own record, and an HR Administrator may submit one within assigned scope with an on-behalf reason and evidence. Each request shall preserve the subject, initiator, recorder, exact target or proposed source fact, `ADD`, `REPLACE`, or `VOID` values, reason, immutable evidence references, resolved Approval Route Version, and Attendance Correction Impact Preview.

An HR Officer shall review the factual correction and shall not be the subject, initiator, recorder, or effect applier. Approval and application against an open period shall occur atomically against the previewed source versions. A post-lock correction shall additionally require authorization by a different HR Administrator before it creates one grouped Locked Attendance Adjustment across every affected Attendance Day or Attendance Period. Any intervening source change shall require a refreshed preview and approval.

Applying a correction shall preserve the original source, create an immutable Attendance Correction Effect, and recalculate every affected Work Date, including both sides of a changed event-window or period boundary. A resulting Attendance Exception shall block later period review without undoing the approved factual correction.

## ATT-007 Period locking

An Employee Attendance Submission shall bind one Employee's exact Attendance Day versions within an Attendance Period. An HR Officer may return or approve the submission; recalculation makes it stale. Every covered Employee shall have an approved submission, including a reasoned and evidenced on-behalf submission where permitted, before period review.

Submitting an Attendance Period for review shall create an immutable Attendance Period Version containing the complete applicable Employee and Work Date population and the exact approved Attendance Day versions. Versions shall progress through `FOR_REVIEW`, `APPROVED`, `RETURNED`, or `LOCKED`; Attendance Days shall not carry period review, lock, or adjustment states. A returned version shall remain immutable. A locked version shall never reopen or be overwritten.

An HR Officer shall approve an Attendance Period Version, and a different HR Administrator shall lock it. Lock shall fail closed unless Attendance Period Reconciliation proves complete applicability, current approved submissions and Attendance Day versions, no unresolved exceptions or corrections, unchanged source bindings, valid routed authority, and matching DTR and payroll-publication counts and minute totals.

Locking shall atomically create Finalized Daily Time Records, one immutable and idempotent Attendance Payroll Publication, and audit and outbox records. Attendance Payroll Facts shall identify the Employee, Work Date, classification, exact nonnegative minutes, source Attendance Day version, holiday classification, and stable source key without assigning a rate, amount, deduction, or target payroll period. Posted leave remains Leave-owned for payroll effects, and Leave charges tardiness and undertime facts through Attendance Deficit Charges.

A Locked Attendance Adjustment shall create and lock a complete successor Attendance Period Version rather than reopen its predecessor. Its adjustment publication shall link the predecessor, omit unchanged facts, and state each changed fact's prior value, corrected value, and nonnegative `INCREASE` or `DECREASE` difference. Outside-schedule and statutory-night-window minutes shall remain separate factual candidate-hours handoffs to Overtime and COC processing.

---

# 15. Leave Administration Requirements

## LEA-001 Government leave types

The system shall support agency-scoped Leave Types governed by immutable,
effective-dated Leave Policy Versions. A policy version shall use fixed,
validated evaluator kinds and typed parameters rather than administrator-authored
formulas. It shall bind applicable national rules, evidence-backed Agency
configuration, authority references, personnel applicability, evidence
requirements, and these category capabilities:

- entitlement basis: accrued account, periodic allowance, qualifying event, or
  non-credit authorization;
- calendar basis: working day, calendar day, scheduled time, or a duration
  prescribed by the governing source;
- the credited or charged Leave Type, where one category affects another
  category's Leave Account; and
- accumulation, expiration, forfeiture, and conversion behavior.

The supported catalogue shall include:

- vacation leave;
- sick leave;
- mandatory or forced leave;
- maternity leave;
- paternity leave;
- special privilege leave;
- solo parent leave;
- rehabilitation leave;
- study leave;
- adoption leave;
- wellness leave where applicable;
- leave for victims of violence;
- special emergency leave;
- other leave under law or CSC issuance;
- leave without pay.

Coverage shall follow the applicable authority profile. The system shall not
apply ordinary civilian NGA vacation and sick leave rules to teachers,
special-law personnel, JO/COS Workers, or other excluded categories without an
applicable source. Missing, ambiguous, or conflicting authority shall produce
an `INDETERMINATE` result rather than an assumed entitlement.

## LEA-002 Leave-credit ledger

Vacation and sick leave credits shall use one Leave Account per Employee,
credit-bearing Leave Type, and continuous agency-employment entitlement period.
Separation closes the account after its required postings; reemployment opens a
new account from zero or from an evidence-backed opening or transfer source.

The posted balance shall be the sum of signed, immutable Leave Ledger Entries.
Each entry shall contain the account, quantity, effective date, unique source
posting key, governing Leave Policy Version, posting actor and time, and an
original-entry reference when it reverses a posting. The authoritative source,
not a ledger entry-type enum, shall identify whether a posting arose from an
opening balance, accrual, leave use, restoration, transfer, monetization,
terminal event, forfeiture, or authorized adjustment.

Posted entries shall never be edited. A reversal shall exactly negate its
original entry in the same account. An adjustment shall require authority,
evidence, and a reason. Balance-sensitive posting shall lock the account,
recalculate availability, reject overspending, enforce source idempotency, and
commit atomically.

The balance contract shall distinguish:

- posted balance as of an effective date and ledger knowledge cutoff;
- active Leave Credit Commitments, which never enter the ledger; and
- currently available credits after those commitments and the transaction under
  review.

Tardiness and undertime shall be charged to vacation leave through Attendance
Deficit Charges (CSC MC No. 41, s. 1998, section 34;
[ADR 0012](adr/0012-charge-each-attendance-deficit-fact-once.md)). After each
Attendance Period Lock or Locked Attendance Adjustment, Leave shall read the
Attendance Payroll Publication through Attendance's application service and,
with no human step, create one immutable charge for each `TARDINESS` or
`UNDERTIME` Attendance Payroll Fact, unique by that fact. An `ABSENCE` fact
shall never be charged (section 50).

Each charge shall convert the fact's minutes to a fraction of a day through
MC No. 41 Table II and draw on the Employee's vacation Leave Account in Work
Date order: the posted balance as of the Work Date, or the current posted
balance when lower, less active Leave Credit Commitments. The covered part
shall post one negative Leave Ledger Entry effective on the Work Date. The
uncovered part shall be the Unpaid Deficit Remainder (section 56), which Leave
shall send to Payroll as one Payroll Input in the same transaction. Sick leave
shall never be charged; undertime for health reasons shall be an ordinary sick
Leave Application over those hours.

A charge shall be decided once. A later credit posting, restoration, or
cancellation shall not reopen it. Only an adjustment publication shall change
it: Leave shall reverse the earlier charge's ledger entry, create a successor
charge from the corrected minutes, and send Payroll a linked correcting input.

A fact shall stay uncharged, with its reason, when its Work Date's expected
duty is not 480 minutes or when the Employee has no applicable vacation Leave
Policy Version and Leave Account. No authority located states the conversion
for those days (#654). Rerunning the charge shall pick the fact up once the
missing fact exists.

Ordinary vacation and sick leave rules, category-specific units, transfers,
restorations, forfeitures, and Agency configuration boundaries are documented in
[the authoritative leave research](research/authoritative-leave-credit-and-mandatory-leave-rules.md).

## LEA-003 Leave application

The Leave Application shall be a stable Agency-scoped case. Its mutable initial
draft becomes an immutable Leave Application Version at each submission or
material resubmission. A submitted version shall preserve the typed request
facts required by the applicable government form and Agency process, including
the Leave Type, requested date ranges, source-prescribed unit, policy-relevant
details, commutation choice where applicable, and Employee declarations.

Each submitted version shall bind the exact applicable form-template Document
Version, exact supporting Document Versions, one Leave Submission Attestation,
one accepted Leave Eligibility Assessment, and one effective Approval Route
Version. Authenticated Employee submission is an attestation. An authorized
administrator may record an externally signed application only by linking the
exact signed Document Version and separately recording the Employee, recorder,
submission method, and received time; the administrator shall not impersonate
the Employee or supply a missing signature.

Required supporting evidence shall come from applicable national authority or
evidence-backed Agency configuration. The Leave domain shall keep typed core
facts and validated policy-specific details rather than treating an opaque form
payload as the authoritative application. Immutable Leave Calculation Segments
shall record the policy, schedule, holiday, unit, and quantity applied to each
effective portion of the request, separate from any Leave Account debit.

Eligibility evaluation shall return `ELIGIBLE`, `INELIGIBLE`, or
`INDETERMINATE` with the applicable rule results, input facts, missing facts,
authority references, and calculation segments. Drafts may be saved with
deficiencies, but submission validation, credit certification, approval, and
posting shall fail closed when a required policy, schedule, holiday, or authority
fact is missing or ambiguous.

Each requested date shall use the policy, schedule, and holiday versions
effective on that date. A submitted evaluation snapshot shall list every
contributing version. Later configuration changes shall not silently change an
accepted result. A change to a submitted Leave Type, period, quantity, unit,
policy-relevant detail, commutation choice, declaration, required evidence,
accepted assessment, or route binding shall create a new Leave Application
Version and restart evaluation, certification, and routing. Reviewer comments,
task assignment, notification delivery, and display-only corrections remain
Audit Events and do not create a new version.

Structured Leave records are authoritative. Generated and uploaded official
forms are immutable Document Versions linked to the exact application stage.
Electronic or digital signatures shall be claimed only under an evidenced
Agency signature contract.

## LEA-004 Certification of leave credits

HR shall create an immutable Leave Credit Certification for the application and
Leave Application Version. It shall preserve the effective balance date, ledger
knowledge cutoff, posted balance, active Leave Credit Commitments, current
application quantity, resulting available credits, exact Leave Eligibility
Assessment, and certifying actor and time. Certification shall atomically create
the application commitments while locking the affected Leave Accounts.

A certification remains a permanently valid historical attestation. Its current
authority for approval and posting shall be derived from the continued validity
of its application version, assessment, commitments, and accounts. A new
application version or assessment, a released or replaced commitment other than
an authorized smaller successor, or a frozen or closed account shall require
recertification or block progression. A later transaction that honors the active
commitment shall not cause blanket recertification, and a later backdated entry
may change a newly reconstructed balance but shall not rewrite a historical
certification.

## LEA-005 Approval

Submission shall resolve one effective Approval Route Version. Shared Approval
Routes own task ordering, assignments, delegation, and immutable Approval
Decisions; Leave owns eligibility, certification validity, commitment state,
self-approval prevention, and posting readiness. A route change shall not alter
an in-flight application. An authorized reroute shall create a new Leave
Application Version, release the old commitments, and require recertification.

HR certification attests credit facts but does not approve leave. A Supervisor's
immutable Leave Recommendation is advisory and proceeds to the authorized
approving official even when negative unless an evidenced route says otherwise.
The final official may approve the full request, approve an exact subset through
a Leave Approval Allocation, or reject it. The Leave Policy Version bound to
each calculation segment authorizes the allocation kind: a charging policy
approves against its certified account and classifies only the quantity the
account cannot cover as leave without pay; a paid policy outside the ledger is
non-credit, and an unpaid policy is leave without pay. The allocation shall not
add dates, increase quantity, change the Leave Type, charge a different account
than the bound policy, move credit-covered quantity to unpaid leave, or
otherwise rewrite Employee-submitted facts.

Partial approval may atomically release a certified commitment and create a
linked successor for a smaller approved quantity without recertification. Any
increase, account substitution, policy change, or other replacement requires a
new application version and recertification. Rejection releases commitments.
Commitments shall not silently expire; any expiry requires authoritative policy
or evidence-backed Agency configuration.

Posting shall be a separate, atomic, idempotent Leave-owned command. It shall
revalidate the exact approved application version, assessment, certification,
commitments, allocation, and Approval Decisions while locking affected accounts;
then create every required source-linked ledger entry, Attendance input, Payroll
Input, Audit Event, and outbox record through owning application services. It
shall consume the active commitments and mark the application posted only when
all authoritative effects commit. Failure shall roll back all effects and leave
the application approved for a recorded retry.

An Employee may withdraw a submitted but unapproved application, cancelling
unfinished route work and releasing commitments. An administrator may record an
evidenced Employee withdrawal but shall not originate one. Cancellation after
approval requires a separate Leave Cancellation with its exact scope, reason,
evidence, Approval Route Version, decisions, and effect state. Whole and
policy-permitted partial cancellation are supported; neither may add or
substitute leave.

For posted leave, whole cancellation creates exact linked ledger reversals.
Partial cancellation fully reverses each affected original entry and creates
replacement entries for the retained effect, using the original effective dates
and later posting times. Leave shall obtain idempotent Attendance and Payroll
correction handoffs through their owning services. Unlocked attendance may be
recalculated; locked attendance requires its correction or adjustment contract.
Pending Payroll Inputs may be cancelled or replaced; consumed inputs require a
linked adjustment, and finalized payroll remains immutable.

Cancellation approval and effect application are separate facts. The application
shall project `CANCELLED` only after one atomic command creates every required
reversal or owner handoff. A failed command shall leave the cancellation approved,
the original posting effective, and a truthful retryable or blocking failure.
Accepted downstream adjustments may remain pending and shall be shown as such.

## LEA-006 Mandatory leave

For the ordinary civilian NGA profile, the system shall apply the authoritative
five-working-day mandatory or forced leave rule to Employees whose vacation
leave credits reached ten during the calendar year. The system shall preserve a
material Mandatory Leave Assessment containing its as-of policy, balance basis,
qualifying leave, result, and explanation.

A resulting obligation shall be fulfilled by ordinary vacation leave posted
against the vacation Leave Account, whether filed as vacation leave or as
mandatory or forced leave. It shall not create a separate balance or workflow.
Phase 7 does not post forfeiture of unused mandatory days; any later forfeiture
shall require its own authoritative source posting and shall never be inferred
from an assessment or alert.

## LEA-007 Monetization

The system shall keep one stable Leave Monetization Request with immutable
submitted versions. A version shall preserve the Employee's attestation or an
administrator-recorded signed Document Version, exact requested allocations by
Leave Account, applicable Leave Policy and authority versions, supporting
evidence, and Approval Route Version. Ordinary monetization shall draw only from
vacation leave; special monetization may allocate across vacation and sick leave
only as the applicable authority permits.

Leave shall create an explainable Monetization Eligibility Assessment and an HR
credit certification for the exact request version. Certification shall lock all
affected accounts, recheck posted balances and active commitments, and create one
Leave Credit Commitment per allocation. A separate immutable Monetization
Funding Determination shall bind the Budget review, funding source, applicable
fiscal authority, and exact evidence. Missing or conflicting eligibility,
valuation-date, allocation, salary-component, rounding, funding, approval, or
authority facts shall produce `INDETERMINATE` and block approval or posting.

The subject or recorder shall not certify, review funding, approve, or post the
request. The HR credit certifier, Budget funding reviewer, final approver, and
posting executor shall be different people unless a controlling authority
expressly establishes another arrangement. The authorized final decision shall
bind the exact request version, current assessment, certification, funding
determination, commitments, and Approval Decisions. A partial approval may only
replace commitments with linked, smaller allocations against the same accounts.

Withdrawal, rejection, material return, supersession, invalid eligibility, or
invalid funding shall release active commitments. Commitments shall not expire
silently. Approval shall not change the ledger or create a Payroll Input.

Posting shall be a separate atomic and idempotent Leave-owned command. Leave
shall call Payroll with an authority-bound input containing the Employee, exact
request version and posting, approved account allocations and total credits,
stable effect key, effective valuation date, fixed calculator kind and factor,
applicable policy and authority Document Versions, funding determination, final
Approval Decisions, and required salary-basis semantics. It shall not supply a
free-form salary or payout amount.

Payroll shall resolve the authoritative salary source, perform the fixed
calculation, apply evidence-backed rounding configuration, and freeze its inputs
and amount in an immutable Monetization Earning Input. Payroll shall return
`ACCEPTED`, matching `ALREADY_ACCEPTED`, `REJECTED`, or `RETRYABLE_FAILURE`.
Leave shall commit source-owned negative Leave Ledger Entries, commitment
consumption, request status, audit, and outbox records only with an accepted
Payroll result. Otherwise the approved request shall retain no ledger deduction
and expose its blocking or retryable result.

An authorized Monetization Adjustment shall preserve exact scope, reason,
evidence, route, and decisions. A pending Payroll Input may be cancelled or
replaced. A consumed input requires Payroll's linked adjustment contract, and a
finalized payroll result shall never be edited. Leave shall restore credits only
when Payroll accepts the correction handoff. Whole adjustment shall exactly
reverse every original ledger entry; partial adjustment shall fully reverse each
affected original entry and post replacements for retained quantities. A failed
or rejected handoff shall leave the original posting effective, while duplicate
retries return the original accepted result through stable effect keys.

The unresolved solo-parent forfeiture and cash-conversion conflict shall create
no automatic cash liability. A controlling authority or an evidence-backed
greater benefit must expressly support any such conversion.

## LEA-008 Terminal leave

After a qualifying Separation takes effect and all required Leave postings
through the last service date are complete, Separation may request terminal-leave
input preservation. Leave shall create an immutable Terminal Leave Input
Assessment. An `INDETERMINATE` assessment shall retain every missing or
conflicting fact and create no consumable snapshot.

A `READY` assessment shall create an immutable Terminal Leave Input Snapshot
that binds the exact Separation record and version, separation classification
and effective date, referenced service-period facts, vacation and sick Leave
Accounts, posted balances as of the effective separation or last service date,
ledger-knowledge cutoff, applicable policy and authority versions, clearance and
supporting Document Versions, and the exact highest-monthly-salary source
reference verified by its owning module.

Leave shall return the stable snapshot reference to Separation. Separation shall
record acceptance, duplicate acceptance, rejection, or retryable technical
failure without taking ownership of Leave facts. A corrected or backdated source
shall create a reasoned successor assessment and, when ready, a successor
snapshot. Historical snapshots shall never be rewritten.

A Terminal Leave Input Snapshot shall not close a Leave Account, create a Leave
Ledger Entry, authorize payment, calculate a terminal benefit, or create a
Payroll Input. Account closure remains part of the separation-driven Leave
posting sequence. Full terminal-leave benefit calculation and payment are
outside MVP and remain future Payroll and Separation responsibilities.

---

# 16. Overtime, COC, CTO, and Overtime Pay Requirements

## OT-001 Prior authority

Overtime service shall begin with an approved authority containing:

- purpose and necessity;
- covered employees;
- dates and expected hours;
- funding or compensation method;
- approving authority.

## OT-002 Actual service

Actual overtime shall be validated against both locked attendance and certified accomplishment. Actual Overtime Hours are the outside-schedule worked minutes of the locked Attendance Day version for the Work Date. Certified Overtime Hours shall not exceed them, and an Employee's certified hours under an authority shall not exceed the hours it authorized. The certifier shall not be the Employee who rendered the service.

## OT-003 Compensation method

The approving official shall fix the compensation method on each Overtime Authority as either:

- Compensatory Overtime Credit (COC), the general rule; or
- overtime pay, the exception.

CTO is a later use of COC, not a compensation method. No source names authorized and certified overtime that earns neither, so service that should not be compensated is declined at certification with a reason. Overtime pay shall be refused with a reason naming Payroll until Payroll Inputs for it exist. COC shall be awarded only through an approved monthly Certificate of COC Earned. Authorities: [overtime-coc-cto-authorities.md](research/overtime-coc-cto-authorities.md).

## OT-004 COC ledger

COC shall use a ledger recording earned, used, adjusted, expired, and remaining credits.

## OT-005 CTO request

Employees shall be able to request CTO against available COC, subject to supervisor and agency approval.

## OT-006 Overtime-pay input

Only approved, fund-supported, and validated overtime shall become a payroll input.

## OT-007 Work-arrangement restrictions

The rule engine shall support restrictions based on employee category, work arrangement, authorization, and applicable CSC-DBM rules.

---

# 17. Government Payroll Requirements

## PAY-001 Appointed Personnel Payroll Rule Set

Payroll shall calculate pay for admitted Appointed Personnel through one
Appointed Personnel Payroll Rule Set (#27). It covers civilian NGA personnel
appointed to authorized plantilla items, appointed casual personnel, and
appointed contractual personnel. There are no separate plantilla, casual, or
contractual payroll profiles.

The rule set shall support these pay bases as effective-dated variants (#27):

- monthly full-time salary;
- proportional part-time salary;
- the official casual daily wage.

Special-regime populations are outside the Reference Agency Profile. An
unsupported category-specific rule shall block processing rather than inherit
plantilla behavior (#27).

JO/COS Service Payments are outside payroll. A Service Payment and its
contributions and taxes are never a Payroll Employee result or a Payroll Line
(#21, #27).

## PAY-002 Salary basis

For plantilla personnel, the system shall use:

- position salary grade;
- authorized step;
- applicable DBM salary schedule and tranche;
- effectivity date;
- notices of salary adjustment;
- step-increment actions;
- statutory and special-law adjustments.

Basic salary for a monthly-paid Employee who assumes duty or separates inside a calendar month has no recorded rule. No national authority found fixes its divisor, paid days, first and last paid day, or rounding. Until one is recorded, the system shall give that Employee a blocking exception and create no Payroll Line ([authorities](research/partial-month-basic-salary-authorities.md)).

## PAY-003 Compensation components

Every earning shall come from a Native Payroll Component or an Authorized
Payroll Component Input. The system shall provide no free-form formula and no
free-form pay item (#27, #43).

The rule set shall calculate these Native Payroll Components from an applicable
National Payroll Rule Version and authoritative source facts (#27, as narrowed
by #43):

- basic salary on the monthly full-time, proportional part-time, and casual
  daily-wage bases;
- the salary effect of absence without pay, with tardiness and undertime first
  charged under the government leave rules;
- PERA;
- a cash uniform or clothing allowance, after the Agency activates it;
- commutable RATA for eligible incumbents;
- mid-year bonus, year-end bonus, and cash gift;
- overtime pay from approved overtime quantities;
- leave monetization from an approved number of days.

Adjustments and refunds follow PAY-008.

Three variants are calculated only from an Authorized Payroll Component Input
that carries its authority. A missing input shall block the affected line
(#43):

- a medical-allowance cash line requires the Agency grant mode, amount and
  schedule, qualification, and supporting authority. A procured group HMO is
  outside payroll;
- night-shift differential requires the effective-dated percentage the agency
  head selected within the national 20% ceiling. Approved night hours remain
  native source quantities;
- reimbursable RATA requires the approved actual amount. The national
  calculation enforces eligibility and ceilings.

Honoraria, hazard, subsistence, laundry, Magna Carta or other special-law
benefits, and agency-specific compensation shall enter only as Authorized
Payroll Component Inputs until a complete applicable authority and calculation
rule are sourced. Each input shall carry its authority, source, effective
period, eligible person or population, amount or quantity, and approval. A
component without lawful authority or an allowed classification is unsupported
(#27).

Salary schedules and tranche rules, and each annual GAA's component
definitions, eligibility constraints, caps, amounts, and exclusions, are
immutable, effective-dated National Payroll Rule Versions. An Agency may
activate an applicable version but shall not copy or override its substance. A
conditional component stays disabled until the Agency records its Agency
Payroll Applicability: the authority, eligible population, funding, and
effective period (#27).

PERA, the clothing and medical allowances, RATA, the bonuses, the cash gift,
and their conditions and amounts shall be revalidated against each fiscal
year's GAA (#43). A missing, expired, or unverified required rule shall block
the affected calculation. It shall never fall back to an older version, a
default rate, or a formula (#27, #43).

Payroll shall deduct salary for tardiness and undertime only from the Unpaid
Deficit Remainder that Leave sends as a Payroll Input, never from Attendance
Payroll Facts. It shall read `ABSENCE` facts from Attendance. An Employee whose
tardiness and undertime facts in a consumed Attendance Payroll Publication are
not all charged shall raise a blocking exception.

## PAY-004 Deductions and employer shares

The system shall support:

- GSIS premiums and loan deductions;
- PhilHealth contributions;
- Pag-IBIG contributions and loans;
- employer-only Employees' Compensation;
- BIR withholding tax;
- employee association or cooperative deductions;
- court or legal deductions;
- other authorized deductions.

Contribution coverage, bases, rates, floors, ceilings, and share rules, and BIR
tax tables and treatment, are National Payroll Rule Versions, not Agency
configuration. The system shall calculate expected statutory contributions
from the applicable version and reconcile them against issuer-validated
billing. An unresolved discrepancy shall block finalization (#27).

Loans and third-party deductions are issuer-validated obligations that the
Agency records or imports. Payroll shall apply the national payee
restrictions, priority order, and net-take-home floor to them. It shall not
calculate external loan interest or amortization (#27).

## PAY-005 Payroll workflow

Payroll shall include:

```text
DRAFT
CALCULATING
FOR_REVIEW
CERTIFIED
APPROVED
FINALIZED
VOIDED
```

## PAY-006 Segregation of duties

The system shall support different users for:

- preparation;
- HR certification;
- budget or fund validation;
- accounting review;
- approval;
- payment or disbursement.

## PAY-007 Payroll details

Each employee calculation shall preserve:

- source record;
- quantity;
- rate;
- amount;
- rule version;
- employee/employer share;
- accounting or reporting category.

No user shall override a National Payroll Rule Version or a calculated line
(#27). A wrong amount is corrected at its source, or after finalization
through PAY-008.

## PAY-008 Finalization

Finalized payroll lines shall be immutable. Corrections shall use adjustment, supplemental payroll, refund, or void-and-replace workflows.

## PAY-009 Outputs

The system shall produce:

- payroll register;
- payslip;
- deduction register;
- agency and employee contribution summaries;
- loan-remittance summaries;
- tax summaries;
- the Payment Export and its Payment Instructions (#28);
- the Certified Payroll Review Export (#29);
- the Finalized Payroll Accounting Support Export (#29);
- funding and cost-center summaries;
- accounting-support schedules;
- variance and exception reports.

Every output is LingkodHR's own Printable System View or Structured Export.
None is an Exact Versioned Form. The payslip and the payroll register are
Printable System Views. The deduction register, the remittance schedules, and
the contribution, loan-remittance, and tax summaries are Structured Exports
for review. No output shall be labelled as, or claim to conform to, a COA or
BIR form or an issuer's format: the forms baseline established no universal
payslip layout (`research/official-forms-security-records-baselines.md` §1.4),
and the MVP files and remits nothing (PAY-010). Reproducing a named official
form is a separate decision that needs that form's controlling issuance
(#617).

A Payment Export is a provider-neutral handoff generated only from a FINALIZED
payroll, with one Payment Instruction for each positive-net-pay Payroll
Employee result. It claims no bank format, acceptance, or settlement, and
generating it marks no one paid. The Cashier records each Payment
Instruction's Disbursement Outcome separately as SUBMITTED, ACCEPTED,
REJECTED, SETTLED, or RETURNED (#28).

The Certified Payroll Review Export is taken from the certified payroll
snapshot for budget and accounting review before approval. The Finalized
Payroll Accounting Support Export is taken from the immutable finalized
payroll result. Creating or downloading either never asserts that funds were
validated or obligated, that an accounting entry was posted, or that a
receiving system accepted the data (#29).

## PAY-010 Direct filing boundary

The MVP shall not directly remit or file to government portals. It shall produce reviewable export and report data.

---

# 18. SPMS Performance Management Requirements

## SPM-001 Performance cycle

The system shall support:

1. performance planning and commitment;
2. monitoring and coaching;
3. review and evaluation;
4. rewarding and development planning.

## SPM-002 Organizational alignment

Office and individual commitments shall align with agency mandate, plans, and organizational targets.

## SPM-003 Forms

The system shall support configurable OPCR, DPCR, and IPCR structures or agency-equivalent forms.

## SPM-004 Success indicators

Targets shall include:

- output or outcome;
- measure;
- target;
- quality;
- efficiency;
- timeliness;
- weight;
- evidence.

## SPM-005 Monitoring

Employees and supervisors shall record accomplishments, coaching notes, and supporting evidence.

## SPM-006 Rating

The system shall support agency-approved rating scales, review, calibration, sign-off, and final rating.

## SPM-007 HR integration

Performance results may support:

- promotion and selection evidence;
- learning needs;
- rewards and recognition;
- probation or development plans;
- reports.

Full L&D and PRAISE modules are future scope.

---

# 19. Separation, Retirement, and Clearance Requirements

## SEP-001 Separation types

The system shall record:

- resignation;
- retirement;
- transfer to another agency;
- expiration of appointment;
- termination or dropping from rolls where applicable;
- death;
- abolition or reorganization-related separation;
- other authorized modes.

## SEP-002 Resignation and acceptance

The workflow shall track submission, acceptance, effectivity, and required form or document.

## SEP-003 Clearance

The system shall route clearance to applicable offices and record liabilities, property, records, and financial accountabilities.

## SEP-004 Service record closure

The final service segment, appointment, position occupancy, and payroll scope shall close on the effective date.

## SEP-005 Access revocation

Agency membership and sessions shall be revoked according to the approved separation date and risk.

## SEP-006 Records retention

Historical personnel, payroll, service, leave, performance, and audit records shall be preserved according to retention rules.

---

# 20. Reports and Government Forms

The MVP shall support configurable generation or data preparation for:

- PDS and Work Experience Sheet;
- position description and qualification profile;
- vacancy publication request;
- appointment and appointment-transmittal data;
- oath of office;
- assumption-to-duty certification;
- appointment reports;
- service record;
- DTR;
- leave application and leave-credit certification;
- leave card or ledger;
- overtime authority and accomplishment;
- COC and CTO ledger;
- payroll registers and payslips;
- contribution, loan, and tax schedules;
- staffing and vacancy reports;
- personnel action history;
- SPMS forms and ratings;
- SALN filing compliance;
- separation and clearance records;
- audit and access reports.

Official form versions shall be configurable and versioned.

---

# 21. AI-Assisted Features

AI may:

- extract PDS or applicant-document fields into a draft;
- summarize applicant qualifications against a position profile;
- draft vacancy descriptions and interview questions;
- summarize appointment-document completeness;
- explain attendance exceptions;
- draft HR notices;
- answer policy questions from approved agency issuances;
- summarize payroll variances;
- summarize performance accomplishments.

AI may not:

- determine final applicant selection;
- approve or issue an appointment;
- alter a plantilla item;
- approve leave, overtime, payroll, or performance rating;
- execute arbitrary database queries;
- change government records without normal validation and approval.

Every AI output shall be validated and visibly labeled as a draft or recommendation.

---

# 22. Privacy, Security, and Audit Requirements

## SEC-001 Data classification

PDS data, eligibility records, compensation, payroll, bank details, government identifiers, medical documents, performance ratings, disciplinary records, and SALN-related information shall be classified and access-controlled.

## SEC-002 Least privilege

Permissions shall be granular. General HR access shall not automatically grant payroll, SALN, bank-detail, or system-administration access.

## SEC-003 Tenant and agency isolation

An agency shall access only its own data. Dedicated deployment shall remain an option for agencies that require it.

## SEC-004 Audit events

The system shall record:

- login and security events;
- position changes;
- selection and board decisions;
- appointment actions;
- personnel-record changes;
- attendance corrections;
- leave and overtime decisions;
- payroll preparation, certification, approval, and finalization;
- performance-rating changes;
- exports and sensitive-record access;
- AI-assisted actions.

## SEC-005 Immutable records

Finalized payroll, issued appointments, approved service history, and historical audit records shall not be silently edited.

## SEC-006 Electronic signatures

The design shall support electronic-signature metadata and certification where an agency adopts an authorized process. Legal sufficiency shall remain subject to agency policy and applicable issuance.

---

# 23. Non-Functional Requirements

- Standard pages should respond within two seconds under normal load where practical.
- Large payroll, report, and document-generation tasks shall run asynchronously.
- Every sensitive request shall carry a request ID and trusted agency context.
- The system shall support accessibility and keyboard navigation.
- Timestamps shall be stored consistently and displayed in Philippine Standard Time by default.
- Backups and restore procedures shall be tested before production.
- Rule and form versions shall be traceable.
- The architecture shall support at least 5,000 personnel records per agency without redesign, while the first pilot may be smaller.
- Exported government records shall preserve confidentiality markings and access controls.

---

# 24. Data Migration Requirements

The MVP shall support validated import templates for:

- offices and organizational units;
- plantilla positions;
- employee master data;
- appointment and service history;
- salary grade and step;
- leave opening balances;
- COC opening balances;
- current payroll components;
- government identifiers;
- user accounts.

Biometric attendance exports are not included.

Imports shall provide:

- preview;
- validation;
- row-level errors;
- duplicate detection;
- idempotency;
- approval;
- audit history.

---

# 25. MVP Acceptance Criteria

The public-sector MVP is acceptable when an agency can:

## Identity and access

- invite, activate, log in, recover, suspend, and deactivate users;
- enforce agency and role-based access;
- require MFA for privileged users;
- audit login and security events.

## Plantilla and organization

- create the agency structure;
- load authorized positions;
- track item number, title, salary grade, office, status, and history;
- prevent conflicting active incumbents.

## Recruitment and appointment

- request to fill a vacancy;
- record publication;
- receive and screen applications;
- document board evaluation and recommendation;
- record appointing-authority decision;
- prepare and validate appointment data;
- record oath and assumption;
- convert the appointee into an active employee.

## Personnel records

- maintain PDS-compatible employee data;
- maintain appointment and personnel-action history;
- generate a service record;
- control sensitive documents;
- track SALN filing compliance.

## Attendance and leave

- record manual or web attendance;
- generate a DTR;
- process corrections;
- maintain leave-credit ledgers;
- process leave applications and approvals;
- identify mandatory leave;
- process leave monetization into payroll inputs.

## Overtime and compensatory time

- issue prior overtime authority;
- validate actual service;
- award overtime pay or COC;
- maintain COC balance;
- process CTO requests.

## Payroll

- apply salary grade and step;
- use an effective-dated salary schedule;
- compute earnings, GSIS-related deductions, PhilHealth, Pag-IBIG, tax, loans, and adjustments;
- route preparation, certification, review, and approval;
- finalize immutable payroll;
- generate payslips and registers;
- process later corrections without editing finalized history.

## Performance

- create an SPMS cycle;
- define office and individual targets;
- record accomplishments and coaching;
- calculate and approve ratings;
- preserve final performance records.

## Audit and security

- prevent unauthorized cross-agency or cross-office access;
- record material actions and exports;
- revoke access on separation;
- preserve original and corrected values.

---

# 26. Delivery Phases

## Phase 1 — Foundation and position control

- authentication and roles;
- agency structure;
- plantilla positions;
- employee master records;
- PDS;
- document storage;
- audit logging.

## Phase 2 — Recruitment and appointments

- vacancy request and publication;
- applicants;
- qualification screening;
- merit selection;
- appointment;
- oath and assumption;
- service-record foundation.

## Phase 3 — Attendance, leave, and overtime

- schedules and work arrangements;
- manual/web attendance and DTR;
- attendance corrections;
- leave-credit ledger and applications;
- overtime authority;
- COC and CTO.

## Phase 4 — Government payroll

- salary grade and step;
- compensation and deductions;
- payroll calculation;
- certification and approval;
- payslips and reports;
- adjustment workflows.

## Phase 5 — SPMS and hardening

- OPCR/IPCR cycles;
- monitoring and rating;
- security review;
- records retention;
- backup and restore;
- pilot migration;
- AI-assisted drafting and summarization.

---

# 27. Open Decisions

1. Exact pilot-agency type: NGA, LGU, SUC, or GOCC with original charter.
2. Whether the first release will support only plantilla personnel or also casual personnel.
3. Whether Job Order and Contract of Service payment processing is required at launch.
4. Which official forms must be generated exactly versus exported as structured data.
5. Whether web clock-in/out is required.
6. Whether MFA is mandatory for all users or privileged users only.
7. Required salary, allowance, and deduction profiles for the pilot agency.
8. Required payroll bank or disbursement export format.
9. Whether direct integration with existing accounting or budget systems is required.
10. Agency-specific Merit Selection Plan and approval hierarchy.
11. Agency-specific SPMS forms and rating cycle.
12. Retention periods and archival requirements.
13. Whether deployment must be shared SaaS, dedicated cloud, or agency-hosted.

---

# 28. Risks and Mitigations

| Risk                                      | Impact                         | Mitigation                                                  |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| Treating all public agencies as identical | Incorrect workflows            | Agency profiles and a defined first pilot                   |
| Outdated CSC or DBM rule                  | Invalid transaction            | Effective-dated policies and formal update process          |
| Incomplete plantilla data                 | Invalid appointment or payroll | Position reconciliation and migration validation            |
| Appointment-document error                | CSC return or invalidation     | Completeness checks and human review                        |
| Payroll rule error                        | Financial and audit exposure   | Regression tests, certification, and immutable finalization |
| Excessive scope                           | Delayed MVP                    | Phased modules and explicit exclusions                      |
| Sensitive-record breach                   | Legal and trust impact         | Least privilege, MFA, encryption, and audit                 |
| AI-generated error                        | Incorrect HR action            | Draft-only output and human approval                        |
| Agency-specific legacy process            | Adoption difficulty            | Configurable workflows without arbitrary scripting          |
| Regulatory integration expectation        | Deployment delay               | Export-first boundary and later official integration        |

---

# 29. Official Reference Baseline

- [CSC 2025 Omnibus Rules on Appointments and Other Human Resource Actions](https://csc.gov.ph/downloads/2025-oraohra)
- [CSC Forms and Personnel Records Resources](https://www.csc.gov.ph/downloads/forms)
- [CSC Strategic Performance Management System](https://csc.gov.ph/programs/spms)
- [CSC PRIME-HRM](https://csc.gov.ph/programs/prime-hrm)
- [CSC Omnibus Rules on Leave amendment and Form 6](https://www.csc.gov.ph/downloads/category/298-mc-no-05-s-2021-amendment-to-omnibus-rules-on-leave-csc-mc-no-41-s-1998-as-amended)
- [DBM Compendium on Organization, Staffing, Position Classification and Compensation](https://www.dbm.gov.ph/index.php/compendium-of-issuances-on-organization-staffing-position-classification-and-compensation)
- [DBM National Budget Circular No. 601, 2026 Salary Schedule Tranche](https://www.dbm.gov.ph/index.php/central-office?catid=428&id=3801&view=article)
- [PhilHealth Formal Economy Membership](https://www.philhealth.gov.ph/members/formal/member.php)
- [GSIS Official Website](https://www.gsis.gov.ph/)
- [National Privacy Commission](https://privacy.gov.ph/)

The reference baseline must be revalidated before production and whenever an issuance changes.

---

# 30. Approval

| Role                          | Name | Decision | Date |
| ----------------------------- | ---- | -------- | ---- |
| Product Owner                 |      | Pending  |      |
| Government HR / HRMO Reviewer |      | Pending  |      |
| Payroll / Accounting Reviewer |      | Pending  |      |
| Technical Owner               |      | Pending  |      |
| Privacy / Security Reviewer   |      | Pending  |      |

---

# 31. Change Log

| Version | Date           | Description                                                                                     |
| ------- | -------------- | ----------------------------------------------------------------------------------------------- |
| 1.0     | August 5, 2026 | Reframed the product as a Philippine public-sector HRIS and replaced private-sector assumptions |
