# Philippine Public-Sector HRIS

This glossary defines the canonical domain language for planning and building the Philippine public-sector HRIS.

## Agency Profiles

**Reference Agency Profile**:
A generic civilian National Government Agency configuration used to define and validate MVP capabilities before a specific participating agency is identified. It is not a source of authority for agency-specific procedures.
_Avoid_: Generic pilot agency, hypothetical pilot agency

**Pilot Agency**:
An identified agency participating in a controlled rollout, whose official documents and authorized representatives can supply agency-specific requirements.
_Avoid_: Reference agency, generic agency

## Agency Organization

**Organization Unit**:
A stable, agency-owned node in the formal organization structure whose name, parent relationship, and effectivity may change over time without replacing its identity.
_Avoid_: Department-only record, office label

**Draft Organization Unit**:
A proposed Organization Unit that has been recorded but is not yet active or available for operational assignment.
_Avoid_: Active office, completed organization change

## Decision Authority

**Authoritative Business Rule**:
A regulated or agency-specific requirement supported by an applicable official source or a documented answer from an authorized agency representative.
_Avoid_: Product assumption, inferred government rule

**Project Decision**:
A product or technology choice approved within the agreed architecture that does not redefine regulated business behavior.
_Avoid_: Agency policy, statutory rule

**Evidence-Backed Decision**:
A project decision whose permissible outcomes are constrained by applicable Authoritative Business Rules.
_Avoid_: Product preference, unsupported interpretation

**Configuration-Boundary Decision**:
A project decision that defines what agency-specific variation the product can represent while deferring the actual values to an identified Pilot Agency.
_Avoid_: Agency policy decision, generic agency default

**Mixed-Authority Decision**:
A project scope choice made only after the applicable Authoritative Business Rules establish its legal or regulatory boundary.
_Avoid_: Unconstrained product decision

**Configurable Placeholder**:
An explicitly non-authoritative configuration point used when a required official or agency-specific answer is unavailable.
_Avoid_: Default policy, assumed rule

## Government Outputs

**Exact Versioned Form**:
A nationally prescribed form reproduced in its applicable published layout and revision, with each issued copy permanently tied to that revision.
_Avoid_: Printable report, agency template

**Printable System View**:
A human-readable rendering of HRIS records whose layout is not represented as a nationally prescribed or agency-approved form.
_Avoid_: Official form, prescribed template

**Structured Export**:
Machine-readable HRIS data prepared for review and use outside the system without implying direct filing or conformance to an unverified receiving-system schema.
_Avoid_: Portal integration, official submission format

**Certified Payroll Review Export**:
A Structured Export derived from one immutable certified payroll snapshot for budget and accounting review before payroll approval. It does not assert external fund validation, obligation, or accounting posting.
_Avoid_: Budget-system export, validated payroll

**Finalized Payroll Accounting Support Export**:
A Structured Export derived from one immutable finalized payroll result for downstream accounting support. It does not represent a journal entry or evidence that an external system posted the payroll.
_Avoid_: Journal export, posted payroll

**Employee Detail Companion**:
A separately permissioned Structured Export artifact containing employee-level payroll detail linked to a Certified Payroll Review Export or Finalized Payroll Accounting Support Export.
_Avoid_: Default export detail, payroll register

**Classified Payroll Export Line**:
An aggregate payroll amount grouped by the HRIS-owned or evidence-backed funding, organization, cost-center, payroll-component, component-kind, and reporting-category references applicable to it. It is not a journal line or an assertion about an external financial classification.
_Avoid_: Journal line, accounting entry

**Payroll Effect**:
The direction in which a nonnegative payroll amount adds to, subtracts from, or has no effect on employee net pay. It is a payroll calculation meaning, not an accounting debit or credit.
_Avoid_: Debit, credit, signed amount

**Payroll Export Checkpoint Review**:
An immutable Budget or Accounting review outcome recorded against one Certified Payroll Review Export. It confirms or returns that exact snapshot without asserting external posting or changing payroll calculations.
_Avoid_: Payroll approval, accounting posting

**Payroll Export Reconciliation**:
The proof that every source payroll line maps exactly once and that required counts, monetary identities, classifications, and companion-detail totals agree before a payroll Structured Export is generated.
_Avoid_: Visual spot check, external accounting reconciliation

**Payroll Export Contract Version**:
An immutable definition of one payroll Structured Export's fields, meanings, formats, and control rules. A semantic or structural change creates a successor version without rewriting or invalidating historical artifacts.
_Avoid_: File revision, receiving-system version

**Payroll Export External Outcome**:
An append-only evidence event recording a handoff or an externally evidenced receipt, return, or posting for a payroll Structured Export. It does not mutate the export or treat download as an external result.
_Avoid_: Export status, inferred posting

**External Evidence**:
A document authored outside the HRIS and retained or linked as support for an HRIS record rather than generated by the system.
_Avoid_: Generated form, system record

## Records Management

**HRIS Public Record**:
A persisted record created, received, or retained through the HRIS in the conduct of agency affairs, including structured records, managed documents, logs, imports, and generated outputs. Its record series and copy designation determine the applicable retention and disposition controls.
_Avoid_: Document-only record, disposable system data

**Applicable Retention Rule Set**:
Every authoritative retention and disposition rule that applies to an HRIS Public Record, preserved with its source and applicability. All applicable rules must be satisfied, and unresolved conflicts block disposition.
_Avoid_: Agency override, shortest retention period

**Retention Policy Version**:
An immutable, effective-dated set of authoritative retention and disposition rules with recorded source, approval evidence, scope, trigger, period, action, and source-defined applicability. A change creates a successor version and never rewrites the policy history applied to existing records.
_Avoid_: Editable retention settings, retroactive policy assumption

**Reference Retention Baseline**:
The source-backed national retention rules available to the Reference Agency Profile for planning, validation, and provisional eligibility evaluation. It cannot authorize real disposition until an identified Pilot Agency activates its National Archives-approved Agency Records Disposition Schedule with evidence.
_Avoid_: Default agency schedule, disposal authority

**Agency Retention Addition**:
An effective-dated retention rule supported by a lawful purpose, authoritative agency instrument, and approval evidence. If it changes the Agency Records Disposition Schedule, it is not active until the required National Archives approval is evidenced.
_Avoid_: Ordinary configuration, indefinite retention preference

**Record Classification Version**:
An immutable assignment of an HRIS Public Record to its record series and copy designation before it becomes authoritative. A correction creates a reasoned, evidence-backed successor and recalculates disposition eligibility.
_Avoid_: File category, overwritten classification

**Disposition Eligibility**:
The condition reached after every rule in the Applicable Retention Rule Set has been satisfied. It permits Records Officer review but is not approval or authority to dispose.
_Avoid_: Automatic deletion date, disposal approval

**Disposition Blocker**:
Any missing, unresolved, or ambiguous classification, trigger, policy, approval, authority, or hold condition that requires continued retention. It cannot be bypassed by administrative privilege, artificial intelligence, or a generic data tool.
_Avoid_: Warning-only validation, emergency delete override

**Records Hold**:
An evidence-backed suspension of disposition for explicitly selected records or bounded criteria that capture matching records. It preserves its authority, reason, responsible officer, effective period, scope, membership, and release evidence without pausing the retention clock.
_Avoid_: Retention extension, informal do-not-delete flag

**Disposition Request**:
An immutable manifest of eligible records grouped by record series, covered period, and proposed disposition action for review and authorization. Changing its membership after approval begins requires a replacement request.
_Avoid_: Delete batch, mutable disposal list

**Disposition Authority**:
Written authority from the National Archives of the Philippines matched to the records and actions in a Disposition Request. It is distinct from retention expiry, internal agency approval, or technical ability to destroy a record.
_Avoid_: Eligibility, agency approval, delete permission

**Disposition Execution**:
The controlled completion of an authorized disposition action. The HRIS may execute it only for electronic records under its direct control; actions on physical or externally controlled records require recorded outcome evidence from the responsible officer.
_Avoid_: Approval, assumed external completion

**Disposition Outcome**:
The immutable item-level evidence of a Disposition Execution, including the governing request and authority, exact manifest, method, executor, timestamps, results, exceptions, certificates, and transfer receipt. It is itself an HRIS Public Record with a separate Record Classification Version.
_Avoid_: Completed flag, mutable execution log

**Inactive Record Storage**:
Continued agency custody of a non-current record pending its authorized final disposition. It is distinct from permanent archival status, archival custody transfer, and a technical storage tier.
_Avoid_: Archive, cold storage

**Archival Record**:
A record selected under an applicable records disposition schedule for permanent preservation because it has enduring value.
_Avoid_: Archived document, old record

**Archival Transfer**:
An authorized transfer of control or custody of public records to the National Archives of the Philippines, another government office, or an approved repository, completed only when acceptance evidence is recorded.
_Avoid_: Archive status, storage migration

## Identity and Access

**Agency Provisioning**:
A controlled setup process that creates an Agency and issues the single-use invitation through which its initial Agency Administrator establishes agency-scoped access.
_Avoid_: Agency self-registration, public agency signup

**Agency Administrator**:
An agency-scoped role responsible for Agency setup, user access, role assignment, and technical configuration.
_Avoid_: Platform administrator, HR administrator

**HRMO Administrator**:
An agency-scoped role responsible for broad human-resource management without unrestricted system-administration or payroll authority.
_Avoid_: Agency Administrator, HR administrator

**Invitation Role Assignment**:
A role assignment requested for a prospective Agency Membership that becomes effective only when the invitation is accepted.
_Avoid_: Post-activation role assignment, active invited role

**Agency Context**:
The trusted Agency Membership boundary under which a user's permissions and record access are evaluated for a session or request.
_Avoid_: Client-supplied agency ID, tenant selector value

**Cross-Agency Isolation**:
The enforced boundary that prevents one Agency Context from reading, changing, or relating records owned by another Agency.
_Avoid_: UI filtering, Agency preference

**External Identity Link**:
The durable association between an HRIS User and an identity-provider subject, identified by the exact issuer-and-subject pair. Email addresses and other mutable profile attributes cannot establish or silently replace this link.
_Avoid_: External user ID, email identity, automatic email match

**Agency Membership Suspension**:
An agency-scoped denial of access through one Agency Membership that leaves the User's identity and other Agency Memberships unchanged.
_Avoid_: User lock, global account suspension

**Global User Lock**:
An identity-wide security restriction that denies every Agency Membership and invalidates all application sessions for the User.
_Avoid_: Agency suspension, role removal

**MFA-Required User**:
A user whose effective access through any agency membership meets a mandatory MFA risk trigger or a stricter agency policy; MFA applies to the user's whole identity.
_Avoid_: Privileged user, MFA role

**Security Event**:
An append-only HRIS record of identity or access activity observed by the application or imported from the identity provider, retaining source correlation without credentials or tokens.
_Avoid_: Provider log copy, editable security status

## Merit Selection

**Agency Merit Selection Plan Version**:
An immutable, effective-dated configuration package representing one CSC-approved version of an agency's Merit Selection Plan within the fixed national selection structure. It becomes active only with recorded approval evidence and must be the sole applicable version for a Request to Fill.
_Avoid_: Recruitment workflow, editable selection policy

**Merit Selection Criteria Set**:
An ordered, typed collection of assessment criteria, weights, cutoffs, rating scales, evidence requirements, evaluator roles, and fixed aggregation rules owned by an Agency Merit Selection Plan Version. Its explicit applicability selectors must produce exactly one match for a vacancy.
_Avoid_: Scoring formula, editable scorecard

**Assessment Result Version**:
An immutable, evidence-backed result for one applicant, criterion, and evaluator under a Merit Selection Criteria Set; a correction creates a reasoned replacement version rather than overwriting the result.
_Avoid_: Editable score, score override

**Board Definition**:
A versioned specification of an HRMPSB or specialized selection board's required seats, permitted alternates, and quorum rule, separate from the people designated to serve.
_Avoid_: Board roster, board session

**Board Appointment**:
An effective-dated designation of an Agency Member as principal or alternate for a Board Definition seat, supported by the applicable Office Order or other authority.
_Avoid_: Board role, session attendee

**Board Member Participation**:
The immutable record of a Board Appointee's actual role, attendance, conflict declarations, and recusals in one Selection Board Session.
_Avoid_: Board Appointment, board membership

**Board Roster Snapshot**:
The immutable set of Board Appointments resolved for a Selection Board Session when deliberation begins; it records the actual seat filled without allowing one person to satisfy multiple voting seats or serve simultaneously as voting member and secretariat.
_Avoid_: Board Definition, current board roster

**Board Quorum**:
The minimum eligible voting participation required for a Selection Board Session or applicant-specific deliberation, never weaker than the applicable national floor.
_Avoid_: Attendance count, configured headcount

**Board Recommendation**:
The HRMPSB's recruitment-domain recommendation for an applicant; it is not an Approval Decision and does not select the appointee.
_Avoid_: Approval, selection

**Comprehensive Candidate Evaluation Report**:
The versioned board output that preserves comparative evaluation results, qualified candidates, and the identified top five under the bound Agency Merit Selection Plan Version; it remains advisory to the appointing authority.
_Avoid_: Selection Decision, ranking-only report

**Selection Decision**:
The appointing authority's recruitment-domain choice following the board process; it remains distinct from administrative approvals handled through Approval Routes.
_Avoid_: Board Recommendation, approval step

**MSP Rebaseline**:
An authorized, audited replacement of the Agency Merit Selection Plan Version bound to a Request to Fill before vacancy publication. After publication, a materially changed plan requires cancellation and republication rather than rebaseline.
_Avoid_: Policy edit, retroactive amendment

**Recruitment Approval Checkpoint**:
An administrative approval point whose Agency Merit Selection Plan Version references an applicable Approval Route Version; it is distinct from a Board Recommendation or Selection Decision.
_Avoid_: Selection stage, board approval

## Performance Management

**Agency SPMS Version**:
An immutable, effective-dated configuration package representing one CSC-approved version of an agency's SPMS within the fixed national performance cycle. It binds form structures, applicability, cycle rules, rating rules, sign-off routes, and approval evidence as one active version.
_Avoid_: Performance workflow, editable appraisal policy

**Rating Rule Set**:
A typed collection of rating scales, dimensions, weights, evidence requirements, bounded aggregation methods, rounding rules, and non-ratable outcomes owned by an Agency SPMS Version.
_Avoid_: Rating formula, editable scorecard

**Performance Sign-off Checkpoint**:
An administrative approval point whose Agency SPMS Version references an applicable Approval Route Version; performance reviews, ratings, calibration, and appeals remain performance-domain records.
_Avoid_: Rating result, generic performance workflow step

**Agency SPMS Form Template Version**:
An immutable rendering definition supported by an agency-approved SPMS form and bound to every performance record issued from it. The Reference Agency Profile has no active agency form template.
_Avoid_: Official generic OPCR, editable form layout

**Performance Rating Appeal**:
A formal challenge to a finalized individual performance rating routed to the configured Performance Management Team without reopening or overwriting the rating.
_Avoid_: Approval comment, rating correction

**Rating Amendment**:
A controlled, reasoned replacement of a finalized Performance Rating that preserves the original rating and its governing configuration.
_Avoid_: Rating edit, reopened rating

## Attendance

**Attendance Event**:
A raw record of an attendance action preserved as the input for attendance calculation and correction; it is distinct from a calculated Attendance Day or Daily Time Record.
_Avoid_: DTR entry, time-sheet entry

**Web Clock Attendance Event**:
An Attendance Event captured through the authenticated HRIS web clock by Appointed Personnel when the agency has enabled that source; it does not imply biometric, device, location, or geofence verification.
_Avoid_: AM/PM event, biometric clock entry, JO/COS clock-in

## Workforce Relationships

**JO/COS Worker**:
An individual who performs work for an agency under a Job Order or Contract of Service without becoming an Employee or Appointee of that agency.
_Avoid_: JO/COS employee, JO/COS personnel, contractual employee

**Service Engagement**:
The Job Order or Contract of Service arrangement governing a JO/COS Worker's work; it is not an Appointment, employment relationship, plantilla incumbency, or employee service segment.
_Avoid_: Appointment, employment, service segment

**Engagement Registry**:
The authoritative HRIS record of individual Service Engagements and their agreed terms and status; procurement, accounting, and Service Payment records remain authoritative in their respective systems.
_Avoid_: Personnel file, payroll register, payment ledger

**Service Payment**:
A payment arising from a Service Engagement under its distinct service-provider rules; it is not a Payroll Employee result, Payroll Line, or plantilla payroll payment.
_Avoid_: Salary, payroll result, payslip

## Personnel Support Tiers

**Appointed Personnel**:
A civilian NGA employee whose service arises from a government appointment, including personnel appointed to authorized plantilla items and appointed casual or contractual personnel. Career class, appointment status, and position or funding basis remain separate attributes.
_Avoid_: JO/COS Worker, contractor, plantilla-only employee

**Authoritative HR Record**:
A personnel record for which the HRIS is the system of record for category, appointment, service status, effective-dated history, supporting documents, and audit trail. It does not by itself imply support for every category-specific payroll, leave, or SPMS workflow.
_Avoid_: Fully supported employee, universal workflow support

**Excluded Personnel Category**:
A personnel category that the first release cannot create or process; imported occurrences are identified as unsupported.
_Avoid_: Record-only category, deferred workflow

## Payroll Rules

**Appointed Personnel Payroll Rule Set**:
The effective-dated rules used to calculate payroll for admitted Appointed Personnel, with pay-basis and eligibility variations rather than separate plantilla, casual, or contractual payroll systems.
_Avoid_: Plantilla payroll profile, casual payroll profile, contractual payroll profile

**National Payroll Rule Version**:
An immutable, effective-dated representation of an authoritative national salary, compensation, contribution, tax, or deduction rule. An agency may select an applicable version but cannot alter its substance.
_Avoid_: Agency default, editable national rate

**Agency Payroll Applicability**:
An effective-dated, evidence-backed fact that determines whether a National Payroll Rule Version or conditional pay component applies to an agency or member of its Appointed Personnel.
_Avoid_: Agency rule override, assumed entitlement

**Native Payroll Component**:
A lawful earning, contribution, tax, or deduction calculated by the Appointed Personnel Payroll Rule Set from authoritative inputs and an applicable National Payroll Rule Version.
_Avoid_: Hard-coded allowance, agency formula

**Authorized Payroll Component Input**:
An evidence-backed amount or quantity accepted for a lawful pay component when the Reference Agency Profile cannot authoritatively calculate it. It does not authorize a new component or override a national rule.
_Avoid_: Free-form pay item, manual rule override

**Payment Export**:
A provider-neutral, reviewable set of Payment Instructions derived from one finalized payroll result. It does not assert provider acceptance or that funds were disbursed.
_Avoid_: Bank file, disbursement confirmation

**Payment Instruction**:
The positive-net-pay direction for one Payroll Employee result to one designated disbursement destination within a Payment Export.
_Avoid_: Payroll line, split payment

**Disbursement Outcome**:
External evidence of a Payment Instruction's progress or result after handoff, distinct from payroll finalization and Payment Export generation.
_Avoid_: Payment Export status, paid flag
