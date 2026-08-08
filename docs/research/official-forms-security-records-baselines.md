# Official forms, reporting, security, and records baselines

**Research question:** Which current official Philippine sources constrain exact
government forms, mandatory reports or structured outputs, authentication security
controls including MFA, records retention or archival, and the national structural
requirements for Merit Selection Plans (MSPs) and Strategic Performance Management
Systems (SPMSs) in a civilian National Government Agency (NGA) HRIS?

**Reference profile:** Generic civilian NGA; no actual pilot agency has been selected.

**Checked:** 9 August 2026 (Asia/Manila).

## Executive findings

1. There is no single national "government HRIS export" specification. Current
   obligations are split among exact CSC forms, CSC reports and portal submissions,
   privacy reports, and NAP records-control artifacts. A product decision must classify
   each output separately rather than treating the BRD's report list as one mandatory
   national bundle.
2. The BRD's appointment and PDS references must use the **2025** revisions, not
   legacy 2017/2018 appointment or PDS forms. The controlling source is the
   [2025 ORAOHRA and annex catalog](https://csc.gov.ph/downloads/2025-oraohra).
3. The appointment form/report path depends on an agency fact that the generic
   profile does not have: whether the NGA is **regulated** or
   **accredited/deregulated**. Regulated agencies use CS Form No. 33-A and the ATAF;
   accredited/deregulated agencies use CS Form No. 33-B and the RAI path.
4. Current privacy rules do not say simply "MFA for every user" or "MFA only for
   administrators." NPC Circular 2023-06 requires secure authentication mechanisms,
   giving MFA or secure encrypted links as examples, for personnel's online access to
   sensitive personal information, privileged information, and high-volume personal
   data. The Circular is a minimum control framework, not a complete role-by-role MFA
   policy.
5. Records-retention numbers in the 2023 General Records Disposition Schedule
   (GRDS) are not automatic deletion dates. An agency must have an approved Agency
   Records Disposition Schedule (RDS), respect audit/case holds, and obtain written NAP
   authority before destroying public records.
6. MSP and SPMS have national structural floors, but their detailed assessment
   methods, scoring weights, calendars, forms, competency models, and internal routing
   are agency policies subject to CSC approval. The 2026 competency-based HRM
   guidelines add a current overlay: competency integration may require amendments to
   the agency MSP, SPMS, and PRAISE policy and submission to the CSC Regional Office.

## Authority legend

- **National minimum** — directly required or prescribed by a national authority for
  covered civilian NGAs.
- **Conditional national requirement** — required only when the stated status,
  transaction, threshold, or event applies.
- **Agency-specific** — must come from a CSC-approved agency plan, NAP-approved
  agency schedule, authorized agency policy, or another authorized agency answer.
- **Unresolved** — the reviewed current public sources do not establish an exact value
  or format; it must not be invented.

## 1. Prescribed forms and form-like outputs

### 1.1 Appointment, recruitment, and personnel forms

The [CSC 2025 ORAOHRA download page](https://csc.gov.ph/downloads/2025-oraohra)
is the current authoritative catalog for appointment-related forms. It publishes these
annexes:

| Artifact | Current published form | Authority and applicability |
|---|---|---|
| Position description | DBM-CSC Form No. 1, Revised 2017 | National form attached to appointments for authorized plantilla/lump-sum contractual positions under the 2025 ORAOHRA. |
| Oath of office | SS Porma Blg. 32, Revised 2025 | National form. |
| Appointment paper | CS Form No. 33-A, Revised 2025 | Conditional: regulated agencies. |
| Appointment paper | CS Form No. 33-B, Revised 2025 | Conditional: accredited/deregulated agencies. |
| Casual appointment plantilla | CS Form No. 34-A, Revised 2025 | Conditional: regulated agencies appointing casual personnel. |
| Casual appointment plantilla | CS Form No. 34-B, Revised 2025 | Conditional: accredited/deregulated agencies appointing casual personnel. |
| Medical certificate | CS Form No. 211, Revised 2025 | Conditional supporting document under ORAOHRA. |
| Personal Data Sheet | CS Form No. 212, Revised 2025 | National current PDS; the CSC's [forms catalog](https://csc.gov.ph/downloads/forms) also identifies the 2025 revision. |
| Work Experience Sheet | Attachment to CS Form No. 212, Revised 2025 | Conditional/current supporting form. |
| Appointment transmittal/action | CS Form No. 1, Revised 2025 (ATAF) | Conditional: regulated agency submission path. |
| Report on Appointments Issued | CS Form No. 2, Revised 2025 (RAI) | Conditional: accredited/deregulated path; it also serves as ATAF. |
| Erasures/alterations certification | CS Form No. 3, Revised 2025 | Conditional when the event applies. |
| Assumption to duty | CS Form No. 4, Revised 2025 | National prescribed certification. |
| No qualified eligible available | CS Form No. 5, Revised 2025 | Conditional when the ORAOHRA exception applies. |
| Clearance | CS Form No. 7, Revised 2018 | Current ORAOHRA annex. |
| DIBAR report | CS Form No. 8, Revised 2017 | Conditional on an executory dismissal decision. DIBAR means Database of Individuals Barred from Entering Government Service and Taking Civil Service Examinations. |
| Vacancy-publication request | CS Form No. 9, Revised 2025 | National prescribed request form for covered publication. |
| Acceptance of resignation | CS Form No. 10, Series 2017 | Conditional on resignation. |
| Electronic-signature certification | CS Form No. 11, Series 2025 | Conditional if an agency uses electronic signatures on appointments; PNPKI rules apply if it uses a DICT digital certificate. |
| Designations report | CS Form No. 12, Series 2025 | Conditional report of designation orders. |
| LGU appointment certification | CS Form No. 13, Series 2025 | Out of the civilian-NGA reference profile; do not inherit it into NGA behavior. |

The form revision is material. The 2025 ORAOHRA requires an updated PDS (CS Form
No. 212, Revised 2025) with WES for the appointment cases it specifies. It also permits
electronic or digital signatures subject to the prescribed certification or DICT PNPKI
requirements. See the [full 2025 ORAOHRA](https://www.csc.gov.ph/phocadownload/userupload/hrpso/2025-ORAOHRA/2025%20ORAOHRA.pdf),
Rules II and III.

**Agency facts still required:** regulated versus accredited/deregulated status;
whether casual appointments are supported; the appointing authority and delegated
signatories; whether appointment signatures use handwritten, electronic, or PNPKI
digital signatures; and which CSC Regional/Field Office receives the submission.

### 1.2 Leave, attendance, and SALN

- The CSC publishes **CS Form No. 6, Revised 2020 (Application for Leave)** and
  **CS Form No. 6a, s. 2020 (Notice of Allocation of Maternity Leave)** with the
  amended Omnibus Rules on Leave. These are the current forms on the
  [official leave issuance page](https://www.csc.gov.ph/downloads/category/298-mc-no-05-s-2021-amendment-to-omnibus-rules-on-leave-csc-mc-no-41-s-1998-as-amended).
- Daily attendance must be recorded. Civil Service Form No. 48 is the historically
  prescribed **Daily Time Record**; an official executive issuance identifies the form
  and requires monthly submission in its covered office
  ([Memorandum Order No. 745, s. 1982](https://lawphil.net/executive/mo/mo1982/mo_745_1982.html)).
  However, the current CSC public forms catalog reviewed on 9 August 2026 does not
  publish a current revision-controlled CS Form No. 48 template. Current CSC flexible
  work rules also require agencies to formulate their own monitoring mechanisms and
  internal guidelines ([CSC MC No. 6, s. 2022](https://www.csc.gov.ph/downloads/memorandum-circulars/category/311-mc-no-06-s-2022-policies-on-flexible-work-arrangements-in-the-government?download=2403%3Amc06s2022)).
  The exact DTR rendering and its treatment across work arrangements are therefore
  **unresolved for the generic profile** and require current CSC/agency confirmation.
- SALN is no longer governed by the 2015 form named in older material. The current
  [CSC SALN page](https://csc.gov.ph/downloads/category/224_osc-form-212-ravised-2017-personal-data-sheet)
  publishes the **2025 Omnibus Rules on SALN**, the 2025 SALN form updated
  3 February 2026, AS-1 and AS-2 additional sheets, the Summary List of Filers, the
  repository-agency annex, and a 2025 request form. An HRIS that tracks only filing
  compliance should not silently expand into storing or publishing SALN contents.

### 1.3 SPMS forms are templates, not one universal agency form

CSC Memorandum Circular No. 6, s. 2012 includes sample OPCR and IPCR forms,
success indicators, a sample calendar, a Summary List of Individual Performance
Ratings, and monitoring/development templates. The national rule allows an agency's
existing, revised, or new performance system if it conforms and is CSC-approved.
Therefore the OPCR/IPCR **structure and required evidence are nationally constrained**,
while exact field layout, success indicators, weights, office hierarchy, and calendar
dates are **agency-specific**. See the
[CSC SPMS program page and complete guidelines](https://csc.gov.ph/programs/spms).

### 1.4 No current universal exact template established in this review

The reviewed current national catalogs did not establish one current, universal exact
layout for each of the following BRD outputs:

- service record;
- leave credit card/ledger display;
- electronic DTR for every work arrangement;
- payslip;
- staffing/vacancy management report beyond prescribed CSC submissions;
- audit/access report; or
- a single OPCR/DPCR/IPCR layout used unchanged by every NGA.

These are valid records or business outputs, but their exact visual format must not be
represented as nationally prescribed without a controlling issuance. Payroll,
contribution, tax, bank, and accounting export schemas must also be reconciled with the
separate compensation/payroll evidence research and the actual agency's receiving
systems.

## 2. Mandatory reports and structured submissions

### 2.1 CSC appointment and personnel submissions

Under the [2025 ORAOHRA](https://www.csc.gov.ph/phocadownload/userupload/hrpso/2025-ORAOHRA/2025%20ORAOHRA.pdf):

- **Regulated agency:** submit the appointment (one original and two certified true
  copies) with supporting documents in the ATAF within **30 calendar days from
  issuance**.
- **Accredited/deregulated agency:** submit the RAI, certified true copy of appointments,
  and supporting documents **on or before the 30th day of the succeeding month**.
- The prescribed package includes an electronic file sent through official email or
  stored on the allowed media plus printed copies. Direct integration is not stated as a
  national requirement.
- The HRMO must submit the DIBAR report and a certified true copy of an executory
  dismissal decision within **30 calendar days** from the decision; other separation
  notices covered by Rule X have their own 30-day record-submission rule.
- HRMOs must submit the Report on Designations Issued, a summary list of employees'
  performance ratings, and other CSC-required reports within the prescribed periods.
- Agencies must submit their System of Ranking Positions to the CSC Regional/Field
  Office, and their Agency MSP and later amendments to the CSC Regional Office for
  approval.

This creates at least two distinct product-facing decisions: whether to render an exact
prescribed form and whether to prepare a reviewable submission package. The source does
not require an HRIS to transmit directly to CSC.

### 2.2 SPMS submissions and records

The [SPMS guidelines](https://csc.gov.ph/phocadownload/userupload/irmo/mc/2012/mc6s2012SPMSguide.pdf)
require or establish:

- a CSC-approved Agency SPMS and submission of enhancements/amendments;
- OPCRs and IPCRs prepared and approved before the rating period;
- quarterly office accomplishment reports to the Planning Office;
- an annual agency performance planning/review conference;
- a Summary List of Individual Performance Ratings with the underlying IPCRs to the
  HRM/Personnel Office; and
- a copy of consolidated individual performance review reports to the concerned CSC
  Regional/Field Office, showing alignment between collective individual and office
  performance ratings.

The actual agency calendar and forms remain agency policy within those constraints.

### 2.3 CSC inventory and portal inputs

The CSC operates the Inventory of Government Human Resources System (IGHRS) and
describes agency HRMO online submission of agency, individual, and plantilla data in
its official [IGHR background report](https://csc.gov.ph/phocadownload/userupload/irmo/ighr/2017/IGHR%20Career%20and%20Non-career%20as%20of%20Dec%2031%202017.pdf).
Current reports continue to be published in the
[official IGHR catalog](https://www.csc.gov.ph/downloads/statistics-and-reports/ighr).
The current public sources reviewed did not expose a stable machine-readable schema,
complete field dictionary, or submission cadence for a generic agency. Those details
must be obtained from current IGHRS access/instructions or an authorized agency HRMO.

### 2.4 Privacy reports and registrations

- NPC Circular 2022-04 requires DPO and data-processing-system registration when its
  criteria apply. The NPC's current FAQ expressly treats a **government agency or
  instrumentality** as mandatory registration because government processing will likely
  pose a risk to data-subject rights
  ([NPC registration FAQ](https://privacy.gov.ph/pips-and-pics/faqs/)).
- All PICs/PIPs must submit an **Annual Security Incident Report (ASIR)** through the
  DBNMS regardless of registration classification. The NPC's current public notice set
  the 2025 ASIR deadline at 31 March 2026 and rejected other submission modes
  ([NPC website notice](https://privacy.gov.ph/)). The recurring deadline should be
  treated as an externally versioned compliance date, not hard-coded permanently.
- A breach meeting the mandatory-notification conditions must be reported to the NPC
  and affected data subjects within **72 hours** from knowledge or reasonable belief,
  subject to the rules on postponement/exemption and available information. See the
  NPC's current [breach-reporting guidance](https://privacy.gov.ph/pips-and-pics/breach-reporting/)
  and [2026 DBNMS advisory](https://privacy.gov.ph/wp-content/uploads/2026/05/Advisory-Clarification-on-the-Submission-of-Personal-Data-Breach-Notification-through-DBNMS_11-May-2026.pdf).

### 2.5 Records-management submissions

Republic Act No. 9470 and its IRR require an Archives and Records Office/Unit, an
inventory of public records, an Agency RDS submitted for NAP approval, authorized
disposition, and reports on specified recordkeeping practices or controlled records when
the NAP Executive Director requires them. See the
[NAP RA 9470 FAQ](https://nationalarchives.gov.ph/frequently-asked-question) and
[official IRR](https://www.nationalarchives.gov.ph/wp-content/uploads/2024/09/IRR-of-R.A.-9470.pdf).

NAP General Circular No. 5, s. 2023 uses **NAP Form No. 3, Request for Authority to
Dispose of Records**, followed by the prescribed authority and certificate-of-disposal
process. These are operational records controls, not optional report designs. See the
[official circular and GRDS](https://nationalarchives.gov.ph/wp-content/uploads/2024/02/NAP_General_Circular_No_5.pdf).

## 3. Authentication and security baseline, including MFA

The current controlling general security issuance is
[NPC Circular 2023-06](https://privacy.gov.ph/wp-content/uploads/2024/03/NPC-Circular-Repeal-16-01-Signed.pdf),
effective 30 March 2024. It expressly repealed NPC Circular 16-01; the older government-
agency circular must not be used as the current primary rule.

### National minimums relevant to an HRIS

The agency/PIC and its processors must:

- designate and register a DPO and register data-processing systems under the
  applicable NPC rules;
- inventory processing systems and activities;
- perform and update a Privacy Impact Assessment for processing systems involving
  personal data, covering the lifecycle from collection to disposal;
- establish a Privacy Management Program and risk-responsive control framework;
- apply privacy by design and privacy by default, disabling processing functions that
  lack a lawful basis;
- adequately protect data using industry standards and best practices, including a
  documented password policy and sufficiently strong, unique passwords/passphrases;
- implement need-to-know access control, security clearance/equivalent, authentication,
  monitoring, and system-managed access rights;
- maintain an updated acceptable-use policy agreed to by users before access;
- authorize only known, properly configured devices and control portable media;
- provide remote disconnection/deletion capability for lost or compromised agency-
  owned mobile devices;
- maintain a business-continuity plan covering backup, restoration, recovery time,
  testing, disaster recovery, privacy, impact assessment, crisis communications, and
  telecommuting;
- protect email and other transfers, encrypt unavoidable removable-media transfers,
  and not use fax to transmit personal data;
- maintain breach-management, threat-monitoring, and vulnerability-management
  processes; and
- establish secure disposal/destruction procedures and preserve required evidence.

### What the current rule says about MFA

Section 16 requires secure authentication mechanisms, **such as multifactor
authentication or secure encrypted links**, when personnel receive online access to:

- sensitive personal information;
- privileged information; or
- a high volume of personal data.

The NPC's [official FAQ](https://privacy.gov.ph/wp-content/uploads/2024/12/v12-19-2024_FAQ-NPC-Circular-2023-06_NNJ_JDN.pdf)
warns that username, password, and an approver may not satisfy the full access-security
requirements, and says the PIC/PIP must determine appropriate measures for its
infrastructure and risks.

**Authority boundary:** the national rule establishes a secure-authentication and risk
floor, but it does not publish a complete HRIS role matrix saying "MFA for all" or "MFA
for privileged users only." The role/transaction scope must be decided using the PIA,
data classifications, threat model, identity-provider capability, and the actual agency's
security policies. Agency configuration must not be allowed to turn off controls needed
to satisfy the national floor.

### Security-log retention

NPC Circular 2023-06 does **not** set a universal numeric retention period for system
logs. Section 29 requires retention for as long as necessary and appropriate under best
practice and industry standards; authentication-attempt and security-incident logs are
to be kept longer than general logs, incident logs may have to outlive the ordinary policy,
and backup/archive mechanisms are required. A numeric HRIS audit/security-log period
therefore remains an agency risk and records-policy value unless another applicable
issuance supplies one.

## 4. Records retention and archival

### 4.1 Governing controls

The [RA 9470 IRR](https://www.nationalarchives.gov.ph/wp-content/uploads/2024/09/IRR-of-R.A.-9470.pdf)
requires every government office to prepare and submit an Agency RDS; once approved,
it governs that office's records. NAP also issues a GRDS for common public records.
No public record may be destroyed without prior written authority from the NAP
Executive Director. Records involved in a case/investigation cannot be disposed until
final resolution, and financial records subject to COA audit cannot be disposed until
post-audited and finally settled.

Electronic records are public records too. NAP Memorandum Circular No. 210401's
Electronic Records Management Policy covers creation, maintenance, circulation,
preservation, and authorized disposition across the record lifecycle; hybrid paper and
electronic systems remain possible. See the official
[ERMP primer](https://nationalarchives.gov.ph/wp-content/uploads/2025/04/ERMP-PRIMER25.pdf).

### 4.2 Current GRDS 2023 periods relevant to the HRIS

The following are common-record periods in the
[2023 GRDS attached to NAP General Circular No. 5](https://nationalarchives.gov.ph/wp-content/uploads/2024/02/NAP_General_Circular_No_5.pdf).
They must be read with the holds and approval rules above.

| Record series | GRDS period/trigger |
|---|---|
| Applications for leave and supporting documents | 1 year after recorded in the leave card |
| Attendance monitoring sheets | 1 year |
| Authorities/requests to create or fill vacant positions | 2 years after the positions are filled |
| Daily Time Records | 1 year after data are posted in leave cards and post-audited |
| Employment/promotion files, including applications, comparative assessments, interview scores, summaries, and tests | 1 year after the vacancy is filled |
| Job Order employment contracts with supporting documents | 5 years after termination |
| Leave credit cards | 15 years after settled |
| Arrival/departure logbooks | 2 years after the last entry |
| Attendance logbooks | 1 year, provided leave and undertime are posted to the leave card |
| Medical certificates supporting illness, maternity, or return-to-work absence | 3 years after the absence is recorded in leave cards |
| Merit selection and promotion plans | 1 year after superseded |
| IPCR | 1 year after the final rating is determined |
| OPCR and DPCR | 5 years after the final rating is determined |
| Performance monitoring tools/reports | 5 years after the final rating is determined |
| Summary lists of individual performance ratings | 2 years |
| Payrolls | 10 years, provided post-audited, finally settled, and not involved in a case |
| Payroll payment slips/payslips | 10 years, provided settled |
| Payroll register | Permanent |

**Agency-specific values required:** the actual NAP-approved Agency RDS, any special-law
schedule, the agency's records classifications, legal/audit hold process, official record
copy, archival transfer rules, and agency retention additions. The system must not infer
that expiration of a GRDS period by itself authorizes destruction.

## 5. National MSP structural floor

Rule IX of the [2025 ORAOHRA](https://www.csc.gov.ph/phocadownload/userupload/hrpso/2025-ORAOHRA/2025%20ORAOHRA.pdf)
establishes these constraints for the civilian NGA profile:

- The MSP covers first- and second-level positions and original, promotional, and other
  appointments and related HR actions.
- Selection must provide equal opportunity and non-discrimination to applicants who
  meet minimum position requirements, under merit and fitness.
- An agency may create separate HRMPSBs for first/second-level and executive/
  managerial positions, and may establish specialized boards, but specialized/different
  boards must be provided in the Agency MSP submitted for CSC Regional Office approval.
- For NGA first/second-level positions, the prescribed HRMPSB floor includes the highest
  official in charge of HRM as chair; the head of the unit with the vacancy; the HRMO/
  responsible recruitment employee; and first- and second-level rank-and-file
  representatives chosen by the accredited employees' association or, absent one, by
  employees through a general assembly.
- The prescribed composition may be enlarged or conformingly modified but not reduced.
  The agency head identifies principals and alternates by Office Order and furnishes the
  CSC Regional/Field Office; membership changes are reported.
- The HRMO/unit supplies secretariat and technical support, but the HRMO sitting as a
  board member cannot also act as secretariat. Members and alternates require orientation
  on agency and CSC selection policy.
- At least a majority of prescribed members must be present for deliberation.
- HRMPSB duties include following the approved process, producing a comprehensive
  candidate evaluation report, preserving deliberation documentation for CSC inspection
  and audit, and supplying an applicant's individual rating on written request.
- The report provides a list including the top five candidates considered most qualified;
  the appointing authority remains able to choose another qualified candidate on sound
  discretion.
- Career appointments generally require HRMPSB screening and deliberation; stated
  exceptions are transaction-specific. For NGAs, deliberation may begin only after the
  ten-calendar-day publication/posting period and completed screening under the
  CSC-approved MSP.
- The agency submits its System of Ranking Positions and its head-signed Agency MSP;
  the MSP and later amendments take effect upon CSC Regional Office approval and bind
  the agency, employees, and CSC.

### 2026 competency overlay

[CSC Resolution No. 2600005](https://www.csc.gov.ph/downloads/category/562-csc-reso-2600005)
establishes the current Competency-Based Human Resource Management System guidance.
It classifies core, leadership, and functional/technical competencies and integrates
competencies into recruitment/selection, learning and development, performance
management, and rewards. Where competency use changes the MSP, SPMS, or PRAISE,
the agency must submit amendments to the CSC Regional Office under the current approval
policies. The [official FAQ](https://www.csc.gov.ph/phocadownload/userupload/irmo/policy%20resolutions/2026/Frequently%20Asked%20Questions%20on%20CBHRMS.pdf)
also makes clear that agencies develop their models/profiles and may choose assessment
methods.

### MSP details that remain agency-specific

- assessment stages and instruments;
- weights, points, cutoffs, tie handling, and comparative-ranking calculations;
- special HRMPSBs beyond the national floor;
- competency model, position profiles, proficiency rubrics, and assessment tools;
- internal endorsement/approval routing beyond prescribed actors;
- detailed next-in-rank relationships reflected in the approved SRP; and
- agency notices, templates, and supporting-document rules not prescribed nationally.

These values require the actual CSC-approved Agency MSP or a documented answer from an
authorized agency representative.

## 6. National SPMS structural floor

The [CSC SPMS guidelines](https://csc.gov.ph/phocadownload/userupload/irmo/mc/2012/mc6s2012SPMSguide.pdf)
require the following structure:

- Alignment of organizational and individual goals with the agency mandate and
  priorities; an outputs/outcomes orientation; a team approach; user-friendly aligned
  forms; monitoring/evaluation information systems; and a communication plan.
- A four-stage cycle: (1) performance planning and commitment, (2) monitoring and
  coaching, (3) review and evaluation, and (4) rewarding and development planning.
- An agency head/SPMS Champion and a Performance Management Team (PMT). The
  preferred agency PMT composition includes an executive chair plus the highest HRM,
  HRD, planning, and finance officers and the accredited employee-association president
  or elected rank-and-file representative.
- Planning serves as PMT secretariat; HR monitors IPCRs and rating alignment; office
  heads establish commitments, assess evidence, give feedback, and establish
  development plans; employees participate as performance partners.
- Success indicators consist of measures and targets. Measures may cover quality/
  effectiveness, efficiency, and timeliness. Office targets, measures, budget, and
  accountable units/people are summarized in OPCR; approved OPCR drives IPCR targets.
- Ratings must rest on accomplishment records and evidence. The average individual
  rating may not exceed the collective office rating.
- Performance evaluation is normally semiannual. An agency may select a different
  period, but the minimum is 90 calendar days/three months and the maximum is one
  calendar year.
- A general five-point scale runs from 5/Outstanding through 1/Poor, although specific
  measures may use other scales.
- An aggrieved employee may appeal an individual final rating to the PMT within ten
  days of receipt; the PMT decides within one month. Office-rating issues are resolved
  in the performance review conference under the rule's stated finality structure.
- The agency system must be CSC-approved, and enhancements/amendments are submitted
  under the applicable approval/information process.

### SPMS details that remain agency-specific

- exact rating-period dates and target-setting calendar;
- organizational hierarchy represented by OPCR/DPCR/IPCR or agency-equivalent forms;
- exact success indicators, weights, standards, and evidence types;
- additional PMT hierarchy and internal rules;
- competency model and how competency assessment remains separate from performance
  ratings;
- local sign-off, notification, calibration, and record-routing details; and
- the agency's CSC-approved form layout and amendments.

These require the actual CSC-approved Agency SPMS or an authorized agency answer.

## 7. Decision inputs now sharp enough for the Wayfinder map

The research does not select product scope. It makes these later decisions precise:

1. **Exact form generation versus data/package export:** classify each current CSC form
   in Sections 1.1 and 1.2; do not decide once for all reports.
2. **Agency-status profile:** decide how a generic profile represents regulated versus
   accredited/deregulated appointment paths without pretending the status is known.
3. **DTR boundary:** decide what the product renders only after current CSC/authorized
   agency confirmation of the accepted electronic DTR layout and work-arrangement rules.
4. **MFA scope:** choose a role/transaction policy within NPC Circular 2023-06's secure-
   authentication floor, based on the PIA and identity-provider capabilities.
5. **Retention engine:** decide how to represent GRDS defaults, an approved Agency RDS,
   record copy, holds, archival transfer, NAP authorization, and secure destruction without
   treating elapsed time as deletion permission.
6. **MSP configurable structure:** preserve the national HRMPSB/process floor while
   making agency-approved assessments, scoring, competencies, and routing versioned
   configuration.
7. **SPMS configurable structure:** preserve the four-stage cycle, actor/accountability
   floor, evidence, rating constraints, appeals, and allowed period bounds while deferring
   the actual agency calendar, forms, indicators, and weights.
8. **Externally versioned submissions:** decide how the product tracks evolving CSC,
   IGHRS, SALN, NPC, and NAP portal/form versions without claiming direct integration.

## 8. Facts that require an authorized agency or regulator answer

- Is the future pilot NGA regulated or accredited/deregulated for appointments?
- What are its current CSC-approved MSP, SRP, SPMS, competency model, and PRAISE
  policy versions?
- What Agency RDS has NAP approved, which copy is the official record, and which
  litigation/audit/administrative holds apply?
- Which electronic DTR rendering is accepted and how do its work-arrangement rules map
  to attendance evidence?
- What are the current IGHRS field schema, cadence, credentials, and submission
  instructions for that agency?
- Which SALN repository agency applies and what handling boundary is authorized for the
  HRIS?
- Which identity/authentication controls are required by the agency's PIA, privacy manual,
  information-security policy, and hosting arrangement beyond the NPC minimum?
- Which payroll, contribution, tax, bank, accounting, and budget outputs are required by
  the actual receiving systems? Those facts must be reconciled with the separate
  personnel/compensation research rather than inferred here.

## Sources

Only official/primary Philippine government sources were used for findings:

- Civil Service Commission, [2025 ORAOHRA and annexes](https://csc.gov.ph/downloads/2025-oraohra)
- Civil Service Commission, [SPMS program and MC No. 6, s. 2012](https://csc.gov.ph/programs/spms)
- Civil Service Commission, [2026 CBHRMS materials](https://www.csc.gov.ph/downloads/category/562-csc-reso-2600005)
- Civil Service Commission, [current forms catalog](https://csc.gov.ph/downloads/forms)
- Civil Service Commission, [current SALN materials](https://csc.gov.ph/downloads/category/224_osc-form-212-ravised-2017-personal-data-sheet)
- National Privacy Commission, [Circular 2023-06](https://privacy.gov.ph/wp-content/uploads/2024/03/NPC-Circular-Repeal-16-01-Signed.pdf)
- National Privacy Commission, [registration FAQ](https://privacy.gov.ph/pips-and-pics/faqs/)
- National Privacy Commission, [breach-reporting guidance](https://privacy.gov.ph/pips-and-pics/breach-reporting/)
- National Archives of the Philippines, [RA 9470 IRR](https://www.nationalarchives.gov.ph/wp-content/uploads/2024/09/IRR-of-R.A.-9470.pdf)
- National Archives of the Philippines, [General Circular No. 5 and GRDS 2023](https://nationalarchives.gov.ph/wp-content/uploads/2024/02/NAP_General_Circular_No_5.pdf)
- National Archives of the Philippines, [Electronic Records Management Policy primer](https://nationalarchives.gov.ph/wp-content/uploads/2025/04/ERMP-PRIMER25.pdf)
