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

## Plantilla and Position Control

**Plantilla Position**:
A stable, agency-owned authorized position whose effective-dated attributes and occupancy may change without replacing its identity.
_Avoid_: Plantilla item, employee position, job record

**Item Number**:
The permanent agency-unique identifier assigned to a Plantilla Position. It is not reassigned after the position is abolished.
_Avoid_: Position identity, employee number

**Plantilla Position Version**:
An effective-dated description of a Plantilla Position, including its title, salary grade, Organization Unit, funding, employment category, applicable Qualification Standard, and lifecycle status.
_Avoid_: Position history, overwritten position record

**Qualification Standard**:
A stable, agency-owned specification of the minimum education, training, experience, eligibility, competency, license, and special requirements applicable to positions.
_Avoid_: Applicant assessment, position description

**Qualification Standard Version**:
An immutable, effective-dated, evidence-backed description of a Qualification Standard.
_Avoid_: Editable qualification standard, overwritten requirements

**Position Incumbency**:
The effective-dated relationship between one Employee and one Plantilla Position.
_Avoid_: Plantilla Position, employee position

**Staffing Authority**:
The evidence-backed authority under which a Plantilla Position is created, changed, frozen, or abolished.
_Avoid_: Position document, unverified authority reference

**Draft Staffing Authority**:
A proposed Staffing Authority whose identifying metadata has been recorded but whose required External Evidence has not yet been linked and validated.
_Avoid_: Active authority, verified authority

**Revoked Staffing Authority**:
A Staffing Authority whose revocation has been recorded with supporting evidence without deleting or rewriting the authority, its evidence, or its historical links. Its effect on current Plantilla Positions is determined only by an applicable Authoritative Business Rule.
_Avoid_: Deleted authority, automatically abolished position

**Recruitable Vacancy**:
A vacant, authorized Plantilla Position that satisfies every Authoritative Business Rule applicable to recruitment on the relevant date.
_Avoid_: Vacant status, open job, assumed vacancy

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

**HR Administrator**:
An agency-scoped role responsible for broad human-resource management without unrestricted system-administration or payroll authority. In Attendance, it inherits HR Officer access and additionally owns configuration, authorized inputs, recalculation, period administration, and locking.
_Avoid_: Agency Administrator, HRMO Administrator, Attendance Administrator

**HR Officer**:
An agency-scoped operational HR role that inherits Employee access and may review, return, and approve attendance records within assigned scope. Attendance settings and period locking remain HR Administrator responsibilities.
_Avoid_: Attendance Administrator, HR Certifying Officer

**Invitation Role Assignment**:
A role assignment requested for a prospective Agency Membership that becomes effective only when the invitation is accepted.
_Avoid_: Post-activation role assignment, active invited role

**Invitation Activation**:
The single step in which an invited person, proving control of the invited email by holding the invitation link, sets or proves their credentials and gains the Agency Membership; nothing persists until every step completes.
_Avoid_: Sign-up, registration, account creation

**Agency Membership**:
A User's access to one Agency, carrying that Agency's roles and status; one User may hold several, and credentials belong to the User, never to a membership.
_Avoid_: Account, tenant user, admin

**Agency Context**:
The trusted Agency Membership boundary under which a user's permissions and record access are evaluated for a session or request.
_Avoid_: Client-supplied agency ID, tenant selector value

**Cross-Agency Isolation**:
The enforced boundary that prevents one Agency Context from reading, changing, or relating records owned by another Agency.
_Avoid_: UI filtering, Agency preference

**Agency Membership Suspension**:
An agency-scoped denial of access through one Agency Membership that leaves the User's identity and other Agency Memberships unchanged.
_Avoid_: User lock, global account suspension

**Global User Lock**:
An identity-wide security restriction, placed and lifted only by a Security Administrator, that denies every Agency Membership and invalidates all application sessions for the User.
_Avoid_: Agency suspension, role removal, automatic lockout

**Sign-in Cool-down**:
A temporary, self-expiring refusal of sign-in attempts for one submitted email after repeated failures, growing longer with each repeat; it never changes account status and behaves the same whether or not the email belongs to a User.
_Avoid_: Lockout, lockdown, account lock

**Credential Proof**:
One attempt to prove a User's password, TOTP code, or Recovery Code during sign-in, reauthentication, Invitation Activation, or Password Reset. A wrong guess counts toward the Sign-in Cool-down whichever of these asked for it.
_Avoid_: Login check, factor verification

**Second-factor Ceiling**:
Ten consecutive wrong TOTP codes or Recovery Codes since the User last proved both factors, after which their password stops working until a Password Reset. Wrong codes entered during a Password Reset do not count toward it.
_Avoid_: Lockout, account lock, MFA lock

**MFA-Required User**:
A user whose effective access through any agency membership meets a mandatory MFA risk trigger or a stricter agency policy; MFA applies to the user's whole identity.
_Avoid_: Privileged user, MFA role

**Recovery Code**:
A single-use code, issued in a set at TOTP enrollment, that substitutes for the User's TOTP code when the authenticator device is unavailable.
_Avoid_: Backup code, bypass code

**Factor Reset**:
A Security Administrator's audited removal of a User's TOTP factor and Recovery Codes after identity verification, after which the User enrolls again.
_Avoid_: MFA bypass, admin password reset

**Password Reset**:
A User's self-service replacement of a forgotten password, proven by possession of their email address plus their TOTP factor or a Recovery Code when they have one; it revokes every session and never changes account or membership status.
_Avoid_: Password recovery, admin password reset, account unlock

**Reauthentication Window**:
The five minutes after a User last proved their sign-in factors during which a session may perform sensitive actions without being asked to prove them again.
_Avoid_: Step-up session, sudo mode

**Security Event**:
An append-only HRIS record of identity or access activity, including every sign-in attempt, that never stores passwords, codes, tokens, or a raw submitted email.
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
The appointing authority's recruitment-domain choice following the board process. A later Appointment return, invalidation, cancellation, or failure to assume does not reopen or replace it; any further recruitment proceeds through an explicitly authorized new or republished recruitment path.
_Avoid_: Board Recommendation, approval step

**MSP Rebaseline**:
An authorized, audited replacement of the Agency Merit Selection Plan Version bound to a Request to Fill before vacancy publication. After publication, a materially changed plan requires cancellation and republication rather than rebaseline.
_Avoid_: Policy edit, retroactive amendment

**Recruitment Approval Checkpoint**:
An administrative approval point whose Agency Merit Selection Plan Version references an applicable Approval Route Version; it is distinct from a Board Recommendation or Selection Decision.
_Avoid_: Selection stage, board approval

## Appointment Administration

**Appointment Workflow Status**:
The HRIS-controlled progress of an Appointment, limited to `DRAFT`, `FOR_REVIEW`, `FOR_SIGNATURE`, `ISSUED`, or `CANCELLED`. External submission and CSC action do not change this status.
_Avoid_: Employment Status, CSC status

**Employment Status**:
The official classification written on an Appointment, such as Permanent, Temporary, Coterminous, Fixed Term, Contractual, Substitute, or Provisional where applicable. It is separate from both Appointment Workflow Status and Nature of Appointment.
_Avoid_: Appointment status, workflow state

**Nature of Appointment**:
The official personnel movement or action written on an Appointment, such as Original, Promotion, Transfer, Reemployment, Reappointment, Reinstatement, Reclassification, or Demotion where applicable.
_Avoid_: Employment Status, workflow action

**External Appointment Action**:
An append-only, evidence-backed action received from the CSC or another competent external authority, such as approval, validation, disapproval, or invalidation. It never overwrites the issued Appointment or Selection Decision.
_Avoid_: Appointment Workflow Status, Employment Status

**Person Key**:
The opaque identity of the person named by a Selection Decision and carried by Appointment Versions. An Employee binds one Person Key from the Assumed Appointment Contract that activates service; within an Agency, at most one Employee binds a given Person Key, and Personnel movements verify the binding before effectuation.
_Avoid_: Applicant ID, Employee ID

**Issued Appointment Contract**:
The immutable Appointment Version, exact signed Document Version, issue date, appointing authority, appointee acknowledgment path, selected Application reference, and reserved Plantilla Position reference exposed by Appointment after lawful issuance. It does not establish actual service or occupancy.
_Avoid_: Draft appointment, assumed service

**Assumed Appointment Contract**:
The immutable Appointment-owned handoff containing the Issued Appointment Contract, oath evidence, exact Assumption to Duty Document Version, actual assumption date, certifying authority, and certification time. Personnel and Plantilla consume this contract idempotently to create service and occupancy.
_Avoid_: Issued Appointment Contract, active employee

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

**Attendance Applicability**:
The effective-dated determination that Appointed Personnel receives Attendance Days based on qualifying active service and an admitted personnel category. Approved leave or another authorized absence does not end applicability, while an Authoritative HR Record alone does not establish it.
_Avoid_: Employee attendance eligibility, universal personnel coverage

**Work Schedule**:
A reusable definition of when duty is expected, maintained independently from the Appointed Personnel assigned to it. It may describe daytime, overnight, flexible, shifting, or compressed duty without creating separate calculation systems for those patterns.
_Avoid_: Working schedule, employee timetable

**Work Schedule Version**:
An immutable, effective-dated and authority-bearing Work Schedule definition composed of Day Rules and its governing time zone. Only an active version may receive a new Schedule Assignment, and a later version does not rewrite prior Attendance Days.
_Avoid_: Current schedule settings, night-shift rule

**Schedule Assignment**:
The effective-dated binding of Appointed Personnel to one Work Schedule Version and one Work Arrangement Version. Historical Attendance Days retain the versions that governed their calculation.
_Avoid_: Employee schedule, current schedule pointer

**Work Arrangement Version**:
An immutable, effective-dated definition of the authorized place or operating mode of duty, its evidence, and its permitted Work Schedule types. It does not define expected duty intervals.
_Avoid_: Work Schedule, one-off official business

**Work Date**:
The local date on which an assigned duty interval begins in the governing Work Schedule Version's time zone. An overnight duty interval remains part of that Work Date after midnight.
_Avoid_: Event date, clock-in date

**Holiday Calendar Version**:
An immutable, effective-dated calendar used with a Schedule Assignment to classify each listed date exactly once, citing its issuance. Attendance calculation requires exactly one applicable version rather than silently selecting a current or default calendar.
_Avoid_: Current holiday list, hard-coded holidays

**Non-Working Holiday**:
A Holiday Calendar classification (regular holiday, special non-working day, local holiday, or whole-day work suspension) on which no duty is expected for that calendar date. Service rendered on it is recorded only as fact.
_Avoid_: Holiday effect, holiday effect rule, day off

**Day Rule**:
One weekday within a Work Schedule Version, defined as a rest day or as fixed or flexible duty with required minutes, zero or more unpaid breaks, and an Event Collection Window. Compressed, daytime, overnight, and shifting schedules combine the same Day Rules.
_Avoid_: Daily schedule override, night-shift rule

**Event Collection Window**:
The interval used only to associate an Attendance Event with one Work Date. It does not excuse tardiness, round a timestamp, or change worked minutes.
_Avoid_: Grace period, attendance tolerance

**Attendance Event**:
A raw record of an attendance action preserved as the input for attendance calculation and correction; it is distinct from a calculated Attendance Day or Daily Time Record.
_Avoid_: DTR entry, time-sheet entry

**Web Clock Attendance Event**:
An Attendance Event captured through the authenticated HRIS web clock by Appointed Personnel when the agency has enabled that source; it does not imply biometric, device, location, or geofence verification.
_Avoid_: AM/PM event, biometric clock entry, JO/COS clock-in

**DTR Slot**:
A familiar Daily Time Record presentation position such as AM In, AM Out, PM In, or PM Out, projected from semantic Attendance Events for an ordinary daytime schedule. It is not an Attendance Event type and does not govern overnight event sequencing.
_Avoid_: Raw event type, universal shift label

**Attendance Context**:
An immutable whole-Work-Date or timed record entered by an authorized HR Administrator for official business, official travel, training, or an approved non-leave absence. It carries its recorder and prior-authorization evidence, may cross midnight, and affects attendance without fabricating an Attendance Event or adding another approval workflow.
_Avoid_: Attendance Event, leave copy, attendance approval

**Attendance Coverage**:
The union of worked time, Attendance Context, and posted leave that covers expected duty without counting overlapping minutes twice. Conflicting Attendance Context or leave classifications require an Attendance Exception instead of an assumed precedence.
_Avoid_: Credited hours, summed attendance inputs

**Fully Covered Minute**:
A whole minute that counts as worked or covered only when a raw timed interval covers all of it; a partial minute at either end stays uncovered, so no Attendance Day Segment extends past its raw source. It is a LingkodHR calculation convention, not a national rule.
_Avoid_: Minute rounding, grace period, truncated time

**Attendance Day Segment**:
An immutable interval-level result belonging to one Attendance Day calculation version, carrying its expected-duty relation, coverage or deficit classification, holiday classification, and source references. Attendance Day totals are derived from non-overlapping segments.
_Avoid_: Raw event, editable calculation line

**Attendance Deficit**:
An expected-duty minute not covered by work, Attendance Context, or posted leave, classified once as tardiness, undertime, or absence. A completely uncovered Work Date is absence rather than simultaneous tardiness and undertime.
_Avoid_: Missing hours, duplicate deduction

**Attendance Correction**:
A routed, evidence-backed approval request to add, replace, or void an Attendance Event or Attendance Context while preserving the original record and recalculating the affected Attendance Day. A Leave-originated correction replaces or voids posted leave on a locked Work Date after an applied Leave Cancellation. Its subject, initiator, recorder, approvers, and applied effect remain distinct and traceable.
_Avoid_: Direct attendance edit, deleted clock entry

**Attendance Correction Effect**:
An immutable `ADD`, `REPLACE`, or `VOID` instruction created from an approved Attendance Correction and used as an input to later Attendance Day calculations. It preserves the correction, original target, replacement values, evidence, and approval lineage.
_Avoid_: Edited Attendance Event, deleted Attendance Context

**Attendance Correction Impact Preview**:
The before-and-after comparison of every Attendance Day and Attendance Period affected by a proposed Attendance Correction. Approval binds the previewed source versions, and any intervening input change requires a refreshed preview and approval.
_Avoid_: Estimated correction result, UI-only preview

**Attendance Exception**:
A recorded ambiguity or missing input that prevents an Attendance Day from being approved until resolved. LingkodHR preserves the available facts and never invents a timestamp or silently chooses between conflicting inputs.
_Avoid_: Attendance error, automatic correction

**Employee Attendance Submission**:
An Employee's request for HR review of their exact Attendance Day versions within one Attendance Period. HR approval binds those versions, while recalculation makes the submission stale; it remains distinct from an Attendance Correction and the agency-wide Attendance Period Version.
_Avoid_: Employee Attendance Period, payroll submission

**Attendance Period**:
An agency-scoped interval that groups Attendance Days for review, certification, DTR publication, and the attendance-to-payroll handoff. Its mutable working set is not itself a finalized attendance result.
_Avoid_: Locked Attendance Day, payroll period

**Attendance Period Version**:
An immutable snapshot that identifies the exact approved Attendance Day calculation version for every covered Employee and Work Date in an Attendance Period. A locked version is the authoritative source for finalized DTRs and attendance payroll inputs.
_Avoid_: Current attendance period, collection of mutable Attendance Days

**Attendance Period Lock**:
The certification action that makes an approved Attendance Period Version authoritative and atomically publishes its Finalized Daily Time Records and attendance payroll inputs. A locked version is never reopened or overwritten.
_Avoid_: Attendance Day lock, editable finalization flag

**Attendance Period Reconciliation**:
The proof before lock that the complete applicable population, approved Employee Attendance Submissions, exact current Attendance Day versions, DTR outputs, and Attendance Payroll Publication counts and minute totals agree without unresolved exceptions or corrections.
_Avoid_: Attendance spot check, payroll reconciliation

**Locked Attendance Adjustment**:
The post-lock application of an approved Attendance Correction through successor Attendance Day and Attendance Period Versions. It links the locked predecessor to corrected outputs and delta payroll inputs without reopening or overwriting published history.
_Avoid_: Reopened attendance period, edited payroll input

**Attendance Payroll Publication**:
An immutable, idempotent batch of non-monetary attendance facts emitted when an Attendance Period Version is locked. An adjustment publication links a locked successor to its predecessor and contains only changed facts.
_Avoid_: Payroll calculation, attendance deduction batch

**Attendance Payroll Fact**:
A source-identified quantity of exact minutes for one Employee, Work Date, and attendance classification in an Attendance Payroll Publication. It carries no rate, money, or payroll-treatment decision.
_Avoid_: Payroll line, attendance deduction

**Daily Time Record Preview**:
An explicitly unfinalized projection of the current approved Attendance Day versions in an Attendance Period.
_Avoid_: Finalized DTR, official DTR

**Finalized Daily Time Record**:
A Printable System View bound to one locked Attendance Period Version and its exact Attendance Day calculation versions. A successor lock creates a separately retained corrected DTR, and either artifact is an Exact Versioned Form only when a supported authoritative template version has been configured and evidenced.
_Avoid_: Live DTR, universal official DTR

**Unscheduled Service**:
Complete worked time recorded on a rest day or another date without expected duty. It creates no tardiness, undertime, or absence and does not by itself authorize overtime, COC, or compensation.
_Avoid_: Approved overtime, rest-day absence

## Leave Administration

**Leave Type**:
A stable, agency-scoped leave category whose Leave Policy Versions define its entitlement basis, calendar basis, account effect, applicability, and evidence requirements.
_Avoid_: Leave workflow, credit-based flag

**Leave Application**:
The stable agency-scoped case through which an Employee requests leave. Its submitted content, evidence, assessments, route binding, certifications, decisions, posting, and cancellation history are preserved through linked records rather than overwritten.
_Avoid_: Leave form, mutable leave request

**Leave Application Version**:
An immutable submitted or resubmitted statement of a Leave Application that binds its typed request facts, submission attestation, exact applicable form and supporting Document Versions, accepted Leave Eligibility Assessment, and Approval Route Version.
_Avoid_: Workflow version, current form data

**Leave Submission Attestation**:
The evidence that an Employee adopted one Leave Application Version as their request. It is either an authenticated self-submission or an exact signed Document Version recorded by an authorized administrator without impersonating the Employee.
_Avoid_: Submitter identity, administrator attestation

**Leave Policy Version**:
An immutable, effective-dated, agency-scoped bundle governing one Leave Type. It binds typed rule parameters, the applicable national rules, evidence-backed Agency configuration, authority references, and calculation inputs needed to reproduce an evaluation.
_Avoid_: Editable leave policy, runtime rule overlay, administrator formula

**Leave Account**:
A record for one Employee, credit-bearing Leave Type, and continuous agency-employment entitlement period whose posted balance is derived from its Leave Ledger Entries.
_Avoid_: Balance field, leave application

**Leave Ledger Entry**:
An immutable, source-linked posting that changes one Leave Account by a signed quantity on an effective date. Corrections use linked reversals or adjustments rather than editing an entry.
_Avoid_: Pending reservation, editable leave balance

**Leave Credit Commitment**:
A certified claim against a Leave Account for an unposted request. It reduces currently available credits without changing the posted ledger balance and is consumed by posting or released when its certified basis no longer authorizes the claim; an authorized partial approval may replace it only with a linked, smaller successor.
_Avoid_: Pending ledger entry, posted deduction, submitted request hold

**Mandatory Leave Assessment**:
An explainable, as-of evaluation of whether an Employee is subject to a mandatory or forced leave obligation in a calendar year under an applicable Leave Policy Version, and how much of it has been fulfilled. Vacation leave taken in that year through ordinary Leave Applications fulfills the obligation, rather than a separate leave balance or workflow. An assessment reports the obligation; it does not forfeit unused days.
_Avoid_: Mandatory leave account, mandatory leave application, forfeiture assessment

**Leave Calculation Segment**:
An immutable portion of a Leave Application Version calculated under one combination of Leave Policy Version, schedule, holiday calendar, and source-prescribed unit.
_Avoid_: Requested days field, editable calculation line

**Leave Eligibility Assessment**:
An explainable evaluation that records an `ELIGIBLE`, `INELIGIBLE`, or `INDETERMINATE` result together with the applicable rules, input facts, missing facts, and Leave Calculation Segments.
_Avoid_: Eligibility flag, approval decision

**Leave Credit Certification**:
A permanently historical HR attestation of the posted balances, active Leave Credit Commitments, current application quantities, and resulting available credits for the affected Leave Accounts using a stated effective date and ledger knowledge cutoff. Its current authority is derived from the continued validity of the application version, assessment, commitment, and accounts it binds.
_Avoid_: Current balance, eligibility assessment

**Leave Recommendation**:
An immutable Supervisor opinion on the operational acceptability of one Leave Application Version. It informs but does not replace the authorized approving official's decision.
_Avoid_: Leave approval, supervisor veto

**Leave Approval Allocation**:
The authorized approving official's immutable allocation of one Leave Application Version across exact approved periods and their policy-permitted charged, paid, or unpaid quantities. It may narrow the request but cannot add dates, increase quantity, or rewrite the Employee's submitted facts.
_Avoid_: Edited application, implicit leave-without-pay conversion

**Leave Posting**:
The atomic Leave-owned act that consumes each applicable certified Leave Credit Commitment and creates every required source-linked ledger, Attendance, and Payroll handoff for one approved Leave Application Version.
_Avoid_: Approval, ledger-only posting, asynchronous partial posting

**Leave Withdrawal**:
An Employee's evidenced decision to end a submitted Leave Application before authorized approval. It cancels unfinished route work and releases any active Leave Credit Commitment without reversing an approval or posted effect.
_Avoid_: Leave Cancellation, administrator cancellation

**Leave Cancellation**:
The authorized record that ends all or an exact subset of an approved or posted Leave Application while preserving its original application, certification, recommendation, approval, commitment, and posting history. Its scope names exact cancelled dates within each affected allocation line.
_Avoid_: Leave Withdrawal, deleting leave, editing posted leave

**Leave Monetization Request**:
The stable agency-scoped case through which an Employee asks to convert authorized vacation or sick leave credits to money. Its submitted versions, account allocations, evidence, reviews, approval, posting, and adjustment history remain linked and immutable.
_Avoid_: Payroll earning, mutable monetization form

**Leave Monetization Request Version**:
An immutable submitted or resubmitted statement of a Leave Monetization Request that binds its requested account allocations, attestation, evidence, applicable policy and authority, and Approval Route Version.
_Avoid_: Editable monetization request, approved amount

**Monetization Eligibility Assessment**:
An explainable evaluation of one Leave Monetization Request Version against its applicable personnel coverage, credit, retention, quantity, reason, and authority rules.
_Avoid_: Approval, funding review, balance check

**Monetization Funding Determination**:
An immutable Budget review of whether one Leave Monetization Request Version has current funding support under exact authority and evidence.
_Avoid_: Monetization approval, available-funds flag

**Monetization Posting**:
The atomic Leave-owned act that consumes the request's Leave Credit Commitments, creates its source-owned negative Leave Ledger Entries, and obtains an authority-bound Monetization Earning Input from Payroll.
_Avoid_: Monetization approval, direct payroll edit

**Monetization Earning Input**:
An immutable Payroll-owned input that freezes Payroll's authority-bound salary resolution and monetary calculation for one accepted Monetization Posting.
_Avoid_: Caller-supplied payout, leave ledger entry

**Monetization Adjustment**:
An authorized whole or partial correction of a Monetization Posting that preserves the original approval and effects while linking exact ledger reversals or replacements to Payroll's accepted correction handoff.
_Avoid_: Edited monetization, immediate credit restoration

**Separation Leave Credit Disposition**:
An immutable, evidence-backed Separation-owned record of whether an Employee's accumulated leave credits receive `TERMINAL_LEAVE` treatment, transfer to another agency, are not applicable to either treatment, or remain unresolved when the Separation takes effect.
_Avoid_: Terminal benefit eligibility, Leave input readiness, separation-type assumption

**Terminal Leave Input Assessment**:
An immutable Leave evaluation that records whether the source facts required to preserve terminal-leave inputs are `READY` or `INDETERMINATE`, including every missing or conflicting fact.
_Avoid_: Terminal benefit eligibility, terminal payment approval

**Terminal Leave Input Snapshot**:
An immutable Leave-owned preservation of the exact separation, service, account-balance, ledger-cutoff, authority, evidence, and salary-source references needed for a later terminal-leave claim and calculation.
_Avoid_: Terminal leave computation, Payroll Input, leave ledger posting

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
