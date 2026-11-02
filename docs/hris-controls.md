# Philippine Public-Sector HRIS MVP

## Status Transition and Role-Permission Control Specification

**Document status:** Draft for approval  
**Source documents:**

- Philippine Public-Sector HRIS MVP BRD v1.0
- Philippine Public-Sector HRIS MVP Workflow Specification v1.0

**Primary implementation profile:** Civilian National Government Agency  
**Version:** 1.0  
**Date:** August 5, 2026

---

# 1. Purpose

This document defines the system controls that sit between the approved business workflows and the future data model.

It specifies:

1. valid entity statuses;
2. allowed status transitions;
3. actors authorized to perform each transition;
4. required permissions;
5. required validations;
6. transition side effects;
7. audit requirements;
8. the baseline public-sector HRIS role and permission matrix.

This document is intended to guide:

- conceptual and logical ERD design;
- API authorization;
- workflow services;
- user-interface actions;
- audit-event design;
- automated tests;
- segregation-of-duties controls.

---

# 2. Control Principles

The system shall follow these principles:

1. Authentication establishes identity only; it does not automatically authorize an action.
2. Every protected operation must validate agency membership.
3. Every protected operation must validate role, permission, record scope, and workflow status.
4. Status changes must occur through approved application services.
5. Users may not directly assign arbitrary entity statuses.
6. Every material transition must create an audit event.
7. Historical records must remain traceable after correction.
8. Finalized payroll, issued appointments, approved service records, and final performance ratings must not be edited directly.
9. Sensitive permissions shall be assigned separately from general HR permissions.
10. Payroll preparation, review, certification, approval, and disbursement may be separated.
11. Plantilla occupancy must be validated before an appointment or personnel action takes effect.
12. AI services may not bypass normal workflow, permission, and approval controls.
13. Agency-specific rules may add restrictions but may not weaken mandatory security controls.
14. Protected actions require an ACTIVE User and an ACTIVE Agency Membership in the acting Agency.
15. Every override requires an explicit reason and audit record.

---

# 3. Permission Naming Convention

Permissions use this format:

```text
<domain>.<resource>.<action>
```

Examples:

```text
organization.units.read
positions.items.create
positions.items.authorize
recruitment.applications.screen
appointments.records.issue
personnel.pds.update
attendance.corrections.approve
leave.credits.certify
overtime.coc_certificates.approve
payroll.periods.finalize
performance.ratings.approve
security.users.deactivate
audit.events.read
```

Scope suffixes may be enforced internally:

```text
own
direct_reports
assigned_office
agency
restricted
```

Examples:

```text
personnel.records.read:own
personnel.records.read:direct_reports
personnel.records.read:agency
payroll.payslips.read:own
```

The permission string stored in the system may remain normalized while scope is represented separately.

---

# 4. Baseline Roles

| Role                           | Purpose                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Agency Administrator           | Manages agency setup, accounts, roles, and technical configuration                                                  |
| HR Administrator               | Broad HR management excluding unrestricted payroll and system administration; inherits HR Officer Attendance access |
| HR Officer                     | Operational HR review and approval within assigned scope; inherits Employee Attendance access                       |
| Plantilla Officer              | Manages authorized positions and position history                                                                   |
| Recruitment Officer            | Manages vacancies, applicants, screening, and selection administration                                              |
| HRMPSB Member                  | Evaluates applicants and records board recommendations                                                              |
| Appointing Authority           | Approves or signs appointments and designated personnel actions                                                     |
| Personnel Records Officer      | Maintains PDS, documents, service records, and personnel actions                                                    |
| Leave Administrator            | Maintains leave policies, balances, certifications, and leave records                                               |
| Supervisor                     | Manages direct reports, routed approvals, and performance evaluation                                                |
| Employee                       | Uses employee self-service functions                                                                                |
| Payroll Preparer               | Builds payroll, resolves inputs, and performs calculations                                                          |
| HR Certifying Officer          | Certifies personnel and HR inputs within Payroll; it is not an Attendance role                                      |
| Budget Officer                 | Validates funding, position authority, and personnel-services availability                                          |
| Accounting Reviewer            | Reviews payroll accounting and deduction schedules                                                                  |
| Payroll Approver               | Approves and finalizes payroll according to agency authority                                                        |
| Cashier / Disbursing Officer   | Processes approved payment outputs and disbursement status                                                          |
| Performance Management Officer | Configures SPMS cycles and supports calibration                                                                     |
| Records Officer                | Controls official records, retention, and certified document releases                                               |
| Internal Auditor / COA Auditor | Reads authorized records and audit evidence without operational editing                                             |
| Data Protection Officer        | Reviews privacy controls, access, retention, and incidents                                                          |
| Security Administrator         | Manages high-risk security settings, session revocation, and security events                                        |
| AI Feature Administrator       | Enables agency-approved AI capabilities and model policies                                                          |

A user may hold more than one role only where agency policy permits it.

Within Attendance, HR Officer inherits Employee permissions and HR Administrator inherits HR Officer permissions. Inheritance grants permission but does not bypass record scope, routed assignment, or transaction-level separation of duties.

---

# 5. Status Transition Matrix

## 5.1 User and Agency Membership

A User is one identity with one set of credentials. An Agency Membership is that User's access to one Agency. Each has its own status. A first-time Invitation Activation creates both; after that, no transition acts on both.

Access to an Agency requires both an ACTIVE User and an ACTIVE Agency Membership in that Agency.

### User

Statuses:

```text
ACTIVE
LOCKED
```

| Current | Action            | Next   | Primary actor          | Required permission     | Validations                                                                                                                                                                                     | Side effects and audit                                                                                |
| ------- | ----------------- | ------ | ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| None    | Accept invitation | ACTIVE | Invited user           | Public invitation flow  | First-time User only: no User has the invitation's email; token valid, unused, unexpired; email verified                                                                                        | Create the User and credentials, audited with the membership's activation                             |
| ACTIVE  | Lock account      | LOCKED | Security Administrator | `security.users.lock`   | Suspected compromise or security review; User has an ACTIVE Agency Membership in the acting Agency                                                                                              | Record the locking Agency; revoke sessions; audit lock in the acting Agency                           |
| LOCKED  | Unlock account    | ACTIVE | Security Administrator | `security.users.unlock` | Identity or security review completed; actor is in the locking Agency, or in one of the User's remaining Agencies when the User no longer has an ACTIVE Agency Membership in the locking Agency | Revoke old sessions; audit unlock in the acting Agency, recording whether the locking Agency was gone |

LOCKED is the Global User Lock. It denies every Agency Membership without changing any membership's status, and it is never an Agency Membership status.

A User has no DEACTIVATED status. Deactivation, including for separation, acts only on Agency Memberships. A User with no ACTIVE Agency Membership can't reach any Agency, and a new invitation restores access through a new Agency Membership. This is a Project Decision (#390).

Lock controls:

- Only a Security Administrator places or lifts a Global User Lock. No count of failed sign-in attempts sets LOCKED; repeated failures start a Sign-in Cool-down instead.
- A lock has no expiry, and a Password Reset never lifts it.
- Other Agencies see only that the User is locked by another Agency's Security Administrator, without that Agency's name, reason, or events.
- Lock and unlock require a reason and the Reauthentication Window. No one locks their own account.
- The Security Events and audit events `USER_LOCKED` and `USER_UNLOCKED` and the session revocations are recorded in the acting Agency only. An unlock after authority passed on records that the locking Agency was gone, without naming it.

Invalid examples:

```text
LOCKED → password reset that silently restores access
failed sign-in attempts → LOCKED
```

Factor Reset controls (#370):

- Only a Security Administrator holds `security.mfa.reset_factor`, acting in an Agency where the target User has an ACTIVE Agency Membership. No one resets their own factor, and a User without a factor has nothing to reset. The Reauthentication Window applies.
- The administrator records how identity was verified: `IN_PERSON_GOVERNMENT_ID` or `VIDEO_CALL_GOVERNMENT_ID`, and a required note. No ID numbers or images are stored.
- The reset removes the TOTP factor and every Recovery Code, revokes every session, and ends pending sign-ins. It changes neither the password nor the User status; an MFA-Required User enrolls again at the next sign-in.
- The Security Event and audit event `MFA_FACTOR_RESET` and the session revocations are recorded in the acting Agency only. The User receives a notice naming that Agency.

### Agency Membership

Statuses:

```text
INVITED
ACTIVE
SUSPENDED
DEACTIVATED
```

| Current   | Action                | Next        | Primary actor                                 | Required permission         | Validations                                                                                                        | Side effects and audit                                                               |
| --------- | --------------------- | ----------- | --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| None      | Invite user           | INVITED     | Agency Administrator                          | `security.users.invite`     | Valid email; agency exists; role assignment permitted                                                              | Create invitation; send email; audit invitation                                      |
| INVITED   | Accept invitation     | ACTIVE      | Invited user                                  | Public invitation flow      | Token valid, unused, unexpired; email verified; a first-time User sets credentials, an existing User authenticates | Create credentials for a first-time User only; activate membership; audit activation |
| INVITED   | Resend invitation     | INVITED     | Agency Administrator                          | `security.users.invite`     | Existing invitation pending; resend limit                                                                          | Replace or renew token; audit resend                                                 |
| INVITED   | Cancel invitation     | DEACTIVATED | Agency Administrator                          | `security.users.deactivate` | Invitation not accepted                                                                                            | Invalidate token; audit cancellation                                                 |
| ACTIVE    | Suspend membership    | SUSPENDED   | Agency Administrator / Security Administrator | `security.users.suspend`    | Reason required                                                                                                    | Revoke sessions; deny access; audit suspension                                       |
| SUSPENDED | Reactivate membership | ACTIVE      | Agency Administrator / Security Administrator | `security.users.reactivate` | Reason and review required                                                                                         | Restore membership access; audit reactivation                                        |
| ACTIVE    | Deactivate membership | DEACTIVATED | Agency Administrator                          | `security.users.deactivate` | Separation or administrative basis                                                                                 | Revoke sessions; preserve history; audit deactivation                                |
| SUSPENDED | Deactivate membership | DEACTIVATED | Agency Administrator                          | `security.users.deactivate` | Reason required                                                                                                    | Revoke sessions; preserve history                                                    |

Suspend and Reactivate are Agency Membership Suspension: they deny or restore access through one Agency Membership and leave the User and the User's other Agency Memberships unchanged.

Deactivate, including deactivation for separation, acts on one Agency Membership in the acting Agency and leaves the User's status unchanged.

DEACTIVATED is final. To restore access, including after reemployment, an Agency Administrator invites the User again. The accepted invitation creates a new Agency Membership with its own role assignments; the DEACTIVATED membership stays unchanged as history. This is a Project Decision (#392).

Invalid examples:

```text
INVITED → protected dashboard without activation
SUSPENDED → password reset that silently restores access
DEACTIVATED → ACTIVE on the same Agency Membership
```

---

## 5.2 Organization Unit

Statuses:

```text
DRAFT
ACTIVE
INACTIVE
ABOLISHED
```

| Current  | Action               | Next      | Actor                       | Permission                      | Validations                                             | Side effects                        |
| -------- | -------------------- | --------- | --------------------------- | ------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| None     | Create unit          | DRAFT     | Agency Administrator / HRMO | `organization.units.create`     | Parent unit and effective date valid                    | Create draft history                |
| DRAFT    | Activate             | ACTIVE    | Agency Administrator / HRMO | `organization.units.activate`   | Code and hierarchy valid                                | Unit becomes assignable             |
| ACTIVE   | Rename or reorganize | ACTIVE    | HR Administrator            | `organization.units.update`     | Effective date; no hierarchy cycle                      | Create history version              |
| ACTIVE   | Inactivate           | INACTIVE  | HR Administrator            | `organization.units.inactivate` | No active required assignments or migration plan exists | Prevent new assignments             |
| INACTIVE | Reactivate           | ACTIVE    | HR Administrator            | `organization.units.activate`   | Valid authority and hierarchy                           | Restore assignment availability     |
| ACTIVE   | Abolish              | ABOLISHED | Agency Administrator / HRMO | `organization.units.abolish`    | Legal or administrative authority; effective date       | Close assignments; preserve history |
| INACTIVE | Abolish              | ABOLISHED | Agency Administrator / HRMO | `organization.units.abolish`    | Authority required                                      | Preserve history                    |

---

## 5.3 Plantilla Position

Statuses:

```text
PROPOSED
AUTHORIZED
VACANT
RESERVED
OCCUPIED
FROZEN
ABOLISHED
```

| Current    | Action                             | Next       | Actor                     | Permission                            | Validations                                       | Side effects and audit                      |
| ---------- | ---------------------------------- | ---------- | ------------------------- | ------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| None       | Create proposed item               | PROPOSED   | Plantilla Officer         | `positions.items.create`              | Item number format; unit exists                   | Create position history                     |
| PROPOSED   | Authorize item                     | AUTHORIZED | HRMO / Budget Officer     | `positions.items.authorize`           | Supporting authority; grade; funding; QS          | Mark authorized; audit authority            |
| AUTHORIZED | Declare vacant                     | VACANT     | Plantilla Officer         | `positions.items.declare_vacant`      | No active incumbent                               | Enable request-to-fill                      |
| VACANT     | Reserve for appointment            | RESERVED   | Personnel Records Officer | `positions.items.reserve`             | Selected applicant; no conflicting reservation    | Block other occupancy actions               |
| RESERVED   | Release reservation                | VACANT     | Personnel Records Officer | `positions.items.release_reservation` | Appointment cancelled, returned, or expired       | Remove reservation                          |
| RESERVED   | Occupy position                    | OCCUPIED   | Personnel Records Officer | `positions.items.occupy`              | Issued appointment; assumption recorded           | Create incumbency; start service segment    |
| OCCUPIED   | Vacate position                    | VACANT     | Personnel Records Officer | `positions.items.vacate`              | Separation or movement effective                  | Close incumbency; allow request-to-fill     |
| VACANT     | Freeze                             | FROZEN     | HRMO / Budget Officer     | `positions.items.freeze`              | Authority and reason                              | Prevent request-to-fill                     |
| AUTHORIZED | Freeze                             | FROZEN     | HRMO / Budget Officer     | `positions.items.freeze`              | Authority and reason                              | Prevent occupancy                           |
| FROZEN     | Unfreeze                           | VACANT     | HRMO / Budget Officer     | `positions.items.unfreeze`            | No incumbent; authority                           | Restore vacancy                             |
| OCCUPIED   | Freeze item after incumbent leaves | FROZEN     | HRMO / Budget Officer     | `positions.items.freeze`              | Future-effective action; incumbent exit scheduled | Freeze after vacancy                        |
| PROPOSED   | Cancel proposal                    | ABOLISHED  | Plantilla Officer         | `positions.items.cancel`              | Reason required                                   | Preserve unsuccessful proposal              |
| AUTHORIZED | Abolish                            | ABOLISHED  | HRMO / Budget Officer     | `positions.items.abolish`             | Authority; no active incumbent or transition plan | Close position history                      |
| VACANT     | Abolish                            | ABOLISHED  | HRMO / Budget Officer     | `positions.items.abolish`             | Authority required                                | Remove from recruitment scope               |
| OCCUPIED   | Abolish future-effective           | ABOLISHED  | HRMO / Budget Officer     | `positions.items.abolish`             | Reorganization and incumbent treatment documented | Close occupancy and position on effectivity |

Critical rule:

```text
VACANT → OCCUPIED
```

is permitted only through an Assumed Appointment Contract or an effectual personnel action.

---

## 5.4 Request to Fill

Statuses:

```text
DRAFT
SUBMITTED
FOR_REVIEW
APPROVED
REJECTED
CANCELLED
CLOSED
```

| Current    | Action                  | Next       | Actor                                   | Permission                        | Validations                                                                                                                                                                                                                                   | Side effects                                                |
| ---------- | ----------------------- | ---------- | --------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| None       | Create request          | DRAFT      | Requesting Office / Recruitment Officer | `recruitment.requests.create`     | Position is VACANT; office scope valid                                                                                                                                                                                                        | Create request                                              |
| DRAFT      | Submit                  | SUBMITTED  | Requesting Office                       | `recruitment.requests.submit`     | Required justification complete                                                                                                                                                                                                               | Start review                                                |
| SUBMITTED  | Begin review            | FOR_REVIEW | Recruitment Officer / HRMO              | `recruitment.requests.review`     | Position remains a Recruitable Vacancy; exactly one applicable Agency Merit Selection Plan Version, Merit Selection Criteria Set, Board Definition with effective appointments, and every required Approval Route Version resolve server-side | Store immutable governing bindings; create review task      |
| FOR_REVIEW | Rebaseline MSP          | FOR_REVIEW | HR Administrator                        | `recruitment.requests.rebaseline` | Not published; replacement configuration resolves uniquely; reason, authority, and evidence required                                                                                                                                          | Preserve former bindings; append rebaseline and Audit Event |
| FOR_REVIEW | Approve                 | APPROVED   | Authorized HR / Agency Approver         | `recruitment.requests.approve`    | Authority, funding, QS, governing bindings, and required route decisions confirmed                                                                                                                                                            | Permit vacancy publication                                  |
| FOR_REVIEW | Reject                  | REJECTED   | Authorized HR / Agency Approver         | `recruitment.requests.reject`     | Reason required                                                                                                                                                                                                                               | Notify requesting office                                    |
| DRAFT      | Cancel                  | CANCELLED  | Requesting Office                       | `recruitment.requests.cancel`     | Not submitted                                                                                                                                                                                                                                 | Close request                                               |
| SUBMITTED  | Withdraw                | CANCELLED  | Requesting Office / HRMO                | `recruitment.requests.cancel`     | No active publication                                                                                                                                                                                                                         | Stop workflow                                               |
| APPROVED   | Close after recruitment | CLOSED     | Recruitment Officer                     | `recruitment.requests.close`      | Vacancy filled or recruitment formally closed                                                                                                                                                                                                 | Link result                                                 |

---

## 5.5 Vacancy Publication

Statuses:

```text
DRAFT
FOR_APPROVAL
PUBLISHED
CLOSED
CANCELLED
REPUBLISHED
```

| Current             | Action              | Next         | Actor                        | Permission                        | Validations                                                                                                                                                    | Side effects                                                       |
| ------------------- | ------------------- | ------------ | ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| None                | Prepare publication | DRAFT        | Recruitment Officer          | `recruitment.vacancies.create`    | Approved request to fill                                                                                                                                       | Create publication draft                                           |
| DRAFT               | Submit for approval | FOR_APPROVAL | Recruitment Officer          | `recruitment.vacancies.submit`    | Position details and dates complete                                                                                                                            | Start approval                                                     |
| FOR_APPROVAL        | Approve and publish | PUBLISHED    | HRMO Approver                | `recruitment.vacancies.publish`   | Exact CS Form No. 9 Document Version; bound QS Version; required channels, dates, contact details, evidence, and certification; governing bindings still valid | Freeze bindings; open applications; audit publication              |
| FOR_APPROVAL        | Return              | DRAFT        | HRMO Approver                | `recruitment.vacancies.return`    | Comment required                                                                                                                                               | Notify officer                                                     |
| PUBLISHED           | Close applications  | CLOSED       | Recruitment Officer / System | `recruitment.vacancies.close`     | Closing date reached or authorized early closure                                                                                                               | Stop normal submissions                                            |
| PUBLISHED           | Cancel publication  | CANCELLED    | HR Administrator             | `recruitment.vacancies.cancel`    | Reason and authority required; mandatory for a material post-publication policy or publication-data change                                                     | Notify affected applicants                                         |
| CLOSED or CANCELLED | Republish           | REPUBLISHED  | Recruitment Officer          | `recruitment.vacancies.republish` | Approved basis; new exact form, dates, evidence, and governing bindings                                                                                        | Create linked publication without rewriting the former publication |

---

## 5.6 Application

Statuses:

```text
RECEIVED
INCOMPLETE
QUALIFIED
NOT_QUALIFIED
FOR_ASSESSMENT
FOR_INTERVIEW
FOR_DELIBERATION
RECOMMENDED
NOT_RECOMMENDED
SELECTED
NOT_SELECTED
WITHDRAWN
CLOSED
```

| Current          | Action                         | Next             | Actor                               | Permission                            | Validations                                                                                                    | Side effects                                |
| ---------------- | ------------------------------ | ---------------- | ----------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| None             | Record application             | RECEIVED         | Recruitment Officer                 | `recruitment.applications.create`     | Vacancy open or authorized late handling                                                                       | Create applicant/application record         |
| RECEIVED         | Mark incomplete                | INCOMPLETE       | Recruitment Officer                 | `recruitment.applications.screen`     | Missing required evidence                                                                                      | Notify applicant where applicable           |
| INCOMPLETE       | Complete application           | RECEIVED         | Recruitment Officer                 | `recruitment.applications.update`     | Documents received before allowed cutoff                                                                       | Reopen screening                            |
| RECEIVED         | Qualify                        | QUALIFIED        | Recruitment Officer                 | `recruitment.applications.screen`     | Minimum QS evidence satisfied                                                                                  | Permit assessment                           |
| RECEIVED         | Mark not qualified             | NOT_QUALIFIED    | Recruitment Officer / HRMO Reviewer | `recruitment.applications.disqualify` | Reason and QS comparison required                                                                              | Audit basis                                 |
| QUALIFIED        | Schedule assessment            | FOR_ASSESSMENT   | Recruitment Officer                 | `recruitment.assessments.manage`      | Assessment plan exists                                                                                         | Create assessment                           |
| FOR_ASSESSMENT   | Schedule interview             | FOR_INTERVIEW    | Recruitment Officer                 | `recruitment.interviews.manage`       | Required assessment complete                                                                                   | Create interview                            |
| FOR_INTERVIEW    | Send to board                  | FOR_DELIBERATION | Recruitment Officer                 | `recruitment.deliberations.submit`    | Scores and evidence complete                                                                                   | Include in board packet                     |
| FOR_DELIBERATION | Recommend                      | RECOMMENDED      | HRMPSB Member / Board               | `recruitment.deliberations.recommend` | Quorum and deliberation complete                                                                               | Record recommendation                       |
| FOR_DELIBERATION | Do not recommend               | NOT_RECOMMENDED  | HRMPSB Member / Board               | `recruitment.deliberations.recommend` | Reason and board record                                                                                        | Audit board result                          |
| RECOMMENDED      | Select                         | SELECTED         | Appointing Authority                | `recruitment.selection.select`        | Authority and recommendation available                                                                         | Start appointment preparation               |
| RECOMMENDED      | Not select                     | NOT_SELECTED     | Appointing Authority                | `recruitment.selection.decide`        | Decision basis recorded                                                                                        | Close application                           |
| RECOMMENDED      | Return for further review      | FOR_DELIBERATION | Appointing Authority                | `recruitment.selection.decide`        | Return basis recorded                                                                                          | Reopen deliberation with a new Session      |
| Any open state   | Withdraw                       | WITHDRAWN        | Recruitment Officer                 | `recruitment.applications.withdraw`   | Applicant withdrawal evidence                                                                                  | Stop evaluation                             |
| NOT_QUALIFIED    | Close                          | CLOSED           | Recruitment Officer                 | `recruitment.applications.close`      | Notice handled                                                                                                 | Archive                                     |
| NOT_RECOMMENDED  | Close                          | CLOSED           | Recruitment Officer                 | `recruitment.applications.close`      | Notice handled                                                                                                 | Archive                                     |
| NOT_SELECTED     | Close                          | CLOSED           | Recruitment Officer                 | `recruitment.applications.close`      | Notice handled                                                                                                 | Archive                                     |
| SELECTED         | Close after service activation | CLOSED           | Recruitment Officer                 | `recruitment.applications.close`      | Idempotent Appointment handoff completed and Assumed Appointment Contract activated by Personnel and Plantilla | Preserve complete recruitment outcome links |

AI may assist with summaries but may not execute `select`, `not select`, `qualify`, or `not qualified` as an autonomous final action.

---

## 5.7 Appointment

Statuses:

```text
DRAFT
FOR_REVIEW
FOR_SIGNATURE
ISSUED
CANCELLED
```

| Current       | Action                   | Next          | Actor                       | Permission                     | Validations                                                                                                                                                           | Side effects                           |
| ------------- | ------------------------ | ------------- | --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| None          | Prepare appointment      | DRAFT         | Personnel Records Officer   | `appointments.records.create`  | Immutable Recruitment selection package received; Plantilla reservation revalidated; same active Agency                                                               | Create appointment record idempotently |
| DRAFT         | Submit for review        | FOR_REVIEW    | Personnel Records Officer   | `appointments.records.submit`  | Required fields and documents complete                                                                                                                                | Start review                           |
| FOR_REVIEW    | Return for correction    | DRAFT         | HRMO Reviewer               | `appointments.records.return`  | Comment required                                                                                                                                                      | Notify preparer                        |
| FOR_REVIEW    | Endorse for signature    | FOR_SIGNATURE | HRMO Reviewer               | `appointments.records.endorse` | QS and selection validation passed                                                                                                                                    | Route to authority                     |
| FOR_SIGNATURE | Issue appointment        | ISSUED        | Appointing Authority        | `appointments.records.issue`   | Complete reviewed version; evidenced Agency form path and signature method; exact form and supporting Document Versions; signature authority; reservation still valid | Freeze Issued Appointment Contract     |
| FOR_SIGNATURE | Reject or cancel         | CANCELLED     | Appointing Authority        | `appointments.records.cancel`  | Reason required                                                                                                                                                       | Release position reservation           |
| ISSUED        | Cancel before assumption | CANCELLED     | Appointing Authority / HRMO | `appointments.records.cancel`  | No active assumption or lawful cancellation basis                                                                                                                     | Release reservation                    |

Issued Appointment Versions are immutable; corrections require a linked successor with reason, authority, and evidence. Employment Status and Nature of Appointment are official fields, not workflow states.

External submission and CSC action events are append-only and may advance independently of Appointment Workflow Status, oath, and assumption:

| Event                                               | Actor                                     | Permission                             | Validations                                                                                                                             | Side effects                                                   |
| --------------------------------------------------- | ----------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Record submission, receipt, return, or resubmission | Personnel Records Officer                 | `appointments.external_events.record`  | Exact Appointment Version and evidence Document Version; external reference, date or time, receiving office, and reason when applicable | Append external submission event; derive standing              |
| Record approval or disapproval                      | Personnel Records Officer / Authorized HR | `appointments.external_actions.record` | Agency is regulated; exact official Document Version                                                                                    | Append CSC action; route adverse action for personnel response |
| Record validation or invalidation                   | Personnel Records Officer / Authorized HR | `appointments.external_actions.record` | Agency is accredited or deregulated; exact official Document Version                                                                    | Append CSC action; route adverse action for personnel response |

The client cannot select the Agency form path or invent an external action. Missing evidenced regulatory or accreditation configuration blocks issuance and submission.

---

## 5.8 Assumption to Duty

Statuses:

```text
PENDING
ASSUMED
DID_NOT_ASSUME
CANCELLED
```

| Current | Action                    | Next           | Actor                                             | Permission                        | Validations                                                                                                                                       | Side effects                                                                                           |
| ------- | ------------------------- | -------------- | ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| None    | Create pending assumption | PENDING        | Personnel Records Officer                         | `appointments.assumption.create`  | Appointment ISSUED                                                                                                                                | Reserve onboarding action                                                                              |
| PENDING | Record or replace oath    | PENDING        | Personnel Records Officer / Administering Officer | `appointments.oath.record`        | Issued Appointment acknowledged; exact oath Document Version; date, authority, place or permitted method, and signatures                          | Append immutable oath version                                                                          |
| PENDING | Record assumption         | ASSUMED        | Personnel Records Officer / Certifying Officer    | `appointments.assumption.certify` | Appointment is ISSUED and acknowledged; linked oath; exact assumption Document Version; actual date, certifying authority, and certification time | Publish Assumed Appointment Contract; atomically request Personnel activation and Plantilla incumbency |
| PENDING | Record failure to assume  | DID_NOT_ASSUME | Personnel Records Officer                         | `appointments.assumption.fail`    | Required notice, dates, authority, and exact evidence Document Version                                                                            | Cancel onboarding; request Plantilla release                                                           |
| PENDING | Cancel assumption         | CANCELLED      | HRMO / Appointing Authority                       | `appointments.assumption.cancel`  | Appointment cancellation                                                                                                                          | Release position                                                                                       |
| ASSUMED | Correct assumption        | ASSUMED        | Personnel Records Officer / HRMO Approver         | `appointments.assumption.correct` | Former value preserved; reason, authority, and exact evidence Document Version; dependent effects identified                                      | Append replacement version; recalculate dependent dates through owning services                        |

CSC approval or validation is not a prerequisite for oath, assumption, salary entitlement, service activation, or occupancy. The oath-copy deadline remains a Configurable Placeholder until the conflicting national wording is resolved; both source dates and the actual submission event are retained.

---

## 5.9 Employee Service Status

Statuses:

```text
PREBOARDING
ACTIVE
ON_EXTENDED_LEAVE
SUSPENDED
SEPARATED
DECEASED
```

| Current             | Action                       | Next                 | Actor                            | Permission                           | Validations                                         | Side effects                                        |
| ------------------- | ---------------------------- | -------------------- | -------------------------------- | ------------------------------------ | --------------------------------------------------- | --------------------------------------------------- |
| None                | Create preboarding employee  | PREBOARDING          | Personnel Records Officer        | `personnel.employees.create`         | Appointment preparation or direct authorized record | Create employee master                              |
| PREBOARDING         | Activate service             | ACTIVE               | Personnel Records Officer        | `personnel.employees.activate`       | Assumption completed; required setup                | Include in HR and payroll scope                     |
| ACTIVE              | Record extended leave status | ON_EXTENDED_LEAVE    | Leave Administrator / HRMO       | `personnel.employees.change_status`  | Approved leave basis                                | Adjust attendance and payroll scope                 |
| ON_EXTENDED_LEAVE   | Return to active             | ACTIVE               | HRMO                             | `personnel.employees.change_status`  | Return-to-duty evidence                             | Restore normal scope                                |
| ACTIVE              | Suspend service status       | SUSPENDED            | HRMO / Authorized Authority      | `personnel.employees.suspend`        | Official basis and dates                            | Restrict work/payroll according to action           |
| SUSPENDED           | Reinstate active status      | ACTIVE               | HRMO / Appointing Authority      | `personnel.employees.reinstate`      | Official reinstatement action                       | Create personnel action                             |
| ACTIVE              | Separate                     | SEPARATED            | Personnel Records Officer / HRMO | `personnel.employees.separate`       | Approved separation action                          | Close service; vacate position; stop future payroll |
| SUSPENDED           | Separate                     | SEPARATED            | Personnel Records Officer / HRMO | `personnel.employees.separate`       | Approved basis                                      | Close service                                       |
| ACTIVE              | Record death                 | DECEASED             | Personnel Records Officer        | `personnel.employees.record_death`   | Official evidence                                   | Close service and access                            |
| Any nonfinal status | Correct classification       | Same or valid target | HRMO Approver                    | `personnel.employees.correct_status` | Evidence; reason; effectivity                       | Preserve prior value                                |

---

## 5.10 Personnel Action

Statuses:

```text
DRAFT
FOR_REVIEW
FOR_APPROVAL
APPROVED
EFFECTIVE
RETURNED
REJECTED
CANCELLED
SUPERSEDED
```

| Current      | Action                    | Next         | Actor                                      | Permission                          | Validations                               | Side effects                                  |
| ------------ | ------------------------- | ------------ | ------------------------------------------ | ----------------------------------- | ----------------------------------------- | --------------------------------------------- |
| None         | Create action             | DRAFT        | Personnel Records Officer                  | `personnel.actions.create`          | Employee and action type valid            | Create draft                                  |
| DRAFT        | Submit                    | FOR_REVIEW   | Personnel Records Officer                  | `personnel.actions.submit`          | Required authority and fields complete    | Start HR review                               |
| FOR_REVIEW   | Return                    | RETURNED     | HRMO Reviewer                              | `personnel.actions.return`          | Comment required                          | Notify preparer                               |
| RETURNED     | Resubmit                  | FOR_REVIEW   | Personnel Records Officer                  | `personnel.actions.submit`          | Deficiency resolved                       | Preserve revisions                            |
| FOR_REVIEW   | Endorse                   | FOR_APPROVAL | HRMO Reviewer                              | `personnel.actions.endorse`         | Position, QS, salary, and authority valid | Route approval                                |
| FOR_APPROVAL | Approve                   | APPROVED     | Appointing Authority / Authorized Approver | `personnel.actions.approve`         | Signature authority                       | Lock approved version                         |
| FOR_APPROVAL | Reject                    | REJECTED     | Appointing Authority                       | `personnel.actions.reject`          | Reason required                           | Stop action                                   |
| APPROVED     | Take effect               | EFFECTIVE    | System / Personnel Records Officer         | `personnel.actions.effectuate`      | Effectivity reached; no conflict          | Update service, position, salary, and history |
| DRAFT        | Cancel                    | CANCELLED    | Personnel Records Officer                  | `personnel.actions.cancel`          | Not approved                              | Close draft                                   |
| APPROVED     | Cancel before effectivity | CANCELLED    | Appointing Authority                       | `personnel.actions.cancel_approved` | Lawful basis; not effective               | Preserve approval and cancellation            |
| EFFECTIVE    | Supersede                 | SUPERSEDED   | HRMO / Appointing Authority                | `personnel.actions.supersede`       | New valid action                          | Close prior action prospectively              |

---

## Attendance Configuration Versions

Work Schedule Versions, Work Arrangement Versions, and Holiday Calendar Versions use:

```text
DRAFT
ACTIVE
SUPERSEDED
```

| Current | Action         | Next       | Actor            | Permission                          | Validations                                                                                                                                  | Side effects                                               |
| ------- | -------------- | ---------- | ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| None    | Create version | DRAFT      | HR Administrator | `attendance.configuration.manage`   | Agency-owned stable record                                                                                                                   | Create editable draft                                      |
| DRAFT   | Update draft   | DRAFT      | HR Administrator | `attendance.configuration.manage`   | Not used by an Attendance Day                                                                                                                | Preserve draft audit history                               |
| DRAFT   | Activate       | ACTIVE     | HR Administrator | `attendance.configuration.activate` | Exact authority Document Version, approving authority, effectivity, complete Day Rules or calendar entries, and no conflicting active period | Freeze version for new assignments or date resolution      |
| ACTIVE  | Supersede      | SUPERSEDED | HR Administrator | `attendance.configuration.activate` | Complete successor and prospective effectivity                                                                                               | Activate successor without rewriting prior Attendance Days |

Activation records an already-approved agency configuration and does not start another approval workflow. A Holiday Calendar Version holds at most one classification per date. Whether a classification is a Non-Working Holiday is one fixed national rule shared by Attendance and Leave, not a Work Schedule Version setting (ADR 0006). A Schedule Assignment separately records its assignment authority and may reference only active configuration versions. Schedule Assignments cannot overlap for the same Appointed Personnel.

---

## 5.11 Attendance Review and Finalization

### Attendance Day

Statuses:

```text
PENDING
CALCULATED
EXCEPTION
APPROVED
```

| Current    | Action                                         | Next       | Actor                         | Permission                       | Validations                                                                                                                   | Side effects                                                 |
| ---------- | ---------------------------------------------- | ---------- | ----------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| None       | Create attendance day                          | PENDING    | System                        | Internal                         | Attendance Applicability covers Work Date, or complete events establish Unscheduled Service                                   | Initialize calculation version                               |
| PENDING    | Calculate                                      | CALCULATED | System / HR Administrator     | `attendance.days.calculate`      | Exact effective configuration, events, Attendance Context, posted leave, and holiday classification resolve without ambiguity | Store immutable segments, totals, and source snapshot        |
| PENDING    | Detect exception                               | EXCEPTION  | System                        | Internal                         | Missing configuration, unmatched or incomplete events, or conflicting coverage classification                                 | Create blocking Attendance Exception without inferred values |
| CALCULATED | Flag exception                                 | EXCEPTION  | HR Administrator              | `attendance.days.flag`           | Reason required                                                                                                               | Create blocking review item                                  |
| CALCULATED | Approve through Employee Attendance Submission | APPROVED   | HR Officer / HR Administrator | `attendance.submissions.approve` | Exact version is current; no unresolved exception; reviewer is not submitter                                                  | Approve only the submitted calculation version               |
| EXCEPTION  | Recalculate after correction or resolved input | PENDING    | System / HR Administrator     | `attendance.days.calculate`      | Retained resolution or correction effect exists                                                                               | Create a successor Attendance Day version                    |

Attendance Day versions never enter period review, lock, or adjustment states. Those states belong to Employee Attendance Submissions, Attendance Period Versions, and correction records.

Calculation counts Fully Covered Minutes from raw timestamps and applies no implicit grace or rounding (ADR 0005). A partial minute at a time-in, break, time-out, or Attendance Context boundary stays uncovered, and inside expected duty it becomes a deficit. The rule snapshot names the convention, and the input fingerprint includes it, so Attendance Period Reconciliation refuses a lock over a Day calculated under a different convention until it is recalculated as a successor.

### Employee Attendance Submission

```text
DRAFT
SUBMITTED
RETURNED
APPROVED
CANCELLED
STALE
```

| Current                        | Action                     | Next      | Actor                         | Permission                                | Validations                                                                                   | Side effects                                         |
| ------------------------------ | -------------------------- | --------- | ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| None                           | Create own submission      | DRAFT     | Employee                      | `attendance.submissions.create`           | Own Attendance Period and exact current day versions                                          | Save draft snapshot                                  |
| None                           | Create on behalf           | DRAFT     | HR Administrator              | `attendance.submissions.create_on_behalf` | Assigned scope; reason and evidence                                                           | Preserve subject, initiator, recorder, and evidence  |
| DRAFT or RETURNED              | Submit                     | SUBMITTED | Employee / HR Administrator   | `attendance.submissions.submit`           | Complete disclosed exceptions and correction references                                       | Route HR review                                      |
| SUBMITTED                      | Return                     | RETURNED  | HR Officer / HR Administrator | `attendance.submissions.return`           | Reason required                                                                               | Notify submitter                                     |
| SUBMITTED                      | Approve                    | APPROVED  | HR Officer / HR Administrator | `attendance.submissions.approve`          | Every day is current and calculated; no unresolved exception; reviewer differs from submitter | Mark exact included Attendance Day versions approved |
| DRAFT or SUBMITTED             | Cancel                     | CANCELLED | Submitter                     | `attendance.submissions.cancel`           | Not approved                                                                                  | Preserve history                                     |
| DRAFT or SUBMITTED or RETURNED | Detect changed day version | STALE     | System                        | Internal                                  | Any included Attendance Day was recalculated                                                  | Require a new submission version                     |

### Attendance Period Version

The stable Attendance Period is `OPEN` until its first successful lock and `FINALIZED` thereafter. It never reopens.

```text
FOR_REVIEW
APPROVED
RETURNED
LOCKED
```

| Current    | Action                 | Next       | Actor                         | Permission                   | Validations                                                                                                                | Side effects                                                                                                       |
| ---------- | ---------------------- | ---------- | ----------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| None       | Submit period snapshot | FOR_REVIEW | HR Administrator              | `attendance.periods.submit`  | Complete applicable population; approved submissions and exact current day versions; no unresolved exception or correction | Create immutable Attendance Period Version and bind Approval Route Version                                         |
| FOR_REVIEW | Return                 | RETURNED   | HR Officer / HR Administrator | `attendance.periods.return`  | Reason required                                                                                                            | Preserve snapshot; permit preparation of a new version                                                             |
| FOR_REVIEW | Approve                | APPROVED   | HR Officer / HR Administrator | `attendance.periods.approve` | Snapshot and routed authority unchanged                                                                                    | Record reviewer and decision                                                                                       |
| APPROVED   | Lock                   | LOCKED     | HR Administrator              | `attendance.periods.lock`    | Reviewer differs from locker; Attendance Period Reconciliation succeeds                                                    | Atomically finalize stable period, create DTRs and idempotent payroll publication, and append audit/outbox records |

A lock failure leaves the version `APPROVED` and creates no partial output. A correction to a locked version creates a complete successor rather than changing the predecessor.

---

## 5.12 Attendance Correction

Statuses:

```text
DRAFT
SUBMITTED
NEEDS_INFORMATION
APPROVED
FOR_AUTHORIZATION
REJECTED
CANCELLED
APPLIED
```

| Current           | Action                                   | Next              | Actor                         | Permission                                | Validations                                                                                            | Side effects                                                                                 |
| ----------------- | ---------------------------------------- | ----------------- | ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| None              | Create request                           | DRAFT             | Employee / HR Administrator   | `attendance.corrections.create`           | Own record or administrator scope; exact target or proposed source fact                                | Save proposed ADD, REPLACE, or VOID change                                                   |
| DRAFT             | Submit                                   | SUBMITTED         | Employee / HR Administrator   | `attendance.corrections.submit`           | Reason, immutable evidence, Approval Route Version, and impact preview complete                        | Notify HR Officer                                                                            |
| SUBMITTED         | Request information                      | NEEDS_INFORMATION | HR Officer / HR Administrator | `attendance.corrections.return`           | Comment required                                                                                       | Notify submitter                                                                             |
| NEEDS_INFORMATION | Resubmit                                 | SUBMITTED         | Employee / HR Administrator   | `attendance.corrections.submit`           | Evidence and refreshed preview complete                                                                | Resume review                                                                                |
| SUBMITTED         | Approve and apply open-period correction | APPLIED           | HR Officer / HR Administrator | `attendance.corrections.approve`          | Reviewer is not subject, initiator, recorder, or applier; previewed versions unchanged                 | Atomically record approval and effect and recalculate every affected Work Date               |
| SUBMITTED         | Approve locked-period correction         | FOR_AUTHORIZATION | HR Officer / HR Administrator | `attendance.corrections.approve`          | Same separation and preview checks; at least one affected period is locked                             | Record factual approval; notify HR Administrator authorizer                                  |
| FOR_AUTHORIZATION | Authorize and apply                      | APPLIED           | HR Administrator              | `attendance.corrections.authorize_locked` | Authorizer differs from factual reviewer and other prohibited actors; locked predecessors unchanged    | Atomically create grouped adjustment, effects, and successor day and period versions         |
| None              | Accept posted-leave handoff              | FOR_AUTHORIZATION | Leave canceller               | `leave.applications.apply_cancellation`   | Applied Leave Cancellation changes posted leave on a locked Work Date; evidence names the cancellation | Record `POSTED_LEAVE_INPUT` REPLACE or VOID; the approved cancellation is the factual review |
| None              | Accept CTO handoff                       | FOR_AUTHORIZATION | CTO canceller                 | `overtime.cto.cancel`                     | CTO cancellation changes a CTO input on a locked Work Date; evidence names the cancellation            | Record `CTO_INPUT` REPLACE or VOID; the approved cancellation is the factual review          |
| FOR_AUTHORIZATION | Record blocking reason                   | FOR_AUTHORIZATION | HR Administrator              | `attendance.corrections.authorize_locked` | `POSTED_LEAVE_INPUT` or `CTO_INPUT` only; reason required; same separation as authorization            | The source shows the reason; its fact and locked records stay unchanged                      |
| SUBMITTED         | Reject                                   | REJECTED          | HR Officer / HR Administrator | `attendance.corrections.reject`           | Reason required                                                                                        | Notify submitter                                                                             |
| DRAFT             | Cancel                                   | CANCELLED         | Employee                      | `attendance.corrections.cancel`           | Not submitted                                                                                          | Close request                                                                                |
| SUBMITTED         | Cancel                                   | CANCELLED         | Employee / HR Administrator   | `attendance.corrections.cancel`           | Not yet decided or authorized withdrawal                                                               | Stop approval                                                                                |

`APPROVED` remains in the transition history when an open-period approval and application commit atomically; it is not a waiting state. An applied correction may create an Attendance Exception, which blocks submission or period review but does not undo the correction effect.

---

## 5.13 Leave Application

Before submission, the Leave domain shall select the Leave Policy Version,
schedule, and holiday facts effective for each requested date and create
immutable Leave Calculation Segments. Eligibility is a structured result of
`ELIGIBLE`, `INELIGIBLE`, or `INDETERMINATE`; a missing or conflicting required
fact blocks submission, certification, approval, and posting rather than
defaulting to a favorable result.

For credit-bearing leave, posted balance and available credits are separate
facts. Posted balance is derived only from immutable Leave Ledger Entries.
Active Leave Credit Commitments reduce availability but never appear in the
ledger. HR certification creates commitments under account lock. Posting
consumes them; withdrawal, rejection, material return, invalidation, or
supersession releases them. An authorized partial approval may replace a
certified commitment only with a linked, smaller successor.

The Leave Application is a stable case. Submission or material resubmission
freezes a Leave Application Version with its typed facts, Leave Submission
Attestation, exact form and evidence Document Versions, accepted assessment,
and Approval Route Version. Shared Approval Routes own tasks and Approval
Decisions. Leave owns the certification, recommendation, approval allocation,
commitment, posting, withdrawal, and cancellation validations.

Statuses:

```text
DRAFT
SUBMITTED
FOR_CERTIFICATION
FOR_RECOMMENDATION
FOR_APPROVAL
APPROVED
REJECTED
NEEDS_INFORMATION
WITHDRAWN
CANCEL_REQUESTED
CANCELLED
POSTED
```

| Current                                                           | Action                                | Next               | Actor                                                         | Permission                              | Validations                                                                                                                                                                  | Side effects                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------- | ------------------ | ------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| None                                                              | Create application                    | DRAFT              | Employee / Leave Administrator                                | `leave.applications.create`             | Leave type available; draft may carry deficiencies                                                                                                                           | Save draft                                                                                                               |
| DRAFT                                                             | Submit                                | SUBMITTED          | Employee / Leave Administrator recording signed form          | `leave.applications.submit`             | Typed required facts and exact Document Versions; complete policy inputs; `ELIGIBLE` assessment; authenticated attestation or exact signed form                              | Freeze Leave Application Version and bind Approval Route Version                                                         |
| SUBMITTED                                                         | Send for credit certification         | FOR_CERTIFICATION  | System / Leave Administrator                                  | `leave.applications.route`              | Employee and route valid                                                                                                                                                     | Activate certification step                                                                                              |
| FOR_CERTIFICATION                                                 | Certify credits                       | FOR_RECOMMENDATION | Leave Administrator                                           | `leave.credits.certify`                 | Exact version and assessment; effective balance date; ledger cutoff; account status; posted balance; active commitments; application quantity                                | Under account lock, freeze certification and create commitments                                                          |
| FOR_CERTIFICATION / FOR_RECOMMENDATION / FOR_APPROVAL             | Request material information          | NEEDS_INFORMATION  | Current authorized reviewer                                   | `leave.applications.return`             | Comment; changed facts or evidence required                                                                                                                                  | Cancel unfinished route work and release commitments                                                                     |
| NEEDS_INFORMATION                                                 | Resubmit                              | SUBMITTED          | Employee / authorized recorder                                | `leave.applications.submit`             | New attestation; deficiencies resolved; complete assessment                                                                                                                  | Freeze successor Leave Application Version and restart route                                                             |
| SUBMITTED / FOR_CERTIFICATION / FOR_RECOMMENDATION / FOR_APPROVAL | Withdraw                              | WITHDRAWN          | Employee / Leave Administrator recording evidenced withdrawal | `leave.applications.withdraw`           | No final approval; administrator has exact withdrawal evidence                                                                                                               | Cancel route work and release commitments                                                                                |
| FOR_RECOMMENDATION                                                | Recommend approval or rejection       | FOR_APPROVAL       | Supervisor                                                    | `leave.applications.recommend`          | Exact version; reason required for negative recommendation                                                                                                                   | Append Leave Recommendation and continue route                                                                           |
| FOR_APPROVAL                                                      | Approve full or exact subset          | APPROVED           | Authorized Approving Official                                 | `leave.applications.approve`            | Current certification and recommendation; no self-approval; bound policy authorizes each allocation kind; unpaid leave covers only the quantity above certified availability | Append Approval Decision and Leave Approval Allocation; narrow commitment through linked successor when needed           |
| FOR_APPROVAL                                                      | Reject                                | REJECTED           | Authorized Approving Official                                 | `leave.applications.reject`             | Exact version; reason required                                                                                                                                               | Append decision and release commitments                                                                                  |
| APPROVED                                                          | Post leave                            | POSTED             | Leave Administrator / System                                  | `leave.applications.post`               | Exact version, assessment, certification, commitment, allocation, and decisions valid; account availability rechecked under stable account locks                             | Atomically create all ledger, Attendance, Payroll, audit, and outbox effects through owning services; consume commitment |
| APPROVED / POSTED                                                 | Request whole or partial cancellation | CANCEL_REQUESTED   | Employee / Leave Administrator recording evidenced request    | `leave.applications.request_cancel`     | Exact scope, reason, evidence, and applicable cancellation route                                                                                                             | Create separate Leave Cancellation and route request                                                                     |
| CANCEL_REQUESTED                                                  | Reject cancellation                   | APPROVED or POSTED | Authorized Approver                                           | `leave.applications.reject_cancel`      | Exact prior effect; reason required                                                                                                                                          | Preserve original approval and posting                                                                                   |
| CANCEL_REQUESTED                                                  | Approve cancellation                  | CANCEL_REQUESTED   | Authorized Approver                                           | `leave.applications.cancel`             | Exact scope; authority; no enlargement or substitution                                                                                                                       | Mark Leave Cancellation approved with effects pending                                                                    |
| CANCEL_REQUESTED                                                  | Apply cancellation                    | CANCELLED          | Leave Administrator / System                                  | `leave.applications.apply_cancellation` | Approved cancellation; exact original effects; owner handoffs accepted                                                                                                       | Atomically release commitment or create exact ledger reversal/replacement and Attendance/Payroll correction handoffs     |

### Leave policy and credit invariants

- An active Leave Policy Version is immutable and has no overlapping active
  version for the same Leave Type. It uses a fixed evaluator kind, typed
  parameters, and authority-linked Agency configuration. Arbitrary executable
  formulas are prohibited.
- A request spanning version boundaries keeps one application but has separate
  Leave Calculation Segments for each effective combination of policy, schedule,
  holiday calendar, and unit.
- A Leave Account covers one Employee, one credit-bearing Leave Type, and one
  continuous agency-employment entitlement period. Separation closes the
  account; evidence-backed reemployment or transfer opens a new account.
- A Leave Ledger Entry contains a signed quantity and an authoritative source,
  not a business-event enum. Source posting keys are unique per account. Posted
  entries are immutable, and a reversal exactly negates its original entry in
  the same account.
- Whole cancellation exactly reverses affected entries. Partial cancellation
  fully reverses each affected entry and creates a replacement for the retained
  effect, using the original effective date and a later posting time.
- Balance-sensitive commands serialize against the Leave Account, recompute
  posted balance and active commitments within the transaction, and reject a
  result that the applicable policy does not permit.
- A historical Leave Credit Certification remains unchanged when later facts or
  backdated entries produce a different current reconstruction. Its current
  authority is derived; a new application version or assessment, invalidated
  account, or unsupported commitment replacement requires recertification.
- A Leave Posting or applied Leave Cancellation commits every required
  authoritative effect or none. A failed cancellation effect leaves the
  cancellation approved and the original posting effective. Accepted Attendance
  or Payroll adjustment handoffs retain their own truthful pending status.
- Commitments do not silently expire. A route interruption blocks progression
  until authorized rerouting creates a new Leave Application Version and
  recertification, unless an authoritative policy provides a different result.
- A Mandatory Leave Assessment is explainable and policy-derived. It may prompt
  an ordinary Leave Application but cannot approve leave or post a forfeiture.
- A Mandatory Leave Assessment covers one Employee and calendar year. The
  Employee is `SUBJECT` when the posted vacation Leave Account balance reached
  ten or more at any point in that year up to the as-of date, and
  `NOT_SUBJECT` when it did not. MC41 section 25 states no measurement point;
  this reading keeps an Employee who already took leave, or who monetized under
  section 25(d), subject. This is a Project Decision (#439).
- Fulfillment counts the working dates in that year of posted Leave
  Application allocations charged to the vacation Leave Account, net of
  applied cancellations, including posted dates later in the year. Leave
  without pay, monetization, and ledger adjustments are not leave taken. A met
  obligation stays `SUBJECT` with fulfilled quantity at least the required
  quantity.
- A missing applicable Leave Policy Version or vacation Leave Account produces
  a persisted `INDETERMINATE` assessment.
- Leave posting, applied cancellation, Leave Policy Version activation, and
  every vacation Leave Account ledger entry re-evaluate the affected Employee
  in the same transaction, for every year from the effective date's year
  through the current year. An evaluation writes a new assessment only when
  its result, quantities, threshold basis, or governing Leave Policy Version
  changed. An explicit Agency and year evaluation covers new years; an
  Employee with no assessment for a year is shown as not yet evaluated.
- Phase 7 does not post mandatory-leave forfeiture, so the section 25
  consultation, schedule, exigency cancellation, and retirement or resignation
  facts are not recorded. They only prevent forfeiture.

---

## 5.14 Leave Monetization Request

Statuses:

```text
DRAFT
SUBMITTED
CREDIT_CERTIFIED
NEEDS_INFORMATION
FOR_APPROVAL
APPROVED
REJECTED
POSTED
WITHDRAWN
CANCELLED
```

| Current                                                         | Action                                           | Next              | Actor                          | Permission                          | Validations                                                                                                           | Side effects                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------ | ----------------- | ------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| None                                                            | Create request                                   | DRAFT             | Employee / Leave Administrator | `leave.monetization.create`         | Employee and applicable account candidates identified                                                                 | Save mutable draft                                                                                                  |
| DRAFT                                                           | Submit or record signed request                  | SUBMITTED         | Employee / Leave Administrator | `leave.monetization.submit`         | Attestation or signed Document Version, allocations, evidence, policy, authority, and Approval Route Version complete | Freeze Leave Monetization Request Version and start assessment                                                      |
| SUBMITTED                                                       | Certify eligibility and credits                  | CREDIT_CERTIFIED  | HR Certifying Officer          | `leave.monetization.certify`        | `ELIGIBLE` assessment; all accounts locked; balances, commitments, retention, limits, reason, and authority rechecked | Freeze certification and create one commitment per allocation                                                       |
| SUBMITTED                                                       | Request information                              | NEEDS_INFORMATION | HR Certifying Officer          | `leave.monetization.return`         | Ineligible or indeterminate result explained                                                                          | Preserve assessment; no commitments                                                                                 |
| CREDIT_CERTIFIED                                                | Record supported funding                         | FOR_APPROVAL      | Budget Officer                 | `leave.monetization.review_funding` | Current fiscal authority, funding source, amount basis, and exact evidence are determinate                            | Freeze funding determination and start bound Approval Route                                                         |
| CREDIT_CERTIFIED                                                | Return unsupported or indeterminate funding      | NEEDS_INFORMATION | Budget Officer                 | `leave.monetization.review_funding` | Reason and missing facts recorded                                                                                     | Freeze funding determination and release commitments                                                                |
| NEEDS_INFORMATION                                               | Resubmit material changes                        | SUBMITTED         | Employee / Leave Administrator | `leave.monetization.submit`         | New attestation or signed request and corrected evidence complete                                                     | Freeze successor request version and restart assessment                                                             |
| FOR_APPROVAL                                                    | Approve full or smaller same-account allocations | APPROVED          | Authorized Approving Official  | `leave.monetization.approve`        | Current assessment, certification, funding, commitments, route, authority, and actor separation valid                 | Freeze approval; narrow commitments atomically when applicable                                                      |
| FOR_APPROVAL                                                    | Reject                                           | REJECTED          | Authorized Approving Official  | `leave.monetization.reject`         | Reason required                                                                                                       | Preserve decision and release commitments                                                                           |
| APPROVED                                                        | Post                                             | POSTED            | Leave Administrator            | `leave.monetization.post`           | Payroll accepts matching authority-bound input; all source versions and commitments remain current                    | Atomically create negative ledger entries, consume commitments, and store Payroll result, audit, and outbox records |
| DRAFT                                                           | Cancel draft                                     | CANCELLED         | Employee / Leave Administrator | `leave.monetization.cancel`         | Draft not submitted                                                                                                   | Close draft                                                                                                         |
| SUBMITTED / CREDIT_CERTIFIED / NEEDS_INFORMATION / FOR_APPROVAL | Withdraw                                         | WITHDRAWN         | Employee / Leave Administrator | `leave.monetization.withdraw`       | Employee attestation or exact signed evidence; no final approval                                                      | Stop route work and release commitments                                                                             |
| APPROVED                                                        | Cancel before posting                            | CANCELLED         | Authorized Approving Official  | `leave.monetization.cancel`         | Exact approval, reason, evidence, and authority                                                                       | Preserve approval and release commitments                                                                           |

The subject or recorder may not certify, review funding, approve, or post. The HR
credit certifier, Budget funding reviewer, final approver, and posting executor
must differ unless a controlling authority expressly establishes another
arrangement. Approval alone creates no ledger or Payroll effect.

An accepted Monetization Adjustment records exact whole or partial scope,
reason, evidence, route, decisions, stable effect keys, and Payroll result. Leave
restores credits only when Payroll accepts cancellation, replacement, or a linked
adjustment. A rejected or failed owner handoff leaves the original posting
effective and the adjustment approved for blocked or retryable handling.

## 5.15 Terminal Leave Input Preservation

| Current                          | Action                               | Next          | Actor                                      | Permission                       | Validations                                                                                                    | Side effects                                                                   |
| -------------------------------- | ------------------------------------ | ------------- | ------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| None                             | Request preservation                 | ASSESSING     | Separation service / HR Certifying Officer | `leave.terminal_inputs.preserve` | Separation effective; required Leave postings through last service date complete                               | Bind exact source references and cutoffs                                       |
| ASSESSING                        | Record missing or conflicting facts  | INDETERMINATE | HR Certifying Officer                      | `leave.terminal_inputs.preserve` | Explanation and source gaps complete                                                                           | Freeze non-consumable assessment                                               |
| ASSESSING                        | Certify ready inputs                 | READY         | HR Certifying Officer                      | `leave.terminal_inputs.preserve` | Separation, service, accounts, balances, cutoffs, authorities, clearance, evidence, and salary source verified | Freeze Terminal Leave Input Snapshot and return stable reference to Separation |
| READY                            | Record accepted or duplicate handoff | ACCEPTED      | Separation application service             | Owning-service contract          | Source key and snapshot match                                                                                  | Preserve acceptance without transferring fact ownership                        |
| READY                            | Record rejected or retryable handoff | READY         | Separation application service             | Owning-service contract          | Reason or technical failure recorded                                                                           | Retain snapshot for correction or retry                                        |
| INDETERMINATE / READY / ACCEPTED | Reassess corrected facts             | ASSESSING     | Separation service / HR Certifying Officer | `leave.terminal_inputs.preserve` | Reason and corrected source versions identified                                                                | Create successor assessment; never rewrite history                             |

A terminal input assessment or snapshot cannot close an account, post to the
ledger, calculate or authorize a benefit, or create a Payroll Input.
`READY` and `ACCEPTED` in this table are derived handoff projections; append-only
handoff outcomes do not mutate the Terminal Leave Input Snapshot.

---

## 5.16 Overtime Authority

The sources cited in §5.16–5.17 are recorded in [overtime-coc-cto-authorities.md](research/overtime-coc-cto-authorities.md).

Statuses:

```text
DRAFT
SUBMITTED
FOR_REVIEW
APPROVED
REJECTED
CANCELLED
```

An approved authority is in effect from the later of its Asia/Manila approval date and its first Work Date, through its last Work Date, and has ended after that. Both are derived from those dates, so no System job changes its status. The Approving Official fixes its compensation method, `COC` or `OVERTIME_PAY`, when approving it, as the agency head decides the manner of compensation for each authority (JC 2, s. 2015 items 3.2, 3.3, 5.3). `OVERTIME_PAY` is refused with a typed blocking reason naming Payroll until #347 adds the Payroll Input. COC uses no funds, so a funding reference is required only for `OVERTIME_PAY`. No source allows service rendered without prior authority to be ratified, so none is.

| Current    | Action                | Next       | Actor                             | Permission                     | Validations                                                                                                         | Side effects                                                              |
| ---------- | --------------------- | ---------- | --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| None       | Create authority      | DRAFT      | Supervisor / HR Administrator     | `overtime.authorities.create`  | Purpose, Work Dates, covered Appointed Personnel with authorized hours, proposed method                             | Save draft                                                                |
| DRAFT      | Submit                | SUBMITTED  | Supervisor / HR Administrator     | `overtime.authorities.submit`  | Required details complete                                                                                           | Start review                                                              |
| SUBMITTED  | Review                | FOR_REVIEW | HR Administrator / Budget Officer | `overtime.authorities.review`  | Eligibility, necessity; reviewer attests the eligibility facts the system does not hold; funding for `OVERTIME_PAY` | Create review result                                                      |
| FOR_REVIEW | Approve               | APPROVED   | Approving Official                | `overtime.authorities.approve` | Shared Approval Route; approver is not the preparer or submitter; eligibility rechecked; method is `COC` until #347 | Fix method; store each Employee's eligibility snapshot; authorize service |
| FOR_REVIEW | Reject                | REJECTED   | Approving Official                | `overtime.authorities.reject`  | Reason required                                                                                                     | Notify requester                                                          |
| DRAFT      | Cancel                | CANCELLED  | Supervisor / HR Administrator     | `overtime.authorities.cancel`  | Not submitted                                                                                                       | Close                                                                     |
| APPROVED   | Cancel before service | CANCELLED  | Approving Official                | `overtime.authorities.cancel`  | No Overtime Service Record exists                                                                                   | Stop authority                                                            |

Covered Employees are Appointed Personnel of the Agency. The eligibility snapshot stores, per covered Employee:

- system-derived facts: Appointed Personnel category, appointment status, position and salary grade, and the Work Arrangement Versions over the authority's Work Dates;
- the reviewer's attestations for facts the system does not hold: the Employee is at division-chief level or below, or is such an incumbent designated Officer-in-Charge of a higher position, and receives no other allowance for service beyond prescribed hours (JC 2, s. 2015 items 6.1–7.0).

Part-time Employees are refused with a typed reason, since the overtime period is defined only for full-time employees (JC 2, s. 2015 item 8.2) and no authority covers them.

---

## 5.17 Overtime Service Record

Statuses:

```text
RENDERED
FOR_CERTIFICATION
CERTIFIED
NOT_CERTIFIED
```

Recording creates the record; no expected records are created in advance. Each covered Employee has at most one Overtime Service Record per Work Date that is not `NOT_CERTIFIED`, across all authorities. Claimed, authorized, actual, and certified hours are stored separately. Actual and certified hours are whole minutes, as Attendance counts them (ADR 0005), so the COC award needs no rounding (ADR 0009).

Actual Overtime Hours are read through Attendance's application service from the Attendance Day version in the latest locked Attendance Period Version covering the Work Date: its outside-schedule `WORKED` minutes and its day classification. Hours inside a compressed-workweek day's expected duty are not overtime. A record whose Work Date has no locked Attendance cannot be submitted.

| Current           | Action                | Next              | Actor                                            | Permission                 | Validations                                                                                                                                                                                                                                                                                                                                   | Side effects                                             |
| ----------------- | --------------------- | ----------------- | ------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| None              | Record service        | RENDERED          | Employee (own) / Supervisor                      | `overtime.service.record`  | Approved authority covers the Employee and Work Date; Work Date is not before the authority's approval date or after today, both in Asia/Manila                                                                                                                                                                                               | Store claimed hours and accomplishment                   |
| RENDERED          | Submit certification  | FOR_CERTIFICATION | Employee (own) / Supervisor                      | `overtime.service.submit`  | Locked Attendance exists for the Work Date; accomplishment stated                                                                                                                                                                                                                                                                             | Store Actual Overtime Hours and their source day version |
| FOR_CERTIFICATION | Certify               | CERTIFIED         | Supervisor (Direct Reports) / Approving Official | `overtime.service.certify` | Certifier is not the Employee; Attendance re-read and unchanged since submission; certified hours, net of breaks, do not exceed actual hours, and the Employee's certified hours across the authority do not exceed authorized hours; no official travel on the date; the Work Arrangement on the date requires physically reporting for work | Store Certified Overtime Hours                           |
| FOR_CERTIFICATION | Decline certification | NOT_CERTIFIED     | Supervisor (Direct Reports) / Approving Official | `overtime.service.reject`  | Reason required                                                                                                                                                                                                                                                                                                                               | Exclude from compensation                                |

Work from home and work from another fixed place earn neither COC nor Overtime Pay (CSC MC No. 6, s. 2022). A satellite-office arrangement is refused at certification with a typed reason, because no authority covers it.

A certified record is credited only through a Certificate of COC Earned. Whether it is on a certificate, and what that certificate credited, is derived from the certificate line rather than stored as a service-record status. When a Locked Attendance Adjustment later changes the source day version, the certified record and any COC stay unchanged; the Overtime workspace flags the record as changed since certification, and HR corrects the COC through an adjustment or reversal.

---

## Certificate of COC Earned

Statuses:

```text
DRAFT
FOR_APPROVAL
APPROVED
DISCARDED
```

A Certificate of COC Earned awards COC for one Employee's certified Overtime Service Records under `COC` authorities whose Work Dates fall in one calendar month. The Head of Office grants it each month, and the HRMO computes it (JC 2, s. 2004 items 5.8, 6.3, 7.1.2, Annex A). An Employee may have more than one certificate for a month, and the monthly cap applies across them. A certified record can be a line on only one certificate that is not `DISCARDED`.

The COC module applies the earning ratio, caps, and validity. For each line, Overtime passes the certified minutes, day classification, and service record as the source. The COC module returns the credited minutes and any excess, which stays certified but uncredited.

- The ratio is 1.0 for a scheduled workday, including `SPECIAL_WORKING`, and 1.5 for a Day Rule `REST` day, `REGULAR_HOLIDAY`, `SPECIAL_NON_WORKING`, and `LOCAL_HOLIDAY` (JC 2, s. 2004 items 5.4.1–5.4.2). A CWW non-working day is a `REST` day. A `LOCAL_HOLIDAY` takes 1.5 as a scheduled day off under ADR 0006, whatever issuance it rests on.
- The 40-hour monthly cap counts COC after the ratio, across all approved certificates for the earned month. The 120-hour cap counts the account's balance as of the approval date. Each line is credited the least of its COC, the month's remaining 2,400 minutes, and the balance's remaining 7,200 minutes, applied in Work Date order.
- The certificate's Valid Until is December 31 of the year after its earned month (JC 2-A, s. 2005 item 2.0). CSC MC No. 11, s. 2024 restated the caps and validity for one event and amends neither joint circular, so it is not applied. Approval is refused with a typed reason when the Valid Until has already passed. The arrival and two-hour minimum in JC 2, s. 2015 item 10.1 governs overtime work with pay, so it does not apply to COC. Service on a whole-day work suspension or under a partial-day suspension is refused with a typed reason, because no authority sets its ratio.

| Current      | Action  | Next         | Actor              | Permission                          | Validations                                                                                 | Side effects                                                                                      |
| ------------ | ------- | ------------ | ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| None         | Prepare | DRAFT        | HR Administrator   | `overtime.coc_certificates.prepare` | Lines are the Employee's certified records for the month, not on another active certificate | Save draft                                                                                        |
| DRAFT        | Submit  | FOR_APPROVAL | HR Administrator   | `overtime.coc_certificates.prepare` | At least one line                                                                           | Start shared Approval Route                                                                       |
| FOR_APPROVAL | Return  | DRAFT        | Approving Official | `overtime.coc_certificates.approve` | Reason required                                                                             | Notify preparer                                                                                   |
| FOR_APPROVAL | Approve | APPROVED     | Approving Official | `overtime.coc_certificates.approve` | Approver is neither the preparer nor the covered Employee                                   | Award COC through the COC module in one transaction, keyed by the certificate; freeze certificate |
| DRAFT        | Discard | DISCARDED    | HR Administrator   | `overtime.coc_certificates.prepare` | Not submitted                                                                               | Release its lines                                                                                 |

An approved certificate is immutable. Its COC is corrected only by a COC adjustment or reversal.
---

## 5.18 COC Ledger Entry

A COC Account covers one Employee and one continuous period of employment in the Agency. The first award opens it. A COC Ledger Entry is a signed number of minutes, at one decimal place, with an effective date, a typed source and posting key, and the `valid_until` of the COC it changes. There is no entry-type enum; the source says what the entry is. Posted entries are immutable. A reversal exactly negates its original in the same account, and an entry is reversed at most once (ADR 0009).

The ratios, caps, validity, CTO blocks, and five-day limit are national rules in code, as in ADR 0006, and each award, use, expiry, and forfeiture records the rule it applied. A use, adjustment, expiry, or forfeiture draws from COC sharing one Valid Until. A use draws first from the earliest-expiring COC still valid on its date, so one CTO splits into at most two entries. No source sets a draw order; earliest-expiring first is a Project Decision (#318), because any other order forfeits credit the Employee could have used.

| Action                  | Actor                                              | Permission             | Validation                                                                                                                                                                                                                                                                         | Side effect                                                                                                                                     |
| ----------------------- | -------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Award COC               | System, on approval of a Certificate of COC Earned | Internal               | Approved certificate; ratio, caps, and validity applied; refused when the approval date is before the account's latest certificate entry (`COC_APPROVAL_BEFORE_LATEST_CERTIFICATE`) or a Work Date is on or before a closed account's close date (`COC_SERVICE_IN_CLOSED_ACCOUNT`) | Open the account if none; one positive entry per line credited                                                                                  |
| Use COC                 | System, on approval of a CTO Request               | Internal               | Balance valid on each CTO date covers the minutes                                                                                                                                                                                                                                  | Negative entries, effective on the CTO dates, by Valid Until                                                                                    |
| Adjust COC              | HR Administrator / Leave Administrator             | `overtime.coc.adjust`  | Negative only; reason and supporting Document Version; chosen Valid Until, earliest-expiring by default                                                                                                                                                                            | Negative entry                                                                                                                                  |
| Reverse incorrect entry | HR Administrator / Leave Administrator             | `overtime.coc.reverse` | Original is a negative entry not already reversed; reason and supporting Document Version                                                                                                                                                                                          | Linked reversal restoring the same Valid Until                                                                                                  |
| Expire COC              | System, scheduled                                  | Internal               | Valid Until has passed and COC remains                                                                                                                                                                                                                                             | One negative entry per COC Account and Valid Until with COC remaining, effective the day after Valid Until; restored COC expires as a new entry |
| Forfeit COC             | System, on separation or transfer out              | Internal               | Separation Case effective                                                                                                                                                                                                                                                          | One negative entry per Valid Until with COC remaining; close account                                                                            |

New credit comes only from a Certificate of COC Earned (ADR 0008). Credit returns only when a negative entry is reversed, such as an adjustment or an expiry posted in error; CTO usage returns through CTO cancellation. A reversal that restores COC whose Valid Until has already passed is followed by an expiry in the same transaction. A repeated expiry run finds nothing remaining and posts nothing. A first run that comes late posts the remainder once, effective the day after Valid Until. COC a reversal restores expires again as a new entry. Nobody adjusts or reverses entries on their own account, and a closed account is neither adjusted nor reversed. The worker checks hourly by the Asia/Manila date. Finding due expiries is a deliberate exception to Agency isolation: one function returns identifiers and dates from every Agency to the runtime role (`hris_app`, shared by the API and the worker), and each posting still runs in its Agency's context. Each expiry records a `COC_EXPIRED` audit event with actor type `SYSTEM`.

A balance as of a date counts entries effective on or before it whose Valid Until is on or after it, so COC past its Valid Until never counts, even before its expiry entry is posted. Expiry and forfeiture entries carry the Valid Until of the COC they remove, so the filter never double-counts a removal. The available balance for a CTO date also subtracts future-dated uses.

No authority addresses these, so none has an automatic effect, and any change is an authority-backed adjustment:

- the balance after promotion to a position ineligible for overtime (JC 2, s. 2004 item 5.7.3 withholds retention but states no result); Overtime eligibility already stops new earning;
- use after return from detail or secondment;
- earning, validity, or use during leave without pay.

---

## 5.19 CTO Request

Statuses:

```text
DRAFT
SUBMITTED
FOR_APPROVAL
APPROVED
REJECTED
CANCELLED
```

A CTO Request names Work Dates of one Employee, each `WHOLE` or `HALF`. A whole date charges the Work Date's expected-duty minutes, and a half date half of them, with a stated start and end time inside expected duty. That gives 480 or 240 minutes on an 8-hour day and 600 or 300 on a 10-hour compressed day: the "half or full day" blocks of JC 2, s. 2004 item 5.9.1, taken from the Employee's Work Schedule Version rather than configured. A date without expected duty is refused. A request covers at most five consecutive Work Dates (item 5.9.2). CTO must be approved before it is taken (item 5.9.3).

Approval posts the usage and creates one Attendance CTO input per Work Date in the same transaction (ADR 0009). There is no commitment and no separate posting.

| Current                 | Action    | Next                                   | Actor                                | Permission               | Validations                                                                                                    | Side effects                                                                                                |
| ----------------------- | --------- | -------------------------------------- | ------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| None                    | Create    | DRAFT                                  | Employee (own) / Leave Administrator | `overtime.cto.create`    | Active COC Account                                                                                             | Save draft                                                                                                  |
| DRAFT                   | Submit    | SUBMITTED                              | Employee (own) / Leave Administrator | `overtime.cto.submit`    | Units valid against the schedule; at most five consecutive Work Dates                                          | Start the shared Approval Route                                                                             |
| SUBMITTED               | Recommend | FOR_APPROVAL                           | Supervisor (Direct Reports)          | `overtime.cto.recommend` | Service needs                                                                                                  | Route to approval                                                                                           |
| SUBMITTED, FOR_APPROVAL | Return    | DRAFT                                  | Supervisor / Approving Official      | `overtime.cto.return`    | Comment required                                                                                               | Notify Employee                                                                                             |
| SUBMITTED, FOR_APPROVAL | Withdraw  | CANCELLED                              | Employee (own)                       | `overtime.cto.withdraw`  | Not approved                                                                                                   | Close                                                                                                       |
| FOR_APPROVAL            | Approve   | APPROVED                               | Approving Official                   | `overtime.cto.approve`   | Approver is not the Employee; balance valid on each date covers it; no Work Date in a locked Attendance Period | Post usage by Valid Until; create Attendance CTO inputs                                                     |
| FOR_APPROVAL            | Reject    | REJECTED                               | Approving Official                   | `overtime.cto.reject`    | Reason required                                                                                                | Notify Employee                                                                                             |
| DRAFT                   | Discard   | CANCELLED                              | Employee (own) / Leave Administrator | `overtime.cto.create`    | Not submitted                                                                                                  | Close                                                                                                       |
| APPROVED                | Cancel    | CANCELLED, or APPROVED if dates remain | Approving Official                   | `overtime.cto.cancel`    | Kind `RECALL` or `EMPLOYEE_REQUEST`; reason required; whole request or named Work Dates                        | Reverse the cancelled dates' usage entries; supersede each cancelled date's input, or hand off a locked one |

The Head of Office may recall approved CTO in the exigency of the service (JC 2, s. 2004 item 5.9.3), so recall is a cancellation by the Approving Official. An Employee asks for cancellation outside the system. A reschedule is a new CTO Request.

For a cancelled Work Date in an unlocked period, Attendance creates a zero successor input and recalculates. In a locked period, Attendance accepts a `CTO_INPUT` Attendance Correction at `FOR_AUTHORIZATION`, handled like the posted-leave handoff in §5.12: the approved cancellation is its factual basis, and a different HR Administrator authorizes it through the ordinary Locked Attendance Adjustment.

CTO time is excused with full pay and benefits (item 4.0). Attendance places it as covered, paid time with no deficit.

---

## 5.20 Payroll Period

Statuses:

```text
DRAFT
CALCULATING
FOR_REVIEW
CERTIFIED
APPROVED
FINALIZED
VOIDED
```

| Current     | Action                     | Next        | Actor                                       | Permission                             | Validations                                       | Side effects and audit                     |
| ----------- | -------------------------- | ----------- | ------------------------------------------- | -------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| None        | Create period              | DRAFT       | Payroll Preparer                            | `payroll.periods.create`               | No duplicate profile/period                       | Create period                              |
| DRAFT       | Start calculation          | CALCULATING | Payroll Preparer                            | `payroll.periods.calculate`            | Rule snapshot; source cutoff complete             | Queue calculation                          |
| CALCULATING | Complete calculation       | FOR_REVIEW  | System                                      | Internal                               | No technical failure; results stored              | Run validations                            |
| CALCULATING | Return on failure          | DRAFT       | System / Payroll Preparer                   | `payroll.periods.reopen`               | Failure or blocking setup issue                   | Record failure                             |
| FOR_REVIEW  | Return for correction      | DRAFT       | Accounting Reviewer / HR Certifier          | `payroll.periods.return`               | Review comment required                           | Unlock permitted inputs                    |
| FOR_REVIEW  | Certify HR inputs          | CERTIFIED   | HR Certifying Officer                       | `payroll.periods.certify`              | Personnel, attendance, and leave checks complete  | Lock certified version                     |
| CERTIFIED   | Revoke certification       | FOR_REVIEW  | HR Certifying Officer / Authorized Approver | `payroll.periods.revoke_certification` | Reason and no finalization                        | Audit revocation                           |
| CERTIFIED   | Approve payroll            | APPROVED    | Payroll Approver                            | `payroll.periods.approve`              | Review, budget, and accounting controls satisfied | Lock approval version                      |
| APPROVED    | Return before finalization | FOR_REVIEW  | Payroll Approver                            | `payroll.periods.return_approved`      | Reason; no payment release                        | Reopen controlled review                   |
| APPROVED    | Finalize payroll           | FINALIZED   | Payroll Approver                            | `payroll.periods.finalize`             | Approved version unchanged; segregation satisfied | Immutable lines; generate outputs          |
| FINALIZED   | Void payroll               | VOIDED      | Payroll Approver / Agency Authority         | `payroll.periods.void`                 | Formal correction case and authority              | Preserve original; create replacement path |

Invalid examples:

```text
DRAFT → FINALIZED
FOR_REVIEW → FINALIZED
FINALIZED → DRAFT
```

---

## 5.21 Payslip

Statuses:

```text
GENERATING
READY
RELEASED
WITHHELD
SUPERSEDED
```

| Current    | Action           | Next       | Actor                     | Permission                   | Validations                | Side effects                               |
| ---------- | ---------------- | ---------- | ------------------------- | ---------------------------- | -------------------------- | ------------------------------------------ |
| None       | Generate         | GENERATING | System                    | Internal                     | Payroll FINALIZED          | Queue PDF                                  |
| GENERATING | Mark ready       | READY      | System                    | Internal                     | File generated and secured | Store document                             |
| READY      | Release          | RELEASED   | Payroll Approver / System | `payroll.payslips.release`   | Release policy satisfied   | Notify employee                            |
| READY      | Withhold release | WITHHELD   | Payroll Approver          | `payroll.payslips.withhold`  | Authorized reason          | Prevent employee access                    |
| WITHHELD   | Release          | RELEASED   | Payroll Approver          | `payroll.payslips.release`   | Issue resolved             | Notify employee                            |
| RELEASED   | Supersede        | SUPERSEDED | Payroll Approver          | `payroll.payslips.supersede` | Replacement payroll exists | Keep historical access according to policy |

---

## 5.22 Performance Cycle

Statuses:

```text
DRAFT
PLANNING
ACTIVE
MIDYEAR_REVIEW
RATING
CALIBRATION
FINALIZED
CLOSED
CANCELLED
```

| Current        | Action              | Next           | Actor                           | Permission                         | Validations                    | Side effects             |
| -------------- | ------------------- | -------------- | ------------------------------- | ---------------------------------- | ------------------------------ | ------------------------ |
| None           | Create cycle        | DRAFT          | Performance Management Officer  | `performance.cycles.create`        | Period and policy version      | Create cycle             |
| DRAFT          | Open planning       | PLANNING       | Performance Management Officer  | `performance.cycles.open_planning` | Organizational goals available | Permit commitments       |
| PLANNING       | Activate cycle      | ACTIVE         | Performance Management Officer  | `performance.cycles.activate`      | Required commitments approved  | Start monitoring         |
| ACTIVE         | Open midyear review | MIDYEAR_REVIEW | Performance Management Officer  | `performance.cycles.open_review`   | Review date reached            | Permit target review     |
| MIDYEAR_REVIEW | Resume active cycle | ACTIVE         | Performance Management Officer  | `performance.cycles.resume`        | Reviews completed              | Continue monitoring      |
| ACTIVE         | Open rating         | RATING         | Performance Management Officer  | `performance.cycles.open_rating`   | Period ended                   | Permit assessments       |
| RATING         | Begin calibration   | CALIBRATION    | Performance Management Officer  | `performance.cycles.calibrate`     | Required ratings submitted     | Create calibration tasks |
| CALIBRATION    | Finalize cycle      | FINALIZED      | Authorized Performance Approver | `performance.cycles.finalize`      | Ratings approved and signed    | Lock final ratings       |
| FINALIZED      | Close               | CLOSED         | Performance Management Officer  | `performance.cycles.close`         | Reports generated              | Archive cycle            |
| DRAFT          | Cancel              | CANCELLED      | Performance Management Officer  | `performance.cycles.cancel`        | No active commitments          | Close draft              |

---

## 5.23 Individual Performance Commitment

Statuses:

```text
DRAFT
SUBMITTED
APPROVED
RETURNED
ACTIVE
FOR_RATING
RATED
FINALIZED
AMENDED
```

| Current    | Action                   | Next       | Actor                 | Permission                                  | Validations                       | Side effects             |
| ---------- | ------------------------ | ---------- | --------------------- | ------------------------------------------- | --------------------------------- | ------------------------ |
| None       | Create commitment        | DRAFT      | Employee / Supervisor | `performance.commitments.create`            | Active planning cycle             | Save targets             |
| DRAFT      | Submit                   | SUBMITTED  | Employee              | `performance.commitments.submit`            | Required indicators complete      | Notify supervisor        |
| SUBMITTED  | Approve                  | APPROVED   | Supervisor            | `performance.commitments.approve`           | Targets aligned and measurable    | Lock approved plan       |
| SUBMITTED  | Return                   | RETURNED   | Supervisor            | `performance.commitments.return`            | Comment required                  | Notify employee          |
| RETURNED   | Resubmit                 | SUBMITTED  | Employee              | `performance.commitments.submit`            | Revisions complete                | Resume review            |
| APPROVED   | Activate                 | ACTIVE     | System                | Internal                                    | Cycle ACTIVE                      | Permit accomplishments   |
| ACTIVE     | Submit for rating        | FOR_RATING | Employee / System     | `performance.commitments.submit_rating`     | Rating period open                | Freeze normal edits      |
| FOR_RATING | Record supervisor rating | RATED      | Supervisor            | `performance.ratings.evaluate`              | Evidence and rating complete      | Route review/calibration |
| RATED      | Finalize rating          | FINALIZED  | Authorized Approver   | `performance.ratings.approve`               | Calibration and sign-off complete | Lock rating              |
| APPROVED   | Amend target             | AMENDED    | Employee / Supervisor | `performance.commitments.amend`             | Approved midcycle basis           | Preserve original plan   |
| AMENDED    | Approve amendment        | ACTIVE     | Supervisor            | `performance.commitments.approve_amendment` | Revised targets valid             | Activate new version     |

---

## 5.24 Separation Case

Statuses:

```text
DRAFT
SUBMITTED
FOR_REVIEW
APPROVED
CLEARANCE_IN_PROGRESS
CLEARED
EFFECTIVE
CANCELLED
```

| Current               | Action                    | Next                  | Actor                                      | Permission                              | Validations                                     | Side effects                                  |
| --------------------- | ------------------------- | --------------------- | ------------------------------------------ | --------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| None                  | Create separation case    | DRAFT                 | Employee / Personnel Records Officer       | `personnel.separations.create`          | Employee active or suspended                    | Save case                                     |
| DRAFT                 | Submit                    | SUBMITTED             | Employee / Personnel Records Officer       | `personnel.separations.submit`          | Required basis and date                         | Start review                                  |
| SUBMITTED             | Review                    | FOR_REVIEW            | HRMO                                       | `personnel.separations.review`          | Authority and notice requirements               | Create review                                 |
| FOR_REVIEW            | Approve                   | APPROVED              | Appointing Authority / Authorized Approver | `personnel.separations.approve`         | Acceptance or legal basis                       | Create clearance workflow                     |
| FOR_REVIEW            | Reject or return          | DRAFT                 | HRMO / Appointing Authority                | `personnel.separations.return`          | Reason required                                 | Notify initiator                              |
| APPROVED              | Start clearance           | CLEARANCE_IN_PROGRESS | Personnel Records Officer                  | `personnel.clearance.start`             | Clearance offices configured                    | Create tasks                                  |
| CLEARANCE_IN_PROGRESS | Complete clearance        | CLEARED               | Personnel Records Officer                  | `personnel.clearance.complete`          | Required offices complete or approved exception | Permit effectuation                           |
| CLEARED               | Effect separation         | EFFECTIVE             | Personnel Records Officer / System         | `personnel.separations.effectuate`      | Effectivity reached                             | Close service, vacate position, revoke access |
| DRAFT                 | Cancel                    | CANCELLED             | Initiator / HRMO                           | `personnel.separations.cancel`          | Not approved                                    | Close case                                    |
| APPROVED              | Cancel before effectivity | CANCELLED             | Appointing Authority                       | `personnel.separations.cancel_approved` | Lawful basis                                    | Stop separation and clearance                 |

---

## 5.25 Clearance Task

Statuses:

```text
PENDING
IN_PROGRESS
CLEARED
WITH_ACCOUNTABILITY
WAIVED
CANCELLED
```

| Current             | Action                | Next                | Actor                      | Permission                                  | Validations                      | Side effects             |
| ------------------- | --------------------- | ------------------- | -------------------------- | ------------------------------------------- | -------------------------------- | ------------------------ |
| None                | Create task           | PENDING             | System / Records Officer   | `personnel.clearance.manage`                | Separation approved              | Assign office            |
| PENDING             | Start review          | IN_PROGRESS         | Assigned Clearing Officer  | `personnel.clearance.review`                | Officer scope                    | Record review            |
| IN_PROGRESS         | Clear employee        | CLEARED             | Assigned Clearing Officer  | `personnel.clearance.clear`                 | No outstanding accountability    | Sign task                |
| IN_PROGRESS         | Record accountability | WITH_ACCOUNTABILITY | Assigned Clearing Officer  | `personnel.clearance.record_accountability` | Details and amount/item required | Block overall clearance  |
| WITH_ACCOUNTABILITY | Resolve and clear     | CLEARED             | Assigned Clearing Officer  | `personnel.clearance.clear`                 | Resolution evidence              | Remove blocker           |
| WITH_ACCOUNTABILITY | Waive                 | WAIVED              | Authorized Agency Approver | `personnel.clearance.waive`                 | Legal and policy authority       | Permit overall clearance |
| PENDING             | Cancel task           | CANCELLED           | Personnel Records Officer  | `personnel.clearance.manage`                | Separation cancelled             | Close task               |

---

## 5.26 Approval Request

Statuses:

```text
PENDING
IN_PROGRESS
APPROVED
REJECTED
RETURNED
CANCELLED
EXPIRED
```

| Current                | Action                  | Next                    | Actor                      | Permission                           | Validations                    | Side effects             |
| ---------------------- | ----------------------- | ----------------------- | -------------------------- | ------------------------------------ | ------------------------------ | ------------------------ |
| None                   | Create approval request | PENDING                 | System                     | Internal                             | Workflow route resolved        | Create steps             |
| PENDING                | Activate first step     | IN_PROGRESS             | System                     | Internal                             | Approver available             | Notify approver          |
| IN_PROGRESS            | Approve current step    | IN_PROGRESS or APPROVED | Assigned Approver          | Domain-specific approval permission  | Approver is assigned/delegated | Advance step or complete |
| IN_PROGRESS            | Reject                  | REJECTED                | Assigned Approver          | Domain-specific rejection permission | Reason required                | Stop workflow            |
| IN_PROGRESS            | Return                  | RETURNED                | Assigned Approver          | Domain-specific return permission    | Comment required               | Return source record     |
| RETURNED               | Resubmit                | IN_PROGRESS             | Requester                  | Domain-specific submit permission    | Source corrected               | Rebuild or resume route  |
| PENDING                | Cancel                  | CANCELLED               | Requester / Workflow Owner | Domain-specific cancel permission    | No completed binding decision  | Stop workflow            |
| PENDING or IN_PROGRESS | Expire                  | EXPIRED                 | System                     | Internal                             | Deadline exceeded under policy | Notify owner             |

---

## 5.27 Official Document

Statuses:

```text
DRAFT
FOR_REVIEW
APPROVED
ISSUED
ARCHIVED
SUPERSEDED
VOIDED
```

| Current    | Action          | Next       | Actor                                  | Permission                    | Validations                  | Side effects                       |
| ---------- | --------------- | ---------- | -------------------------------------- | ----------------------------- | ---------------------------- | ---------------------------------- |
| None       | Create document | DRAFT      | Authorized Domain User                 | `documents.records.create`    | Entity and template valid    | Create version                     |
| DRAFT      | Submit review   | FOR_REVIEW | Document Creator                       | `documents.records.submit`    | Required fields complete     | Route review                       |
| FOR_REVIEW | Approve         | APPROVED   | Authorized Reviewer                    | `documents.records.approve`   | Content and authority valid  | Lock approved version              |
| APPROVED   | Issue           | ISSUED     | Authorized Signatory / Records Officer | `documents.records.issue`     | Signature and issue metadata | Create official copy               |
| ISSUED     | Archive         | ARCHIVED   | Records Officer                        | `documents.records.archive`   | Retention classification     | Move to archive state              |
| ISSUED     | Supersede       | SUPERSEDED | Authorized Domain User                 | `documents.records.supersede` | Replacement document exists  | Link versions                      |
| ISSUED     | Void            | VOIDED     | Authorized Signatory / Records Officer | `documents.records.void`      | Formal reason and authority  | Preserve document and mark invalid |

---

## 5.28 AI Request

Statuses:

```text
CREATED
PROCESSING
VALIDATED
NEEDS_REVIEW
ACCEPTED
REJECTED
FAILED
CANCELLED
```

| Current      | Action             | Next         | Actor           | Permission           | Validations                                       | Side effects                 |
| ------------ | ------------------ | ------------ | --------------- | -------------------- | ------------------------------------------------- | ---------------------------- |
| None         | Create request     | CREATED      | Authorized User | Domain AI permission | Feature enabled; minimum data                     | Store request metadata       |
| CREATED      | Start processing   | PROCESSING   | System          | Internal             | Provider available                                | Send controlled request      |
| PROCESSING   | Validate output    | VALIDATED    | System          | Internal             | Schema and policy checks                          | Store safe draft             |
| VALIDATED    | Present for review | NEEDS_REVIEW | System          | Internal             | User session active                               | Display recommendation       |
| NEEDS_REVIEW | Accept             | ACCEPTED     | User            | Domain AI permission | Human confirmation                                | Send through normal workflow |
| NEEDS_REVIEW | Reject             | REJECTED     | User            | Domain AI permission | Optional reason                                   | Discard authoritative effect |
| PROCESSING   | Fail               | FAILED       | System          | Internal             | Provider or validation error                      | Log safe failure             |
| CREATED      | Cancel             | CANCELLED    | User            | Domain AI permission | Not processing or provider cancellation supported | Stop request                 |

AI acceptance does not authorize the downstream business action. Normal domain permissions and approvals remain mandatory.

---

# 6. Role and Permission Matrix

Legend:

| Symbol | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| A      | Allowed by baseline role                                   |
| S      | Allowed only within assigned office or direct-report scope |
| O      | Own-record access only                                     |
| R      | Read-only                                                  |
| C      | Conditional or agency-configurable                         |
| —      | Not included in baseline role                              |

Roles may be customized, but high-risk combinations must be reviewed.

---

## 6.1 Identity and Security

| Permission                    | Agency Admin | HR Admin | Supervisor | Employee | Security Admin | DPO | Auditor |
| ----------------------------- | -----------: | -------: | ---------: | -------: | -------------: | --: | ------: |
| `security.users.read`         |            A |        R |          S |        O |              A |   R |       R |
| `security.users.invite`       |            A |        C |          — |        — |              A |   — |       — |
| `security.users.update_roles` |            A |        — |          — |        — |              A |   — |       — |
| `security.users.suspend`      |            A |        C |          — |        — |              A |   — |       — |
| `security.users.deactivate`   |            A |        C |          — |        — |              A |   — |       — |
| `security.users.reactivate`   |            A |        — |          — |        — |              A |   — |       — |
| `security.sessions.revoke`    |            A |        — |          — |        — |              A |   C |       — |
| `security.events.read`        |            A |        — |          — |        — |              A |   A |       R |
| `security.mfa.manage_policy`  |            A |        — |          — |        — |              A |   C |       — |
| `security.mfa.reset_factor`   |            — |        — |          — |        — |              A |   — |       — |
| `security.permissions.manage` |            A |        — |          — |        — |              A |   — |       — |

Controls:

- Agency Administrator and Security Administrator should be separate where staffing permits.
- A user should not approve their own elevated role assignment.
- A Security Administrator may not reset their own factor.
- Security-event logs are read-only to auditors and DPO users.

---

## 6.2 Agency Organization

| Permission                      | Agency Admin | HR Admin | Plantilla Officer | Budget Officer | Supervisor | Employee | Auditor |
| ------------------------------- | -----------: | -------: | ----------------: | -------------: | ---------: | -------: | ------: |
| `organization.agency.read`      |            A |        A |                 R |              R |          R |        R |       R |
| `organization.agency.update`    |            A |        C |                 — |              — |          — |        — |       — |
| `organization.units.read`       |            A |        A |                 A |              A |          S |        R |       R |
| `organization.units.create`     |            A |        A |                 C |              — |          — |        — |       — |
| `organization.units.update`     |            A |        A |                 C |              — |          — |        — |       — |
| `organization.units.inactivate` |            A |        A |                 — |              — |          — |        — |       — |
| `organization.policies.read`    |            A |        A |                 R |              R |          R |        R |       R |
| `organization.policies.manage`  |            A |        A |                 C |              C |          — |        — |       — |

---

## 6.3 Plantilla and Position Control

| Permission                       | HR Admin | Plantilla Officer | Budget Officer | Recruitment Officer | Personnel Officer | Appointing Authority | Auditor |
| -------------------------------- | -------: | ----------------: | -------------: | ------------------: | ----------------: | -------------------: | ------: |
| `positions.items.read`           |        A |                 A |              A |                   R |                 R |                    R |       R |
| `positions.items.create`         |        C |                 A |              C |                   — |                 — |                    — |       — |
| `positions.items.update`         |        C |                 A |              C |                   — |                 — |                    — |       — |
| `positions.items.authorize`      |        C |                 C |              A |                   — |                 — |                    C |       — |
| `positions.items.declare_vacant` |        A |                 A |              C |                   — |                 C |                    — |       — |
| `positions.items.freeze`         |        C |                 A |              A |                   — |                 — |                    — |       — |
| `positions.items.reserve`        |        C |                 C |              — |                   — |                 A |                    — |       — |
| `positions.items.occupy`         |        C |                 C |              — |                   — |                 A |                    — |       — |
| `positions.items.vacate`         |        C |                 C |              — |                   — |                 A |                    — |       — |
| `positions.items.abolish`        |        C |                 C |              A |                   — |                 — |                    C |       — |
| `positions.history.read`         |        A |                 A |              A |                   R |                 A |                    R |       R |
| `positions.qs.manage`            |        A |                 A |              C |                   C |                 R |                    — |       R |

---

## 6.4 Recruitment and Merit Selection

| Permission                            | HR Admin | Recruitment Officer | HRMPSB Member | Supervisor | Appointing Authority | Records Officer | Auditor |
| ------------------------------------- | -------: | ------------------: | ------------: | ---------: | -------------------: | --------------: | ------: |
| `recruitment.requests.create`         |        A |                   A |             — |          S |                    — |               — |       — |
| `recruitment.requests.review`         |        A |                   A |             — |          — |                    — |               — |       R |
| `recruitment.requests.rebaseline`     |        A |                   C |             — |          — |                    — |               — |       R |
| `recruitment.requests.approve`        |        A |                   C |             — |          — |                    C |               — |       — |
| `recruitment.vacancies.create`        |        A |                   A |             — |          — |                    — |               — |       — |
| `recruitment.vacancies.publish`       |        A |                   C |             — |          — |                    — |               — |       — |
| `recruitment.applications.read`       |        A |                   A |             C |          C |                    C |               — |       R |
| `recruitment.applications.create`     |        A |                   A |             — |          — |                    — |               — |       — |
| `recruitment.applications.screen`     |        A |                   A |             R |          — |                    — |               — |       — |
| `recruitment.assessments.manage`      |        A |                   A |             C |          C |                    — |               — |       — |
| `recruitment.interviews.manage`       |        A |                   A |             C |          C |                    — |               — |       — |
| `recruitment.deliberations.read`      |        A |                   C |             A |          — |                    C |               — |       R |
| `recruitment.deliberations.recommend` |        — |                   — |             A |          — |                    — |               — |       — |
| `recruitment.selection.select`        |        — |                   — |             — |          — |                    A |               — |       — |
| `recruitment.selection.decide`        |        — |                   — |             — |          — |                    A |               — |       — |
| `recruitment.reports.read`            |        A |                   A |             R |          S |                    R |               — |       R |

HRMPSB Member access should be limited to assigned vacancies and deliberation periods.

---

## 6.5 Appointment and Assumption

| Permission                             | HR Admin | Personnel Officer | Appointing Authority | Records Officer | Budget Officer | Auditor |
| -------------------------------------- | -------: | ----------------: | -------------------: | --------------: | -------------: | ------: |
| `appointments.records.read`            |        A |                 A |                    R |               R |              R |       R |
| `appointments.records.create`          |        C |                 A |                    — |               — |              — |       — |
| `appointments.records.submit`          |        C |                 A |                    — |               — |              — |       — |
| `appointments.records.review`          |        A |                 C |                    — |               — |              C |       — |
| `appointments.records.endorse`         |        A |                 C |                    — |               — |              — |       — |
| `appointments.records.issue`           |        — |                 — |                    A |               — |              — |       — |
| `appointments.records.cancel`          |        C |                 C |                    A |               — |              — |       — |
| `appointments.external_events.record`  |        C |                 A |                    — |               C |              — |       — |
| `appointments.external_actions.record` |        A |                 A |                    — |               C |              — |       — |
| `appointments.assumption.create`       |        C |                 A |                    — |               — |              — |       — |
| `appointments.oath.record`             |        C |                 A |                    C |               — |              — |       — |
| `appointments.assumption.certify`      |        C |                 A |                    C |               — |              — |       — |
| `appointments.assumption.correct`      |        A |                 C |                    C |               — |              — |       — |

---

## 6.6 Personnel Records and PDS

| Permission                          | HR Admin | Personnel Officer | Supervisor | Employee | Payroll Preparer | Records Officer | DPO | Auditor |
| ----------------------------------- | -------: | ----------------: | ---------: | -------: | ---------------: | --------------: | --: | ------: |
| `personnel.records.read`            |        A |                 A |          S |        O |                C |               C |   R |       R |
| `personnel.records.create`          |        C |                 A |          — |        — |                — |               — |   — |       — |
| `personnel.records.update`          |        C |                 A |          — |      O/C |                — |               — |   — |       — |
| `personnel.pds.read`                |        A |                 A |          C |        O |                — |               C |   R |       R |
| `personnel.pds.update`              |        C |                 A |          — |      O/C |                — |               — |   — |       — |
| `personnel.pds.certify`             |        A |                 A |          — |        O |                — |               — |   — |       — |
| `personnel.documents.read`          |        A |                 A |          C |        O |                C |               A |   R |       R |
| `personnel.documents.upload`        |        A |                 A |          — |        O |                — |               C |   — |       — |
| `personnel.documents.classify`      |        C |                 A |          — |        — |                — |               A |   C |       — |
| `personnel.service_record.read`     |        A |                 A |          C |        O |                C |               A |   R |       R |
| `personnel.service_record.generate` |        A |                 A |          — |        — |                — |               C |   — |       — |
| `personnel.actions.create`          |        A |                 A |          — |        — |                — |               — |   — |       — |
| `personnel.actions.review`          |        A |                 C |          — |        — |                — |               — |   — |       R |
| `personnel.actions.approve`         |        C |                 — |          — |        — |                — |               — |   — |       — |
| `personnel.saln_compliance.read`    |        A |                 C |          — |        O |                — |               C |   R |       R |
| `personnel.saln_compliance.update`  |        C |                 A |          — |      O/C |                — |               C |   — |       — |

Sensitive PDS fields require field-level authorization even when the role has general read access.

---

## 6.7 Attendance and DTR

| Permission                                | HR Admin | HR Officer | Employee | Payroll Preparer | Auditor |
| ----------------------------------------- | -------: | ---------: | -------: | ---------------: | ------: |
| `attendance.configuration.read`           |        A |          S |        O |                R |       R |
| `attendance.configuration.manage`         |        A |          — |        — |                — |       R |
| `attendance.configuration.activate`       |        A |          — |        — |                — |       R |
| `attendance.assignments.manage`           |        A |          — |        — |                — |       R |
| `attendance.events.create_manual`         |        A |          — |        — |                — |       R |
| `attendance.events.clock`                 |        O |          O |        O |                — |       — |
| `attendance.events.read`                  |        A |          S |        O |                R |       R |
| `attendance.contexts.create`              |        A |          — |        — |                — |       R |
| `attendance.contexts.read`                |        A |          S |        O |                R |       R |
| `attendance.days.calculate`               |        A |          — |        — |                — |       R |
| `attendance.days.read`                    |        A |          S |        O |                R |       R |
| `attendance.submissions.create`           |        O |          O |        O |                — |       R |
| `attendance.submissions.create_on_behalf` |        A |          — |        — |                — |       R |
| `attendance.submissions.submit`           |        A |          O |        O |                — |       R |
| `attendance.submissions.approve`          |        A |          A |        — |                — |       R |
| `attendance.corrections.create`           |        A |          O |        O |                — |       R |
| `attendance.corrections.submit`           |        A |          O |        O |                — |       R |
| `attendance.corrections.approve`          |        A |          A |        — |                — |       R |
| `attendance.corrections.reject`           |        A |          A |        — |                — |       R |
| `attendance.corrections.authorize_locked` |        A |          — |        — |                — |       R |
| `attendance.periods.submit`               |        A |          — |        — |                — |       R |
| `attendance.periods.approve`              |        A |          A |        — |                — |       R |
| `attendance.periods.lock`                 |        A |          — |        — |                — |       R |
| `attendance.dtr.generate`                 |        A |          S |        O |                R |       R |
| `attendance.reports.read`                 |        A |          S |        O |                R |       R |
| `attendance.payroll_publications.read`    |        A |          S |        — |                R |       R |

---

## 6.8 Leave Administration

| Permission                              | Leave Admin | HR Admin | HR Certifier | Supervisor | Employee | Budget Officer | Approving Official | Payroll Preparer | Auditor |
| --------------------------------------- | ----------: | -------: | -----------: | ---------: | -------: | -------------: | -----------------: | ---------------: | ------: |
| `leave.types.read`                      |           A |        A |            R |          R |        R |              R |                  R |                R |       R |
| `leave.types.manage`                    |           A |        A |            C |          — |        — |              C |                  — |                — |       — |
| `leave.accounts.read`                   |           A |        A |            A |          S |        O |              C |                  C |                R |       R |
| `leave.credits.certify`                 |           C |        C |            A |          — |        — |              — |                  — |                — |       — |
| `leave.credits.adjust`                  |           A |        A |            C |          — |        — |              — |                  C |                — |       — |
| `leave.applications.create`             |           A |        C |            — |          S |        O |              — |                  — |                — |       — |
| `leave.applications.submit`             |           A |        C |            — |          S |        O |              — |                  — |                — |       — |
| `leave.applications.return`             |           A |        C |            A |          S |        — |              — |                  A |                — |       — |
| `leave.applications.withdraw`           |           A |        C |            — |          — |        O |              — |                  — |                — |       — |
| `leave.applications.recommend`          |           — |        C |            — |          S |        — |              — |                  — |                — |       — |
| `leave.applications.approve`            |           — |        C |            — |          — |        — |              — |                  A |                — |       — |
| `leave.applications.reject`             |           — |        C |            — |          — |        — |              — |                  A |                — |       — |
| `leave.applications.post`               |           A |        C |            — |          — |        — |              — |                  — |                C |       — |
| `leave.applications.request_cancel`     |           A |        C |            — |          S |        O |              — |                  — |                — |       — |
| `leave.applications.cancel`             |           — |        C |            — |          — |        — |              — |                  A |                — |       — |
| `leave.applications.reject_cancel`      |           — |        C |            — |          — |        — |              — |                  A |                — |       — |
| `leave.applications.apply_cancellation` |           A |        C |            — |          — |        — |              — |                  — |                C |       — |
| `leave.mandatory_assessments.read`      |           A |        A |            — |          S |        O |              — |                  — |                — |       R |
| `leave.mandatory_assessments.evaluate`  |           A |        C |            — |          — |        — |              — |                  — |                — |       — |
| `leave.monetization.create`             |           A |        C |            — |          S |        O |              — |                  — |                — |       — |
| `leave.monetization.submit`             |           A |        C |            — |          S |        O |              — |                  — |                — |       — |
| `leave.monetization.certify`            |           C |        C |            A |          — |        — |              — |                  — |                — |       R |
| `leave.monetization.return`             |           C |        C |            A |          — |        — |              — |                  — |                — |       R |
| `leave.monetization.review_funding`     |           — |        C |            — |          — |        — |              A |                  — |                — |       R |
| `leave.monetization.approve`            |           — |        C |            — |          — |        — |              C |                  A |                — |       R |
| `leave.monetization.reject`             |           — |        C |            — |          — |        — |              C |                  A |                — |       R |
| `leave.monetization.post`               |           A |        C |            — |          — |        — |              — |                  — |                C |       R |
| `leave.monetization.adjust`             |           A |        C |            — |          — |        — |              C |                  A |                C |       R |
| `leave.terminal_inputs.read`            |           R |        R |            R |          — |        — |              — |                  R |                — |       R |
| `leave.terminal_inputs.preserve`        |           A |        C |            A |          — |        — |              — |                  C |                — |       — |
| `leave.reports.read`                    |           A |        A |            A |          S |      O/C |              R |                  R |                R |       R |

---

## 6.9 Overtime, COC, and CTO

| Permission                          | HR Admin | Supervisor | Employee | Budget Officer | Approving Official | Payroll Preparer | Leave Admin | Auditor |
| ----------------------------------- | -------: | ---------: | -------: | -------------: | -----------------: | ---------------: | ----------: | ------: |
| `overtime.authorities.read`         |        A |          S |        — |              A |                  A |                — |           — |       R |
| `overtime.authorities.create`       |        A |          S |        — |              — |                  — |                — |           — |       — |
| `overtime.authorities.submit`       |        A |          S |        — |              — |                  — |                — |           — |       — |
| `overtime.authorities.review`       |        A |          — |        — |              A |                  — |                — |           — |       R |
| `overtime.authorities.approve`      |        C |          — |        — |              C |                  A |                — |           — |       — |
| `overtime.authorities.reject`       |        C |          — |        — |              C |                  A |                — |           — |       — |
| `overtime.authorities.cancel`       |        A |          S |        — |              — |                  A |                — |           — |       — |
| `overtime.service.record`           |        C |          S |        O |              — |                  — |                — |           — |       — |
| `overtime.service.submit`           |        C |          S |        O |              — |                  — |                — |           — |       — |
| `overtime.service.certify`          |        C |          S |        — |              — |                  C |                — |           — |       — |
| `overtime.service.reject`           |        C |          S |        — |              — |                  C |                — |           — |       — |
| `overtime.coc_certificates.prepare` |        A |          — |        — |              — |                  — |                — |           — |       — |
| `overtime.coc_certificates.approve` |        C |          — |        — |              — |                  A |                — |           — |       — |
| `overtime.coc.read`                 |        A |          S |        O |              — |                  R |                R |           A |       R |
| `overtime.coc.adjust`               |        A |          — |        — |              — |                  C |                — |           A |       — |
| `overtime.coc.reverse`              |        A |          — |        — |              — |                  C |                — |           A |       — |
| `overtime.cto.create`               |        C |          — |        O |              — |                  — |                — |           A |       — |
| `overtime.cto.submit`               |        C |          — |        O |              — |                  — |                — |           A |       — |
| `overtime.cto.withdraw`             |        — |          — |        O |              — |                  — |                — |           — |       — |
| `overtime.cto.recommend`            |        C |          S |        — |              — |                  — |                — |           — |       — |
| `overtime.cto.return`               |        C |          S |        — |              — |                  A |                — |           — |       — |
| `overtime.cto.approve`              |        C |          — |        — |              — |                  A |                — |           — |       — |
| `overtime.cto.reject`               |        C |          — |        — |              — |                  A |                — |           — |       — |
| `overtime.cto.cancel`               |        C |          — |        — |              — |                  A |                — |           — |       — |

---

## 6.10 Payroll

| Permission                         | Payroll Preparer | HR Certifier | Budget Officer | Accounting Reviewer | Payroll Approver | Cashier | HR Admin | Auditor |
| ---------------------------------- | ---------------: | -----------: | -------------: | ------------------: | ---------------: | ------: | -------: | ------: |
| `payroll.periods.read`             |                A |            A |              A |                   A |                A |       R |        C |       R |
| `payroll.periods.create`           |                A |            — |              — |                   — |                — |       — |        — |       — |
| `payroll.periods.calculate`        |                A |            — |              — |                   — |                — |       — |        — |       — |
| `payroll.periods.return`           |                C |            A |              C |                   A |                A |       — |        — |       — |
| `payroll.periods.certify`          |                — |            A |              — |                   — |                — |       — |        — |       — |
| `payroll.periods.approve`          |                — |            — |              — |                   C |                A |       — |        — |       — |
| `payroll.periods.finalize`         |                — |            — |              — |                   — |                A |       — |        — |       — |
| `payroll.periods.void`             |                — |            — |              — |                   C |                A |       — |        — |       — |
| `payroll.inputs.read`              |                A |            A |              R |                   A |                A |       — |        C |       R |
| `payroll.inputs.adjust`            |                A |            C |              — |                   C |                C |       — |        — |       — |
| `payroll.compensation.read`        |                A |            A |              C |                   A |                A |       R |        C |       R |
| `payroll.compensation.manage`      |                C |            C |              — |                   — |                — |       — |        A |       — |
| `payroll.deductions.manage`        |                A |            C |              — |                   C |                — |       — |        C |       — |
| `payroll.payslips.read`            |                A |            C |              — |                   R |                A |       R |        C |       R |
| `payroll.payslips.release`         |                — |            — |              — |                   — |                A |       — |        — |       — |
| `payroll.registers.generate`       |                A |            A |              A |                   A |                A |       A |        C |       R |
| `payroll.payment_exports.generate` |                C |            — |              — |                   A |                A |       A |        — |       R |
| `payroll.disbursement.update`      |                — |            — |              — |                   C |                C |       A |        — |       R |
| `payroll.audit.read`               |                R |            R |              R |                   R |                R |       R |        R |       A |

Recommended separation:

```text
Payroll Preparer ≠ Payroll Approver
```

and, where staffing permits:

```text
Payroll Approver ≠ Cashier / Disbursing Officer
```

---

## 6.11 Performance Management

| Permission                           | Performance Officer | HR Admin | Supervisor | Employee | Performance Approver | Auditor |
| ------------------------------------ | ------------------: | -------: | ---------: | -------: | -------------------: | ------: |
| `performance.cycles.read`            |                   A |        A |          R |        R |                    R |       R |
| `performance.cycles.create`          |                   A |        C |          — |        — |                    — |       — |
| `performance.cycles.activate`        |                   A |        C |          — |        — |                    — |       — |
| `performance.cycles.finalize`        |                   C |        C |          — |        — |                    A |       — |
| `performance.commitments.create`     |                   C |        C |          S |        O |                    — |       — |
| `performance.commitments.submit`     |                   C |        C |          S |        O |                    — |       — |
| `performance.commitments.approve`    |                   C |        C |          S |        — |                    — |       — |
| `performance.accomplishments.update` |                   C |        C |          S |        O |                    — |       — |
| `performance.ratings.evaluate`       |                   C |        C |          S |        — |                    — |       — |
| `performance.ratings.calibrate`      |                   A |        C |          C |        — |                    C |       R |
| `performance.ratings.approve`        |                   C |        C |          — |        — |                    A |       — |
| `performance.ratings.read`           |                   A |        A |          S |        O |                    A |       R |
| `performance.reports.read`           |                   A |        A |          S |      O/C |                    A |       R |

Supervisors may not finalize their own rating unless the agency's approved hierarchy explicitly permits and records a higher-level review.

---

## 6.12 Separation and Clearance

| Permission                          | Personnel Officer | HR Admin | Supervisor | Employee | Appointing Authority | Clearing Officer | Security Admin | Auditor |
| ----------------------------------- | ----------------: | -------: | ---------: | -------: | -------------------: | ---------------: | -------------: | ------: |
| `personnel.separations.create`      |                 A |        A |          C |        O |                    — |                — |              — |       — |
| `personnel.separations.submit`      |                 A |        A |          C |        O |                    — |                — |              — |       — |
| `personnel.separations.review`      |                 C |        A |          C |        — |                    R |                — |              — |       R |
| `personnel.separations.approve`     |                 — |        C |          — |        — |                    A |                — |              — |       — |
| `personnel.separations.effectuate`  |                 A |        A |          — |        — |                    C |                — |              — |       — |
| `personnel.clearance.start`         |                 A |        C |          — |        — |                    — |                — |              — |       — |
| `personnel.clearance.review`        |                 C |        C |          C |        — |                    — |                A |              — |       R |
| `personnel.clearance.clear`         |                 C |        C |          C |        — |                    — |                A |              — |       — |
| `personnel.clearance.waive`         |                 — |        C |          — |        — |                    A |                C |              — |       — |
| `security.sessions.revoke`          |                 — |        — |          — |        O |                    — |                — |              A |       — |
| `security.users.deactivate`         |                 C |        C |          — |        — |                    — |                — |              A |       — |
| `personnel.service_record.generate` |                 A |        A |          — |        — |                    — |                C |              — |       R |

---

## 6.13 Documents, Records, Audit, Privacy, and AI

| Permission                  | Records Officer | DPO | Internal Auditor | Agency Admin | HR Admin | AI Admin | Employee |
| --------------------------- | --------------: | --: | ---------------: | -----------: | -------: | -------: | -------: |
| `documents.records.read`    |               A |   R |                R |            C |        C |        — |        O |
| `documents.records.create`  |               A |   — |                — |            C |        C |        — |      O/C |
| `documents.records.approve` |               A |   — |                — |            C |        C |        — |        — |
| `documents.records.issue`   |               A |   — |                — |            C |        C |        — |        — |
| `documents.records.archive` |               A |   C |                — |            — |        — |        — |        — |
| `documents.records.void`    |               A |   C |                R |            C |        C |        — |        — |
| `records.retention.manage`  |               A |   A |                R |            C |        C |        — |        — |
| `audit.events.read`         |               R |   A |                A |            A |        C |        — |        — |
| `audit.exports.create`      |               C |   C |                A |            C |        C |        — |        — |
| `privacy.requests.manage`   |               C |   A |                R |            C |        C |        — |        O |
| `privacy.incidents.manage`  |               C |   A |                R |            A |        C |        — |        — |
| `ai.features.configure`     |               — |   C |                R |            C |        — |        A |        — |
| `ai.features.use`           |               C |   C |                — |            C |        C |        C |      O/C |
| `ai.audit.read`             |               R |   A |                A |            A |        C |        A |      O/C |

---

# 7. Segregation-of-Duties Rules

## 7.1 Mandatory baseline checks

The system shall prevent or warn against these combinations for the same transaction:

1. The payroll preparer must not be the sole payroll approver.
2. A user must not approve their own leave application.
3. A user must not approve their own overtime or CTO request.
4. A selection-board member must not act on a record where a declared conflict exists.
5. The appointing authority action must not be simulated by a preparer.
6. A user must not approve their own elevated role assignment.
7. An attendance subject, initiator, recorder, factual approver, or effect applier must not supply another required approval or lock for the same transaction.
8. A user must not waive their own clearance accountability.
9. An employee must not finalize their own performance rating without required supervisor or higher-level review.
10. AI output must not be treated as a human approval.

## 7.2 Configurable high-risk combinations

The agency should review assignments where one person holds:

- Agency Administrator and Security Administrator;
- Payroll Preparer and Accounting Reviewer;
- Payroll Approver and Cashier;
- Recruitment Officer and Appointing Authority;
- Plantilla Officer and sole Budget Approver;
- Records Officer and unrestricted document-deletion authority;
- DPO and operational HR editing roles;
- Auditor and operational write roles.

---

# 8. Record-Scope Rules

Permissions must be combined with record scope.

## 8.1 Employee

May generally access:

- own PDS;
- own DTR;
- own leave balances and applications;
- own COC balance and CTO requests;
- own payslips;
- own performance commitments and ratings;
- own documents explicitly released for self-service.

## 8.2 Supervisor

May generally access:

- direct reports;
- delegated team members;
- assigned office records;
- approval tasks routed to the supervisor.

Supervisor access does not automatically include:

- full PDS sensitive fields;
- bank details;
- government identifier values;
- unrestricted payroll;
- medical records;
- SALN content;
- confidential recruitment deliberations outside assigned vacancies.

## 8.3 HR users

Broad HR access must still exclude permissions not necessary for the assigned function.

Examples:

- Recruitment Officer does not automatically receive payroll access.
- HR Officer Attendance access does not automatically include full PDS access.
- Leave Administrator does not automatically receive appointment-signing authority.
- Personnel Records Officer does not automatically receive role-management access.

## 8.4 Auditor

Auditor access is normally:

- read-only;
- time-bound where appropriate;
- logged;
- limited to the audit scope;
- prohibited from altering operational records.

---

# 9. Override Controls

An override must capture:

```text
override_type
entity_type
entity_id
original_value
replacement_value
reason
supporting_document_id
requested_by
approved_by
approved_at
effective_date
request_id
```

Overrides requiring additional approval include:

- position occupancy conflict resolution;
- appointment-data correction after issuance;
- leave-credit adjustment;
- locked attendance adjustment;
- COC adjustment;
- payroll-line override;
- finalized payroll void;
- performance-rating amendment;
- clearance waiver;
- Agency Membership reactivation after Agency Membership Suspension.

---

# 10. Audit Event Requirements

Every material transition shall record:

```text
id
agency_id
actor_user_id
actor_membership_id
action
entity_type
entity_id
previous_status
new_status
before_data
after_data
reason
approval_request_id
request_id
ip_address
user_agent
occurred_at
```

The audit record shall not contain:

- passwords;
- session tokens;
- password-reset tokens;
- MFA secrets;
- raw API secrets;
- unnecessary copies of sensitive PDS data.

---

# 11. Implementation Rules for the Future ERD

The logical data model should support:

1. status as a constrained value, not unrestricted text;
2. transition history separate from the current status;
3. effective-dated position and personnel records;
4. immutable ledger entries for leave, COC, and payroll;
5. generic approval requests with domain-specific validation;
6. role assignments separate from permissions;
7. record-scope assignments;
8. delegated authority with start and end dates;
9. conflict-of-interest declarations;
10. actor and agency context on all audit events;
11. source-document links for material actions;
12. versioned government forms and policy rules;
13. external submission tracking without assuming direct integration;
14. separation between an identity, agency membership, and employee record;
15. separate service segments for government-service history.

---

# 12. Acceptance Criteria

This control specification is ready for ERD design when:

- [ ] All major workflow entities have statuses.
- [ ] Every status has allowed inbound and outbound transitions.
- [ ] Invalid direct transitions are prohibited.
- [ ] Every material transition has an actor and permission.
- [ ] Approval actions require assigned approvers.
- [ ] Position occupancy cannot occur without a valid appointment or personnel action.
- [ ] Assumption to duty is separate from appointment issuance.
- [ ] Leave and COC balances use immutable ledger entries.
- [ ] Payroll finalization is separate from preparation and certification.
- [ ] Finalized payroll cannot return to Draft.
- [ ] Agency Membership deactivation revokes active sessions.
- [ ] Employee, supervisor, HR, payroll, audit, and privacy scopes are distinct.
- [ ] Sensitive fields require field-level authorization.
- [ ] AI cannot execute authoritative transitions directly.
- [ ] Every override requires reason and audit history.
- [ ] The role matrix supports agency-specific customization without weakening mandatory controls.

---

# 13. Recommended Next Artifact

After approval of this document, create:

```text
docs/data-model/public-sector-hris-conceptual-erd.md
```

The conceptual ERD should cover:

- identity and agency;
- organization and plantilla;
- recruitment and selection;
- appointment and assumption;
- employee, PDS, and service history;
- attendance and leave;
- overtime, COC, and CTO;
- payroll;
- SPMS;
- separation;
- approvals, documents, audit, and AI.

The conceptual ERD should show major entities and cardinalities without defining every physical column.

---

# 14. Approval

| Role                          | Name | Decision | Date |
| ----------------------------- | ---- | -------- | ---- |
| Product Owner                 |      | Pending  |      |
| Government HR / HRMO Reviewer |      | Pending  |      |
| Payroll / Accounting Reviewer |      | Pending  |      |
| Technical Owner               |      | Pending  |      |
| Security / Privacy Reviewer   |      | Pending  |      |

---

# 15. Change Log

| Version | Date           | Description                                                                            |
| ------- | -------------- | -------------------------------------------------------------------------------------- |
| 1.0     | August 5, 2026 | Initial public-sector HRIS status transition and role-permission control specification |
