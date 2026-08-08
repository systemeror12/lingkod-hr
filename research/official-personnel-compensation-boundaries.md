# Official personnel and compensation boundaries for the Reference Agency Profile

**Research date:** 9 August 2026

**Question:** Which current official Philippine sources constrain civilian National Government Agency (NGA) personnel categories, Job Order (JO) and Contract of Service (COS) treatment, and the salary, allowance, contribution, tax, and deduction baselines relevant to the Reference Agency Profile?

## Answer in brief

The national baseline does not support one flat `employment_type` or one payroll rule set.

1. An appointed government employee and an individual engaged through JO/COS are legally different. Career/non-career class, appointment status, position authority, and full-/part-time status are separate dimensions for appointed personnel. JO/COS workers are not appointed government employees and their services are not creditable as government service.
2. Permanent, temporary, casual, and contractual personnel cannot be collapsed into JO/COS. Casual and contractual **appointments** have an employer-employee relationship and may receive the compensation and benefits authorized for government employees; JO/COS engagements do not.
3. For civilian NGA employees covered by the national Compensation and Position Classification System, DBM National Budget Circular (NBC) No. 601 supplies the salary-grade-and-step schedule effective 1 January 2026. It expressly excludes JO/COS and similarly situated workers.
4. The nationally authorized common compensation baseline for FY 2026 includes ₱2,000 monthly PERA, uniform/clothing allowance not exceeding ₱7,000 yearly, medical allowance not exceeding ₱7,000 yearly, one-month mid-year bonus, and one-month year-end bonus plus ₱5,000 cash gift, each subject to its own coverage and eligibility rules. Conditional or position-specific payments are not generic entitlements.
5. Employee payroll must keep effective-dated rules for GSIS, PhilHealth, Pag-IBIG, Employees' Compensation, BIR withholding, and authorized deductions. JO/COS payments instead follow contractor/self-employed tax and social-protection rules.

This research identifies constraints and configurable values. It does **not** decide which personnel or payment profiles the product will support at launch.

## 1. Personnel categories are separate dimensions

### 1.1 Civil-service class

Executive Order No. 292 divides positions in the Civil Service into **career** and **non-career** service. Career service is characterized by merit-and-fitness entry, opportunity for advancement, and security of tenure. Non-career service has entry on other bases and tenure limited by law, the appointing authority, pleasure, or the duration of a project. The current CSC glossary carries those definitions forward. See the [CSC 2025 ORAOHRA Appendix A](https://csc.gov.ph/phocadownload/userupload/hrpso/2025-ORAOHRA/APPENDIX%20A%20-%20Glossary%20of%20Terms.pdf) and the [CSC's current rules collection](https://csc.gov.ph/downloads/2025-oraohra).

This classification is not interchangeable with appointment status. For example, `NON_CAREER` and `CONTRACTUAL` answer different questions.

### 1.2 Appointment status

The 2025 Omnibus Rules on Appointments and Other Human Resource Actions (ORAOHRA), issued through CSC Resolution No. 2500358 and Memorandum Circular No. 8, s. 2025, recognizes permanent, temporary, coterminous, fixed-term, contractual, substitute, and provisional appointments; it also regulates casual appointments. The CSC's official Inventory of Government Human Resources glossary summarizes the especially relevant statuses as follows:

| Status | National meaning at low resolution |
|---|---|
| Permanent | Appointee meets all qualification requirements, including appropriate eligibility. |
| Temporary | Appointee meets education, experience, and training requirements but lacks the appropriate eligibility. |
| Coterminous | Tenure is limited by law or depends on the trust/confidence or tenure of the identified authority or office head. |
| Contractual appointment | Government employment under a special contract for specific work requiring unavailable special or technical skills, within a specific period. |
| Casual appointment | Essential/necessary service where regular staff are insufficient, or emergency/intermittent service, for a period not exceeding one year. |
| Substitute | Temporary replacement during the regular incumbent's qualifying absence; the appointee receives the salary and benefits attached to the position except benefits requiring a longer service period. |

Sources: [CSC MC No. 8, s. 2025](https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/2025/MC%20No.%2008%20s.%202025.pdf), [CSC 2025 ORAOHRA materials](https://csc.gov.ph/downloads/2025-oraohra), and the [CSC 2025 IGHR report](https://csc.gov.ph/phocadownload/userupload/irmo/ighr/2025/IGHR%20report%20as%20of%20oct%2010%202025.pdf).

The appointing agency supplies the actual appointment, position/item, effectivity, nature of appointment, and supporting authority. A generic reference profile cannot invent those values.

### 1.3 Position and funding category

DBM's FY 2026 budget guidance separately distinguishes filled itemized positions and non-permanent personnel classified as casual, contractual, or part-time. The salary authority and source of funds depend on the authorized position, approved staffing pattern, Government Manpower Information System/Personnel Services Itemization and Plantilla of Personnel data, or approved lump-sum provision. See [National Budget Memorandum No. 153](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2024/National-Budget-Memorandum/NATIONAL-BUDGET-MEMORANDUM-NO.-153_updated.pdf), Annex B.

Accordingly, at least these facts must not be inferred from one another:

- career or non-career service;
- appointment status and nature;
- regular/itemized, casual, contractual, or part-time budget treatment;
- authorized position, item number, salary grade, and step;
- employer-employee relationship; and
- JO/COS engagement type.

## 2. JO and COS are a separate national regime

The current governing issuance for the reference NGA is [CSC-COA-DBM Joint Circular No. 1, s. 2025](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2025/Joint-Circular/CSC-COA-DBM-JOINT-CIRCULAR-NO.-1%2C-s.-2025.pdf). It covers NGAs, GOCCs with original charters, SUCs, and constitutional bodies, with stated exclusions including LGU engagements and specified engineering/administrative-overhead engagements.

### 2.1 Nationally fixed distinctions

| Matter | Individual COS | JO |
|---|---|---|
| Permitted purpose | Consultant, learning service provider, or technical expert for a special project/job within a specific period. | Piecework or intermittent/emergency job, including short-duration manual, trade, or craft work for a specific piece of work. |
| Duration | Maximum one year, renewable at the agency head's option but not beyond that official's term. | Short duration for the specific piece of work; the circular does not create a generic employee term. |
| Functional boundary | The work is not part of regular agency functions, expertise is unavailable in the agency, or direct performance is impractical/more expensive. | Emergency/intermittent/manual/trade/craft work not part of regular agency functions. |
| Prohibited use | Neither COS nor JO may perform functions in an existing regular employee's job description or be designated to exercise control or supervision over regular/career employees. |
| Civil-service status | Not covered by civil-service laws/rules; service is not creditable as government service. |
| Employee benefits | No employee leave, PERA, RATA, or the other bonuses, allowances, and incentives enjoyed by government employees. |
| Payment basis | Prevailing market rate or salary of a comparable government position. | Agreed amount for the piece of work or daily wage of a comparable government position. |
| Funding | Service payments are charged to MOOE, not Personnel Services. |

The distinction also extends to institutional COS: workers remain employees of the contractor/service provider, which is responsible for labor-law-compliant compensation and benefits. That is another category and must not be represented as an individual agency employee.

### 2.2 National ceiling and agency choices

For individual COS and JO, the 2025 Joint Circular requires the agency to provide a premium **not exceeding 20%** of salary/wage, subject to funding availability. It states that the premium covers the worker's voluntary or self-employed contributions to SSS, PhilHealth, and Pag-IBIG. Subject to available funds and contract terms, ancillary benefits include overtime pay under CSC-DBM JC No. 2, s. 2015, reimbursement of actual official local travel under EO No. 77, s. 2019, and flexible work arrangements under COA-DBM JC No. 1, s. 2022. The [oversight agencies' official FAQ](https://www.dbm.gov.ph/images/pdffiles/FAQs-on-JO-and-COS-Workers.pdf) confirms this interpretation for FY 2026.

National rules therefore fix the ceiling and conditions, while the actual agency must determine and document:

- the comparable position or defensible market rate;
- the exact service payment;
- the exact premium, not exceeding 20%, based on available funds;
- which authorized ancillary benefits are included in the contract;
- internal engagement, approval, attendance/output, and payment procedures; and
- the supporting appropriation and accounting treatment.

Those values are not safe generic defaults.

### 2.3 Current cap and reporting fact

The 2025 Joint Circular prevents a covered agency from increasing its COS/JO count beyond its baseline number of workers whose contracts remained valid through 31 December 2025. Each agency had to inventory those workers and report to COA, copy furnished CSC and DBM, by 31 January 2026. The [CSC announcement](https://www.csc.gov.ph/government-caps-hiring-of-contract-of-service-and-job-order-workers) and [official FAQ](https://www.dbm.gov.ph/images/pdffiles/FAQs-on-JO-and-COS-Workers.pdf) confirm the cap.

The baseline count is an **agency fact**, not a national reference value. A generic Reference Agency Profile cannot assume a number. An agency with no verified inventory requires an authorized agency answer and, where needed, oversight-agency clarification.

## 3. Salary and common compensation baseline

### 3.1 Basic salary

[DBM NBC No. 601, dated 22 January 2026](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2026/National-Budget-Circular/NATIONAL-BUDGET-CIRCULAR-NO.-601_NEW.pdf), implements the third tranche of EO No. 64, s. 2024 effective 1 January 2026.

National constraints include:

- covered civilian NGA positions use Annex A's salary-grade-and-step schedule;
- incumbent salary maps to the authorized position's salary grade and designated step under the circular's adjustment rules;
- a new hire normally receives Step 1;
- contractual/casual personnel covered by the circular map to Step 1 of the position's salary grade;
- casual daily wage is the applicable monthly rate divided by 22 workdays; and
- consultants, experts, JO, COS, pieceworkers, and other persons without an employer-employee relationship funded outside Personnel Services are expressly excluded.

The schedule and its effectivity are nationally authoritative. The employee's position, salary grade, step, protected/non-diminution case, and effective date come from the approved staffing and appointment records. The fourth tranche scheduled for FY 2027 means the 2026 table is not a timeless constant.

### 3.2 Common allowances and bonuses for FY 2026

The [FY 2026 General Appropriations Act (GAA), General Provisions](https://www.dbm.gov.ph/wp-content/uploads/GAA/GAA2026/VolumeIB/GENPRO.pdf) establishes the following high-level baseline for qualified government personnel:

| Component | FY 2026 authority | Important condition |
|---|---|---|
| PERA | ₱2,000 per month | Civilian personnel stationed in the Philippines in regular, contractual, or casual positions, appointive or elective; subject to DBM rules. |
| Uniform/clothing allowance | Not exceeding ₱7,000 per year | Qualified personnel; detailed eligibility and forms of grant follow DBM BC No. 2024-1. |
| Medical allowance | Not exceeding ₱7,000 per year | Qualified civilian personnel as an HMO-type benefit subsidy; follows DBM BC No. 2024-6. JO/COS are excluded from that circular's employee coverage. |
| Mid-year bonus | One month basic salary | Regular, temporary, casual, or contractual, full- or part-time; service and satisfactory-performance conditions apply. |
| Year-end bonus | One month basic salary | Regular, temporary, casual, or contractual, full- or part-time; service conditions apply. |
| Cash gift | ₱5,000 | Coupled to the year-end-bonus rules, including prorating/separation provisions where applicable. |

Detailed sources: [DBM BC No. 2024-1](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2024/Budget-Circular/BUDGET-CIRCULAR-NO-2024-1-DATED-APRIL-4-2024.pdf), [DBM BC No. 2024-6](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2024/Budget-Circular/BUDGET-CIRCULAR-NO-2024-6.pdf), [DBM BC No. 2017-2](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2017/Budget%20Circular/BUDGET%20CIRCULAR%20NO.%202017-2.pdf), and [DBM BC No. 2016-4](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2016/Budget%20Circular/BUDGET%20CIRCULAR%20NO.%202016%20-%204.pdf), as amended.

RATA, night-shift differential, overtime, honoraria, Magna Carta benefits, CNA incentives, performance incentives, hazard/subsistence/laundry benefits, and other special-law payments are conditional. They require the covered position/person, actual event or performance, current issuance, available authority/funds, and sometimes an agency implementing rule. They are not defaults merely because an employee is in an NGA.

## 4. Contribution baselines

| Program | Appointed employee baseline | JO/COS boundary | Authority and caveat |
|---|---|---|---|
| GSIS | Compulsory for government employees receiving compensation, irrespective of appointment status, except statutory exclusions. Current regular-member personal and government shares are 9% and 12% of monthly compensation, respectively. | RA No. 8291 excludes contractuals without an employer-employee relationship; JO/COS are instead directed by the 2025 Joint Circular toward SSS voluntary/self-employed coverage. | [RA No. 8291](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/4363) and [GSIS Resolution No. 88, s. 2010](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/56361). Special members have different treatment and must not use the regular-member rule blindly. |
| Employees' Compensation Insurance Premium | Employer-funded. DBM's FY 2026 budgeting baseline is 1% of annual basic salary or ₱1,200 yearly, whichever is lower. | Not an employee payroll deduction under the NGA employee rule. SSS self-employed rules may include EC according to the worker's membership schedule. | [DBM National Budget Memorandum No. 153](https://www.dbm.gov.ph/wp-content/uploads/Issuances/2024/National-Budget-Memorandum/NATIONAL-BUDGET-MEMORANDUM-NO.-153_updated.pdf), Annex B, item 4.1.1.2. |
| PhilHealth | Most recent employed-member schedule located: 5% of monthly basic salary, income floor ₱10,000 and ceiling ₱100,000, shared equally by employee and employer. Monthly basic salary excludes overtime, allowances, 13th-month pay, bonuses, and gratuities; deductions for undertime/absence do not reduce the contribution base. | Self-earning direct contributors without an employer-employee relationship pay the whole contribution based on declared income. The JO/COS premium is paid to the worker to cover this obligation; it is not the employee/employer split. | [PhilHealth Advisory No. 2025-0002](https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf), [PhilHealth Circular No. 2020-0005 explainer](https://www.philhealth.gov.ph/circulars/2020/TS_circ2020-0005.pdf), and [formal-economy guidance](https://www.philhealth.gov.ph/members/formal/registration.php). No separate CY 2026 employed-rate advisory was located in the [2026 advisory index](https://www.philhealth.gov.ph/advisories/2026/) as of the research date; production use should obtain issuer confirmation that the 2025 schedule continues unchanged. |
| Pag-IBIG | Employee rate is 1% for monthly compensation up to ₱1,500 and 2% above it; employer counterpart is 2%. Current Pag-IBIG payment guidance reflects a ₱10,000 Maximum Fund Salary, producing the common ₱200 employee and ₱200 employer monthly maximum at salaries above that threshold. | The 2025 Joint Circular treats JO/COS payments as voluntary/self-employed membership contributions funded from the worker's premium, not an agency employer share. | [HDMF Circular No. 274](https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20No.%20274%20-%20Revised%20Guidelines%20on%20Pag-IBIG%20Fund%20Membership.pdf) for rates and [current Pag-IBIG payment guidance](https://www.pagibigfund.gov.ph/document/pdf/payments/AcceptingPagIBIGPaymentsThroughOTC_24%20JAN%202025.pdf) for the ₱10,000 MFS. The implementing artifact identified as HDMF Circular No. 460 should be obtained from Pag-IBIG before encoding the table as production authority. |
| SSS for JO/COS | Not the normal scheme for an appointed civilian NGA employee covered by GSIS. | For self-employed members, the schedule effective January 2025 uses a 15% contribution rate, minimum Monthly Salary Credit (MSC) ₱5,000 and maximum MSC ₱35,000; exact contribution follows the official bracket table and declared earnings. | [SSS Circular No. 2024-008](https://www.sss.gov.ph/wp-content/uploads/2024/12/CI-2024-008-Publication.pdf) and [SSS contribution guidance](https://www.sss.gov.ph/pay-contribution/). A worker classified as voluntary rather than self-employed follows the applicable SSS schedule, so the agency cannot infer the worker's membership subtype. |

All contribution rates, bases, caps, splits, membership classes, rounding rules, and remittance periods should be effective-dated independently. The same person may change category over time; a finalized payroll or service-payment record must retain the rule version actually applied.

## 5. Tax baselines

### 5.1 Appointed employees

BIR Revenue Regulations (RR) No. 11-2018 separates taxable and non-taxable compensation and provides the withholding method. The current published withholding table is marked **effective 1 January 2023 and onwards**. For monthly payroll it begins at zero withholding up to ₱20,833, then applies the prescribed marginal formulas through the highest bracket. The authoritative table also supplies daily, weekly, and semi-monthly formulas. Use [BIR RR No. 11-2018](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf) and its [Annex E withholding table](https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf), not a transcribed permanent constant.

The same regulations establish important base rules:

- the employee's mandatory GSIS/SSS, PhilHealth/Medicare, and Pag-IBIG shares and union dues are excluded from taxable compensation;
- 13th-month pay and other benefits have an aggregate ₱90,000 exclusion ceiling, with excess taxable; and
- an allowance's DBM authorization does not by itself determine its BIR tax treatment. Each pay component needs its own current tax classification and ceiling.

### 5.2 JO/COS payees

JO/COS compensation is not employee compensation withholding. [BIR RMC No. 51-2018](https://bir-cdn.bir.gov.ph/local/pdf/RMC%2051-2018.pdf) classifies individuals under government JO or service contracts as professionals or other suppliers of services and gives a separate registration, return, business-tax, and expanded-withholding matrix based on payee type, gross receipts, number of payors, VAT status, tax option, and sworn declaration. [BIR RMC No. 105-2025](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%20105-2025.pdf) recently reaffirmed that COS/JO workers have no employer-employee relationship and are self-employed professionals or independent contractors subject to the Tax Code and RMC No. 51-2018.

Therefore, no single generic JO/COS withholding percentage is authoritative. The actual rate depends on current payee evidence and tax status. EOPT-era registration and invoicing changes also mean the agency should obtain a current BIR-reviewed compliance matrix before implementing JO/COS tax calculation or substituted filing.

## 6. Authorized deductions and priority

Sections 61 and 62 of the [FY 2026 GAA General Provisions](https://www.dbm.gov.ph/wp-content/uploads/GAA/GAA2026/VolumeIB/GENPRO.pdf) provide the current national boundary:

- agencies remit government and employee compulsory contributions directly to the recipient schemes;
- allowed salary/benefit deductions cover obligations to BIR, PhilHealth, GSIS, and HDMF; final COA decisions in favor of the National Government; qualified employee cooperatives, savings/loan and mutual-benefit associations; employee provident funds; authorized GFIs/government depository banks; licensed insurers; and BSP-accredited thrift/rural banks;
- BIR obligations and PhilHealth, GSIS, and HDMF contributions are satisfied before other obligations;
- other allowed obligations are satisfied in the order incurred; and
- those deductions may not reduce monthly net take-home pay below **₱5,000**.

This is an authorization boundary, not a command to create every listed deduction. The actual deduction still needs a valid individual obligation, legal basis/consent where applicable, account balance and schedule, payee eligibility, and agency records. Court orders, COA liabilities, statutory contributions, loan deductions, and voluntary deductions should not be represented as one undifferentiated `other deduction` rule.

The GAA is annual. Its payee list, priority, and net-take-home floor must be versioned by fiscal year and revalidated against the next appropriations law.

## 7. National requirements, agency values, and unresolved facts

| Nationally authoritative constraint | Agency-configurable or agency-supplied value | Unknown requiring evidence rather than a default |
|---|---|---|
| Career/non-career definitions and lawful appointment statuses | Which authorized categories, positions, and appointment records exist in the agency | Any special charter or exemption applicable to a future identified pilot agency |
| 2026 salary-grade-and-step schedule and adjustment rules | Approved item, position title, SG, step, effectivity, and funding source | Future salary schedules and amendments after the 2026 third tranche |
| Casual/contractual appointments are employees; JO/COS are not | Whether the agency actually uses casual/contractual appointments and which authorized items exist | Launch support for any category; this is a product-scope decision, not a legal fact |
| JO/COS permitted uses, prohibitions, MOOE treatment, 20% premium ceiling, and count cap | Comparable rate, exact pay, premium percentage, ancillary benefits, internal workflow, and appropriation | Agency's verified 31 December 2025 COS/JO baseline count and any oversight resolution if absent |
| Common employee allowance/bonus caps and eligibility framework | Actual eligibility facts, payment date, documents, and current agency authority | Tax treatment of each configured allowance until mapped to current BIR authority |
| Contribution membership boundaries and nationally issued tables | Member identifiers, declared status, employee-specific base, loans, and remittance history | PhilHealth confirmation of the employed-member schedule for CY 2026; official copy/verification of HDMF Circular No. 460 |
| BIR compensation-withholding table and JO/COS contractor boundary | Payee declarations, VAT/tax option, receipts, tax code, and certificates | A current BIR-reviewed JO/COS matrix after EOPT changes if service-payment tax automation is contemplated |
| GAA deduction payees, priority, and ₱5,000 floor | Actual obligations and deduction instructions | Rules under a later GAA or a special agency law |

## 8. Constraints for the later scope decision

Without choosing product scope, the evidence makes the following boundaries non-negotiable:

- Do not label JO/COS workers as casual or contractual **employees**.
- Do not run JO/COS payments through the ordinary plantilla employee payroll rule set.
- Do not grant JO/COS employee benefits by copying regular/casual/contractual employee defaults; apply only the 2025 Joint Circular and the authorized contract terms.
- Do not infer GSIS coverage for JO/COS or SSS employee coverage for appointed NGA personnel.
- Do not hard-code the 2026 salary schedule, annual GAA limits, contribution tables, tax tables, or allowance taxability as timeless values.
- Do not infer an agency's positions, categories, COS/JO count, comparable rates, deductions, or special benefits from the generic reference profile.
- Keep legal authority, agency configuration, employee/payee evidence, calculation version, and finalized result separately traceable.

## Research limitations

This review used official issuances and first-party government materials available online as of 9 August 2026. It did not obtain an agency legal opinion, an actual approved staffing pattern/PSIPOP, a 31 December 2025 JO/COS inventory, or worker-specific tax declarations. It also did not examine special laws for excluded sectors such as military/uniformed personnel, teachers, judiciary-specific personnel, health-worker Magna Carta benefits, LGUs, SUCs, or GOCC-specific compensation systems.

The two issuer confirmations called out above—CY 2026 PhilHealth employed-member rates and the official HDMF Circular No. 460 artifact—should remain explicit verification gates. They do not justify inventing replacement values.
