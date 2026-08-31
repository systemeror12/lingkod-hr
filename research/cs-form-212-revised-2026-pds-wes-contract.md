# CS Form No. 212, Revised 2026: PDS and WES implementation contract

**Issue:** #96
**Downstream tickets:** #101, #102, #103, #104
**Checked:** 31 August 2026 (Asia/Manila)
**Reference profile:** Generic civilian Philippine government agency. No pilot-agency policy is assumed.

## Purpose and authority boundary

This document is the implementation contract for the Revised 2026 Personal Data
Sheet (PDS), its official guide, and the Work Experience Sheet (WES). It is
intended to make the later PDS tickets executable without inventing government
fields, values, certification behavior, or output layouts.

The source register below is the authority order:

1. The Civil Service Commission (CSC) adoption issuance controls revision and
   transition facts.
2. The official Revised 2026 workbook controls PDS labels, field order, visible
   choices, page structure, continuation sheets, and rendering cues.
3. The official Revised 2026 guide controls completion instructions.
4. The 2025 ORAOHRA Annex H-2 WES file is the latest official WES template
   located in this review. The 2026 CSC package does not list a standalone WES
   file.
5. Project decisions are explicitly marked as such. They are not presented as
   CSC requirements.

The categories in this document are product handling categories, not a claim
that the CSC or the Data Privacy Act uses these exact four labels.

## Executive contract

- The PDS form identifier is `CS_FORM_212_REVISED_2026`.
- The adoption issuance is CSC Memorandum Circular No. 05, s. 2026, dated 23
  June 2026. It restores `Monthly Salary` and `Salary/Job/Pay Grade and Step
  Increment` in Item 28, Section V.
- The circular takes effect 15 days after publication in the Official Gazette
  or a newspaper of general circulation.
- Revised 2025 PDS may be accepted for three months from the circular's
  effectivity for appointments submitted for attestation. The exact end date
  cannot be calculated from the reviewed sources because the publication date
  is not stated in the circular.
- The PDS workbook contains four main sheets, `C1` through `C4`, and seven
  continuation sheets, `C5` through `C11`.
- The guide requires computer entry, no blank applicable fields, `N/A` when a
  field does not apply, full names without abbreviations, and an employee
  e-signature or digital certificate with a date at the bottom of every PDS
  page.
- The guide requires a WES as an attachment to the PDS when applying for a
  vacant position. WES content is limited to work experience relevant to that
  position.
- WES entries are project-normalized records linked to exactly one work row in
  the same PDS version and the same WES artifact. The link is a project
  integrity rule, not an explicit CSC database rule.
- A certified PDS or WES output is immutable. A correction creates a successor
  version with a reason and a link to the superseded version. The prior
  certified output remains available as historical evidence.

## Source register

All sources were retrieved on 31 August 2026 (Asia/Manila). URLs are retained
as source references for implementation tickets.

| ID | Primary source | Revision or date | Retrieval and evidence | Use |
| --- | --- | --- | --- | --- |
| S1 | [CSC MC No. 05, s. 2026 package](https://www.csc.gov.ph/downloads/category/566-mc-no-05-2026) | 2026 package | Official CSC download page; the page lists the adoption circular, Revised 2026 PDS, and Revised 2026 guide. It does not list a standalone WES. | Package discovery and current revision boundary |
| S2 | [MC No. 05, s. 2026 adoption circular](https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/2026/MC%20No.%2005%20s.%202026%20-%20Adoptiom%20of%20CS%20Form%20No.%20212%20Revised%202026%20Personal%20Data%20Sheet.pdf) | 23 June 2026 | Official CSC PDF, one page. SHA-256: `931d0ea1a2d9f941d31c7908643eef7322d84b303d275ced053973e82291d494`. The source filename contains `Adoptiom`; the circular subject says Adoption. | Adoption, restored Item 28 columns, transition rule |
| S3 | [CS Form No. 212, Revised 2026 workbook](https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/2026/CS%20Form%20No.%20212%20Revised%202026%20Personal%20Data%20Sheet.xlsx) | Revised 2026 | Official CSC XLSX. SHA-256: `578ccec39112dc1d38affb56d7e90c8b669bdc3e031ec3d5c2bdb55958903681`. Server `Last-Modified`: 31 July 2026 07:44:06 GMT. Workbook sheets: `C1` to `C11`. | Exact labels, field order, choices, pages, continuations, signatures |
| S4 | [Guide to Filling Up the PDS, Revised 2026](https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/2026/Guide%20to%20Filling%20Up%20the%20Personal%20Data%20Sheet%20Revised%202026.pdf) | Revised 2026 | Official CSC PDF, five pages. SHA-256: `ba0ff790336e36b9c519f72935ffe4906544f873acfe7803e3dff0b5da0c0194`. Server `Last-Modified`: 31 July 2026 07:44:06 GMT. | Completion instructions, examples, date and ordering guidance, WES applicability |
| S5 | [CSC 2025 ORAOHRA catalog](https://www.csc.gov.ph/downloads/2025-oraohra) | 2025 ORAOHRA | Official CSC catalog. It lists Annex H-1 PDS, Annex H-2 WES, and Annex H-3 PDS guide. | WES catalog and provenance |
| S6 | [2025 ORAOHRA](https://www.csc.gov.ph/phocadownload/userupload/hrpso/2025-ORAOHRA/2025%20ORAOHRA.pdf) | 2025 | Official CSC PDF. Annex H-2 is the Work Experience Sheet attachment, printed page 160 in the ORAOHRA pagination. | WES authority context |
| S7 | [Annex H-2 Work Experience Sheet](https://www.csc.gov.ph/phocadownload/userupload/hrpso/2025-ORAOHRA/ANNEX%20H-2%20-%20CS%20Form%20No.%20212%20Attachment%20-%20Work%20Experience%20Sheet.docx) | 2025 ORAOHRA Annex H-2 | Official CSC DOCX. SHA-256: `7ad8b020bac4df42bc0463d3436d94a619a734e6a6abc2fc818b992caf91a0c9`. Server `Last-Modified`: 24 July 2025 04:13:44 GMT. | Exact WES fields and instructions |

### Source-version rule

The binary hashes above pin the artifacts reviewed for this contract. A future
CSC replacement must receive a new source ID, retrieval metadata, and contract
review. It must not silently replace `S2` through `S7` in application code.

The CSC page for the PDS still has a URL slug containing `revised-2025` in one
catalog path even though its current title and download identify Revised 2026.
Use the MC No. 05 package page and the downloaded artifact title and hash as the
discovery and version check, not the stale slug.

## Completion rules from the official guide

These are source-backed rules from `S3` and `S4`:

| Rule | Contract |
| --- | --- |
| Entry method | Accomplish the PDS on a computer using the official MS Excel format or the system's equivalent rendering. |
| Applicability | Fill every applicable field. Use `N/A` when a field does not apply. Do not leave an applicable field blank. |
| Names | Write names in full. Do not abbreviate school, employer, office, agency, organization, title, award, or association names where the guide says to write in full. |
| Date entry | The guide's examples use numeric `dd/mm/yyyy` dates. The workbook's Item 28 and C8 labels display `mm/dd/yyyy`. The conflict is unresolved and must not be silently normalized to one display format. |
| Signatures | Each PDS page must bear the employee's e-signature or digital certificate and date at the bottom. A right thumbmark is available in Item 42 for a person unable to sign. |
| Continuations | Use C5 through C11 for additional family, education, eligibility, work, voluntary work, L&D, and other information. Print only continuation sheets that contain additional information. |
| Work ordering | List work experience starting with the current or most recent position. |
| L&D ordering | List learning and development interventions starting with the most recent. |
| WES purpose | Include only work experiences relevant to the vacant position being applied for. |
| WES duration | Include start and finish dates if known, abbreviate the month if known, use a full year, and use `Present` for current work. |

## Data and field contract

### Contract notation

- **Type:** `text`, `date`, `school-year`, `integer`, `decimal`, `money`,
  `boolean`, `enum`, `structured`, `narrative`, or `image/document`.
- **Cardinality:** `1` means one form field, `0..1` means conditional or
  optional, and `0..n` means repeatable. `sequence_no` is required for any
  repeatable group so output order is deterministic.
- **Requiredness:** `value or N/A` follows the guide. `conditional` means the
  value or detail is required only when the stated condition applies.
- **Handling class:** product classification defined in the security section.
- **Scope:** `own` is the employee's own record; `HR` is the HRMO Admin or
  Personnel Officer within the agency; `sup` is a supervisor's assigned or
  direct-report scope; `DPO` is controlled data-protection access; `audit` is
  sanitized audit metadata only.

### Page 1, Items 1 to 26

| Item and field | Type and permitted values | Cardinality and order | Requiredness and condition | Handling class | Default read scope | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Surname | Text; full name, no abbreviation | `1`; first personal field | Value or N/A | personal | own, HR; no sup by default | S3 C1; S4 Personal Information |
| 2. First name | Text; full name, no abbreviation | `1`; after surname | Value or N/A | personal | own, HR; no sup by default | S3 C1; S4 Personal Information |
| 2. Name extension | Text; visible example `JR., SR.` | `0..1`; after first name | Conditional when applicable | personal | own, HR; no sup by default | S3 C1; S4 Personal Information |
| 2. Middle name | Text; full name | `0..1`; after extension field | Conditional when applicable | personal | own, HR; no sup by default | S3 C1; S4 Personal Information |
| 3. Date of birth | Date; workbook label `dd/mm/yyyy` | `1`; after name | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 4. Place of birth | Text | `1`; after date of birth | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 5. Sex at birth | Visible enum `Male`, `Female` | `1`; after place of birth | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1 |
| 6. Civil status | Visible enum `Single`, `Married`, `Widowed`, `Separated`, `Other/s` | `1`; after sex | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 6. Civil status detail | Text | `0..1`; follows `Other/s` | Conditional when `Other/s` is selected | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 7. Height | Decimal in metres | `1`; after civil status | Value or N/A; source gives no range | personal | own, HR; no sup by default | S3 C1 |
| 8. Weight | Decimal in kilograms | `1`; after height | Value or N/A; source gives no range | personal | own, HR; no sup by default | S3 C1 |
| 9. Blood type | Text; source gives no controlled value list | `1`; after weight | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1 |
| 10. UMID ID No. | Text identifier | `0..1`; after blood type | Conditional when held or required by agency; otherwise `N/A` | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Personal Information |
| 11. Pag-IBIG ID No. | Text identifier | `0..1`; after UMID | Conditional when held or required; otherwise `N/A` | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Personal Information |
| 12. PhilHealth No. | Text identifier | `0..1`; after Pag-IBIG | Conditional when held or required; otherwise `N/A` | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Personal Information |
| 13. PhilSys Card Number (PCN) | Text identifier | `0..1`; after PhilHealth | Conditional when held or required; otherwise `N/A` | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Personal Information |
| 14. TIN No. | Text identifier | `0..1`; after PCN | Conditional when held or required; otherwise `N/A` | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Personal Information |
| 15. Agency Employee No. | Text identifier | `0..1`; after TIN | Current agency identifier; `N/A` before one exists | sensitive | own, HR; sup only when operationally required; DPO controlled; audit metadata only | S3 C1; S4 Personal Information |
| 16. Citizenship | Visible choices `Filipino` or `Dual Citizenship` by `birth` or `naturalization` | `1`; after agency employee number | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 16. Dual-citizenship country | Exact visible country-list value from the reviewed workbook | `0..1`; follows dual-citizenship choice | Conditional for dual citizenship | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 17. Residential address | Structured fields: House/Block/Lot No., Street, Subdivision/Village, Barangay, City/Municipality, Province, ZIP Code | `1` structured group; after citizenship | Value or N/A per component | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Personal Information |
| 18. Permanent address | Structured fields: House/Block/Lot No., Street, Subdivision/Village, Barangay, City/Municipality, Province, ZIP Code | `1` structured group; after residential address | Value or N/A per component | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Personal Information |
| 19. Telephone No. | Text phone number | `0..1`; after permanent address | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 20. Mobile No. | Text phone number | `0..1`; after telephone | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 21. E-mail Address | Text email address | `0..1`; last personal field | Value or N/A; form says if any | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Personal Information |
| 22. Spouse's name | Structured text: surname, first name, middle name, name extension | `0..1`; family section order | Conditional when married or applicable; otherwise `N/A` | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Family Background |
| 22. Spouse's occupation | Text | `0..1`; after spouse name | Conditional when applicable | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Family Background |
| 22. Spouse's employer/business name | Text; write in full | `0..1`; after occupation | Conditional when applicable | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Family Background |
| 22. Spouse's business address | Text or structured address | `0..1`; after employer | Conditional when applicable | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Family Background |
| 22. Spouse's telephone No. | Text phone number | `0..1`; last spouse field | Conditional when applicable | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Family Background |
| 23. Child's name | Text; full name | `0..n`; child order as entered; use `sequence_no` | Enter all children; no blank rows in output | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Family Background |
| 23. Child's date of birth | Date `dd/mm/yyyy` | `0..n`; paired with child name | Required for each child row | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C1; S4 Family Background |
| 24. Father's name | Structured text: surname, first name, middle name, name extension | `0..1`; after children | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Family Background |
| 25. Mother's maiden name | Structured text: surname, first name, middle name | `0..1`; after father's name | Value or N/A | sensitive | own, HR; DPO controlled; no sup | S3 C1; S4 Family Background |
| 26. Education level | Fixed row order: Elementary, Secondary, Vocational/Trade Course, College, Graduate Studies | `0..n` per level; level order is fixed; use `sequence_no` for continuation | Value or N/A per applicable row | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C1; S4 Educational Background |
| 26. Name of school | Text; write in full | Paired with each education row | Value or N/A | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C1; S4 Educational Background |
| 26. Basic education/degree/course | Text; write in full | Paired with each education row | Value or N/A | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C1; S4 Educational Background |
| 26. Period of attendance | `school-year` text such as `1992-1996`; do not force ordinary calendar dates | Paired with each education row | Value or N/A | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C1; S4 Educational Background |
| 26. Highest level/units earned | Text | Paired with each education row | Required when not graduated; otherwise source permits graduation data | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C1; S4 Educational Background |
| 26. Year graduated | Integer year | Paired with each education row | Conditional when graduated | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C1; S4 Educational Background |
| 26. Scholarship/academic honors received | Text; write in full | Paired with each education row | Value or N/A | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C1; S4 Educational Background |

#### Citizenship country list

`S3` embeds the country values used by its citizenship control. The reviewed
workbook contains 204 display values, including legacy or duplicate display
names and five entries with trailing source whitespace/encoding artifacts:
`Brunei`, `Samoa`, `Spain`, `Swaziland`, and `Thailand`. It also contains pairs
such as `East Timor` and `Timor-Leste`, `Korea, North` and `North Korea`,
`Korea, South` and `South Korea`, `Macedonia`, and `Swaziland`.

The readable value list below is the permitted-value map for this contract. The
reviewed workbook hash remains the provenance record; the contract does not
require storing malformed source whitespace in employee data. A later display
normalization proposal is a policy change and requires a new source review.

The values, in workbook order, are:

```text
Afghanistan; Albania; Algeria; Andorra; Angola
Antigua and Barbuda; Argentina; Armenia; Aruba; Australia
Austria; Azerbaijan; Bahamas, The; Bahrain; Bangladesh
Barbados; Belarus; Belgium; Belize; Benin
Bhutan; Bolivia; Bosnia and Herzegovina; Botswana; Brazil
Brunei; Bulgaria; Burkina Faso; Burma; Burundi
Cambodia; Cameroon; Canada; Cape Verde; Central African Republic
Chad; Chile; China; Colombia; Comoros
Congo, Democratic Republic of the; Congo, Republic of the; Costa Rica; Cote d'Ivoire; Croatia
Cuba; Curacao; Cyprus; Czech Republic; Djibouti
Dominica; Dominican Republic; East Timor; Ecuador; Egypt
El Salvador; Equatorial Guinea; Eritrea; Estonia; Ethiopia
Fiji; Finland; France; Gabon; Gambia, The
Georgia; Germany; Ghana; Greece; Grenada
Guatemala; Guinea; Guinea-Bissau; Guyana; Haiti
Holy See; Honduras; Hong Kong; Hungary; Iceland
India; Indonesia; Iran; Iraq; Ireland
Israel; Italy; Jamaica; Japan; Jordan
Kazakhstan; Kenya; Kiribati; Korea, North; Korea, South
Kosovo; Kuwait; Kyrgyzstan; Laos; Latvia
Lebanon; Lesotho; Liberia; Libya; Liechtenstein
Lithuania; Luxembourg; Macau; Macedonia; Madagascar
Malawi; Malaysia; Maldives; Mali; Malta
Marshall Islands; Mauritania; Mauritius; Mexico; Micronesia
Moldova; Monaco; Mongolia; Montenegro; Morocco
Mozambique; Namibia; Nauru; Nepal; Netherlands
Netherlands Antilles; New Zealand; Nicaragua; Niger; Nigeria
North Korea; Norway; Oman; Pakistan; Palau
Palestinian Territories; Panama; Papua New Guinea; Paraguay; Peru
Philippines; Poland; Portugal; Qatar; Romania
Russia; Rwanda; Saint Kitts and Nevis; Saint Lucia; Saint Vincent and the Grenadines
Samoa; San Marino; Sao Tome and Principe; Saudi Arabia; Senegal
Serbia; Seychelles; Sierra Leone; Singapore; Sint Maarten
Slovakia; Slovenia; Solomon Islands; Somalia; South Africa
South Korea; South Sudan; Spain; Sri Lanka; Sudan
Suriname; Swaziland; Sweden; Switzerland; Syria
Taiwan; Tajikistan; Tanzania; Thailand; Timor-Leste
Togo; Tonga; Trinidad and Tobago; Tunisia; Turkey
Turkmenistan; Tuvalu; Uganda; Ukraine; United Arab Emirates
United Kingdom; Uruguay; Uzbekistan; Vanuatu; Venezuela
Vietnam; Yemen; Zambia; Zimbabwe
```

### Page 2, Items 27 and 28

| Item and field | Type and permitted values | Cardinality and order | Requiredness and condition | Handling class | Default read scope | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 27. Eligibility name/category | Text with visible categories: Career Service, RA 1080 (Board/Bar), Under Special Laws, CES/CSEE, Barangay Eligibility, Driver's License | `0..n`; display in entered order; continuation C7 | Value or N/A per row | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C2; S4 Eligibility |
| 27. Rating | Text or decimal as reported; `If Applicable` | Paired with eligibility row | Conditional when the eligibility has a rating | sensitive | own, HR; sup only when required for staffing; DPO controlled; audit metadata only | S3 C2; S4 Eligibility |
| 27. Date of examination/conferment | Date | Paired with eligibility row | Value or N/A | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C2; S4 Eligibility |
| 27. Place of examination/conferment | Text | Paired with eligibility row | Value or N/A | ordinary | own, HR; sup only for approved operational purpose; DPO controlled; audit metadata only | S3 C2; S4 Eligibility |
| 27. License number | Text identifier | Paired with eligibility row | Conditional when a license applies | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C2; S4 Eligibility |
| 27. License date of validity | Date | Paired with license number | Conditional when a license applies | sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C2; S4 Eligibility |
| 28. Inclusive dates | Date pair; workbook label `mm/dd/yyyy`, guide examples `dd/mm/yyyy`; the source does not define a PDS open-end token | `0..n`; current or most recent first; continuation C8 | Value or N/A; handling of an unknown finish date is unresolved until the display profile is selected | sensitive | own, HR; sup only minimum staffing fields; DPO controlled; audit metadata only | S3 C2; S4 Work Experience |
| 28. Position title | Text; write in full and do not abbreviate | Paired with work row | Value or N/A | ordinary | own, HR; sup assigned scope | S3 C2; S4 Work Experience |
| 28. Department/agency/office/company | Text; write in full and do not abbreviate | Paired with work row | Value or N/A | ordinary | own, HR; sup assigned scope | S3 C2; S4 Work Experience |
| 28. Monthly salary | Money; guide example `P21,877.00` | Paired with work row | Value or N/A; no source rounding rule | sensitive | own, HR; DPO controlled; no sup by default; audit metadata only | S2; S3 C2; S4 Work Experience |
| 28. Salary/job/pay grade and step increment | Text; format example `00-0`, such as `24-2` | Paired with work row | Conditional when applicable | sensitive | own, HR; DPO controlled; sup only when staffing requires; audit metadata only | S2; S3 C2; S4 Work Experience |
| 28. Status of appointment | Text; source examples `permanent`, `temporary`, `casual`, `contractual`; examples are not exhaustive | Paired with work row | Value or N/A | sensitive | own, HR; sup assigned scope; DPO controlled; audit metadata only | S3 C2; S4 Work Experience |
| 28. Government service | Visible enum `Y` or `N` | Paired with work row | Value or N/A | sensitive | own, HR; sup assigned scope; DPO controlled; audit metadata only | S3 C2; S4 Work Experience |

The PDS work section includes private and government work experience. The PDS
row is the complete history record. The WES is a separate, vacancy-specific
subset and narrative attachment; it is not a replacement for Item 28.

### Page 3, Items 29 to 33

| Item and field | Type and permitted values | Cardinality and order | Requiredness and condition | Handling class | Default read scope | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 29. Voluntary organization name and address | Text; write organization name in full | `0..n`; continuation C9; preserve entered sequence | Value or N/A per row | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 Voluntary Work |
| 29. Voluntary work dates | Date pair `dd/mm/yyyy` in guide examples | Paired with voluntary row | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 Voluntary Work |
| 29. Number of hours | Decimal | Paired with voluntary row | Value or N/A; source gives no range | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 Voluntary Work |
| 29. Position/nature of work | Text | Paired with voluntary row | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 Voluntary Work |
| 30. L&D intervention/training title | Text; write title in full | `0..n`; most recent first; continuation C10 | Value or N/A per row | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 L&D |
| 30. L&D attendance dates | Date pair `dd/mm/yyyy` in guide examples | Paired with L&D row | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 L&D |
| 30. Number of hours | Decimal | Paired with L&D row | Value or N/A; source gives no range | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 L&D |
| 30. Type of L&D | Text; source examples `Managerial`, `Supervisory`, `Technical`, and `etc.`; not an exhaustive CSC enum | Paired with L&D row | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 L&D |
| 30. Conducted/sponsored by | Text; institution, agency, or sponsor in full | Paired with L&D row | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 L&D |
| 31. Special skills and hobbies | Narrative text | `0..1`; before Item 32 | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 Other Information |
| 32. Non-academic distinctions/recognition | Narrative text; write in full | `0..1`; after Item 31 | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 Other Information |
| 33. Association/organization membership | Narrative text; write in full | `0..1`; after Item 32 | Value or N/A | ordinary | own, HR; sup assigned scope only when needed; DPO controlled; audit metadata only | S3 C3; S4 Other Information |

### Page 4, Items 34 to 42

| Item and field | Type and permitted values | Cardinality and order | Requiredness and condition | Handling class | Default read scope | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 34a. Related by consanguinity or affinity within third degree | Boolean `Yes` or `No`, plus details when `Yes` | `1`; first declaration sub-question | Always answer; details conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 34b. Related by consanguinity or affinity within fourth degree for an LGU career employee | Boolean `Yes` or `No`, plus details when `Yes` | `1`; after 34a | Always answer; condition applies to LGU career employees | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 34. Relationship details | Narrative text | `0..1`; follows the applicable 34a/34b answer | Conditional when a related person exists | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 35a. Administrative offense finding | Boolean `Yes` or `No`, plus details when `Yes` | `1`; after Item 34 | Always answer; details conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 35b. Criminal charge before a court | Boolean `Yes` or `No`, plus details when `Yes` | `1`; after 35a | Always answer; details conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 35b. Criminal case details | Narrative text | `0..1`; follows 35b answer | Conditional when charged | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 35b. Date filed | Date | `0..1`; follows case details | Conditional when known; source provides `Don't Know` alternative | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 35b. Date filed unknown | Visible `Don't Know` choice | `0..1`; mutually exclusive with date | Conditional when applicant does not know the filing date | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4 |
| 35b. Status of case | Text | `0..1`; follows date or `Don't Know` | Conditional when charged | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4 |
| 36. Conviction of crime or violation | Boolean `Yes` or `No`, plus details when `Yes` | `1`; after Item 35 | Always answer; details conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 37. Separation from service | Boolean `Yes` or `No`, plus details when `Yes` | `1`; after Item 36 | Always answer; details conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 37. Separation mode | Visible examples: resignation, retirement, dropped rolls, dismissal, termination, end of term, finished contract, phased out/abolition | `0..1`; within separation details | Conditional when separated; visible examples are the source choices/examples | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4 |
| 38a. Election candidacy in the last year | Boolean `Yes` or `No`, plus details when `Yes` | `1`; after Item 37 | Always answer; excludes barangay election in prompt | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 38b. Resigned from government service within three months before last election | Boolean `Yes` or `No`, plus details when `Yes` | `1`; after 38a | Always answer; details conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 39. Immigrant or permanent resident of another country | Boolean `Yes` or `No`, plus country/details when `Yes` | `1`; after Item 38 | Always answer; country conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 40a. Indigenous group membership | Boolean `Yes` or `No`, plus group when `Yes` | `1`; first Item 40 sub-question | Always answer; group conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 40b. Person with disability | Boolean `Yes` or `No`, plus specification and ID No. when `Yes` | `1`; after 40a | Always answer; specification and ID conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 40c. Solo parent | Boolean `Yes` or `No`, plus specification and ID No. when `Yes` | `1`; after 40b | Always answer; specification and ID conditional | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Other Information |
| 41. Reference name | Text; person must not be related by consanguinity or affinity; guide format `FIRST NAME, MI, SURNAME` | `0..3`; the workbook provides three visible rows; no continuation sheet is provided | Value or N/A per visible reference row; handling of more than three is unresolved | sensitive | own, HR; DPO controlled; no sup; audit metadata only | S3 C4; S4 References |
| 41. Reference office/residential address | Text | Paired with one of the three reference rows | Value or N/A | sensitive | own, HR; DPO controlled; no sup; audit metadata only | S3 C4; S4 References |
| 41. Reference contact No. and/or email | Text phone or email | Paired with one of the three reference rows | Value or N/A | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 References |
| 42. Truth, correctness, and completeness declaration | Fixed legal declaration text from the form; rendered as a signed attestation | `1`; after references | Required before employee certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Authorization to verify and validate | Fixed declaration authorizing agency head or authorized representative | `1`; within Item 42 | Required before employee certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Misrepresentation warning | Fixed declaration about administrative/criminal consequences for misrepresentation | `1`; within Item 42 | Required before employee certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Passport-sized photo | Image; unfiltered digital picture, 4.5 cm x 3.5 cm, taken within the last six months | `1`; Item 42 photo area | Required by the form and guide before certification; absence blocks certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Government-issued ID type | Text; source examples include Passport, GSIS, SSS, PRC, and Driver's License | `1`; before ID number | Required for certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Government-issued ID/license/passport number | Text identifier | `1`; after ID type | Required for certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Government ID date and place of issuance | Date plus text place | `1` group; after ID number | Required for certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Employee e-signature/digital certificate | Signature or certificate evidence | `1`; signature box | Required on the certification page; right thumbmark is the alternate for a person unable to sign | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Employee date accomplished | Date | `1`; after signature | Required for certification | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Right thumbmark | Biometric image or controlled evidence | `0..1`; alternate to signature | Conditional for a person unable to sign | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Subscribed and sworn block | Oath text, valid ID confirmation, and administering-oath details | `1`; last certification block | Required in the certified PDS output; the exact agency/notarial completion process is unresolved | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |
| 42. Person administering oath | Text identity and signature/e-signature area as rendered by the form | `1`; last field | Required in the certified PDS output; the exact signature mechanism is unresolved | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S3 C4; S4 Certification |

### Page and continuation contract

| Sheet | Printed content | Output order | Signature requirement | Source |
| --- | --- | --- | --- | --- |
| `C1` | Personal Information, Family Background, Educational Background, Items 1 to 26 | Page 1 of the four-page main PDS | Employee e-signature/digital certificate and date at bottom | S3 C1; S4 |
| `C2` | Civil Service Eligibility and Work Experience, Items 27 to 28 | Page 2 of the four-page main PDS | Employee e-signature/digital certificate and date at bottom | S3 C2; S4 |
| `C3` | Voluntary Work, L&D, Other Information, Items 29 to 33 | Page 3 of the four-page main PDS | Employee e-signature/digital certificate and date at bottom | S3 C3; S4 |
| `C4` | Declarations, References, Certification, Items 34 to 42 | Page 4 of the four-page main PDS | Employee e-signature/digital certificate and date at bottom; Item 42 signature or thumbmark as applicable | S3 C4; S4 |
| `C5` | Family Background continuation | After C4, only when additional family rows exist | Employee e-signature/digital certificate and date | S3 C5; S4 |
| `C6` | Educational Background continuation | After C5, only when additional education rows exist | Employee e-signature/digital certificate and date | S3 C6; S4 |
| `C7` | Eligibility continuation | After C6, only when additional eligibility rows exist | Employee e-signature/digital certificate and date | S3 C7; S4 |
| `C8` | Work Experience continuation | After C7, only when additional work rows exist | Employee e-signature/digital certificate and date | S3 C8; S4 |
| `C9` | Voluntary Work continuation | After C8, only when additional voluntary rows exist | Employee e-signature/digital certificate and date | S3 C9; S4 |
| `C10` | L&D continuation | After C9, only when additional L&D rows exist | Employee e-signature/digital certificate and date | S3 C10; S4 |
| `C11` | Other Information continuation | After C10, only when additional other information exists | Employee e-signature/digital certificate and date | S3 C11; S4 |

The system may normalize the data, but the official export must preserve this
section order, field order, item numbers, continuation order, revision label,
and signature/date placement. The system must not emit a continuation page that
has no additional information.

## Work Experience Sheet contract

### Source-backed WES fields

`S7` is a narrative attachment, not a database schema. Its instructions say to
include only work experiences relevant to the position being applied for and to
list the most recent first.

| WES field | Type and permitted values | Cardinality and order | Requiredness and condition | Handling class | Default read scope | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Duration | Narrative duration; start and finish if known, abbreviated month if known, full year; current work uses `Present` | `1` per WES entry; most recent first | Required for each included experience | sensitive | own, HR; sup only for vacancy-related need; DPO controlled; audit metadata only | S7; S4 WES instruction |
| Position | Text | `1` per WES entry | Required for each included experience | ordinary | own, HR; sup assigned vacancy scope | S7 |
| Name of Office/Unit | Text | `1` per WES entry | Required for each included experience | sensitive | own, HR; sup assigned vacancy scope; DPO controlled; audit metadata only | S7 |
| Immediate Supervisor | Text | `1` per WES entry | Required for each included experience | sensitive | own, HR; DPO controlled; no sup by default; audit metadata only | S7 |
| Name of Agency/Organization and Location | Text | `1` per WES entry | Required for each included experience | ordinary | own, HR; sup assigned vacancy scope | S7 |
| Accomplishments and Contributions | Narrative text, `if any` | `0..1` per WES entry | Conditional when there are accomplishments or contributions | ordinary | own, HR; sup assigned vacancy scope; DPO controlled; audit metadata only | S7 |
| Summary of Actual Duties | Narrative text | `1` per WES entry | Required for each included experience | sensitive | own, HR; sup assigned vacancy scope; DPO controlled; audit metadata only | S7 |
| Employee/applicant signature over printed name | Signature evidence plus printed name | `1` per WES artifact | Required before WES submission; whether it must be a digital certificate is unresolved | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S7 |
| WES date | Date | `1` per WES artifact | Required before WES submission | highly-sensitive | own, HR; DPO controlled; audit metadata only; no sup | S7 |

### Project WES relationship and integrity rules

These rules make the narrative attachment executable without treating the WES
as an independent or ambiguous work-history source:

1. Every WES artifact belongs to exactly one employee, one agency, one vacancy
   application context when applicable, and one PDS version.
2. Every WES entry points to exactly one `work_experience_record` in the same
   PDS version. The database relationship must enforce the same
   `agency_id` and `pds_version_id` on both sides.
3. Within one WES artifact, a work row may be linked at most once. A work row
   may appear in separate WES artifacts for separate vacancy applications.
4. A WES entry without a parent PDS work row is invalid. A WES entry whose
   narrative identifies multiple possible parent rows is invalid until the
   employee or HR resolves it. Do not match by employer name alone.
5. A PDS work row may be omitted from a vacancy-specific WES because the WES is
   a relevant-work subset. The PDS Item 28 history remains complete, subject to
   the employee's certification.
6. When the project marks the parent work row as current, WES renders its
   duration as `Present` under the H-2 instruction. The PDS stores the work
   dates structurally and does not inherit the WES display token automatically.
7. WES entries render most recent first. If dates are too incomplete to order
   two entries deterministically, require an explicit sequence or correction;
   do not infer an order from text.
8. A WES correction must create a successor WES artifact. A certified WES
   narrative is not edited in place.
9. If its parent PDS version is superseded, the WES remains a historical output
   of the old version. A new current WES must point to the successor PDS version.
10. The WES template identifier is `CS_FORM_212_ATTACHMENT_WES_ORAOHRA_2025_H2`
    until CSC publishes a newer official template. This is a project identifier,
    not a claim that the 2025 template is the final national policy forever.

### WES output layout

Annex H-2 defines a standalone narrative attachment. Its source layout is:

1. `Attachment to CS Form No. 212`.
2. The title `WORK EXPERIENCE SHEET`.
3. The two numbered instructions covering relevant work only and duration/order
   formatting.
4. One narrative entry per selected work row, with Duration, Position, Name of
   Office/Unit, Immediate Supervisor, Name of Agency/Organization and Location,
   List of Accomplishments and Contributions (if any), and Summary of Actual
   Duties.
5. `Signature over Printed Name of Employee/Applicant`.
6. `Date`.

The source includes an illustrative sample for a Supervising Administrative
Officer application. The sample is template guidance, not applicant data, and
must not be copied into a certified employee WES. `S7` defines no fixed page
count, page footer, continuation sheet, or table row capacity. The product may
paginate a long narrative, but any continuation label or pagination rule is an
agency/product decision and must not be presented as CSC layout.

## Certification, verification, return, and correction

### Source-backed behavior

- The employee attests that the PDS was personally accomplished and is true,
  correct, and complete under applicable laws, rules, and regulations.
- The employee authorizes the agency head or authorized representative to
  verify and validate the contents.
- The form warns that misrepresentation in the PDS or attachments can result in
  administrative or criminal cases.
- The employee's e-signature or digital certificate and date appear at the
  bottom of every PDS page. Item 42 also has a certification signature/date and
  a right-thumbmark alternative for a person unable to sign.
- The WES source requires the employee/applicant signature over printed name and
  a date. The reviewed 2026 guide does not state that the WES signature must use
  the same digital-certificate mechanism as each PDS page.

### Project lifecycle contract

The following workflow is a project decision required to implement the source
behavior. It extends the current draft model with an explicit returned state.

| State | Meaning | Allowed transition |
| --- | --- | --- |
| `DRAFT` | Employee or authorized HR preparer is collecting or correcting data; no certification effect | `SUBMITTED` when completeness checks pass |
| `SUBMITTED` | Employee has submitted the version for HR verification | `RETURNED` with a reason, or `CERTIFIED` after employee certification and HR verification |
| `RETURNED` | HR has rejected the submission for correction; the prior submitted snapshot and return reason remain audit-visible | `SUBMITTED` after correction and re-attestation |
| `CERTIFIED` | Employee certification and HR verification are complete; output is the authoritative version for its revision and as-of date | `SUPERSEDED` only after a successor is certified |
| `SUPERSEDED` | Historical certified version replaced by a certified successor | Terminal |

Required lifecycle rules:

- Employee certification is a self-attestation. HR verification is a separate
  action with actor and timestamp. Do not treat HR verification as a substitute
  for the employee's certification.
- A return records the actor, timestamp, reason, and the submitted snapshot. A
  returned version may be edited only through the normal draft correction path.
- A certified version cannot be updated, deleted, or silently re-rendered from
  changed source data.
- Correcting a certified version creates a new version with
  `supersedes_version_id`, a correction reason, and a new certification cycle.
  The old version changes to `SUPERSEDED` only after the successor is
  certified. Until then, the old certified version remains current.
- `version_no` is unique per employee within an agency. `form_version` records
  `CS_FORM_212_REVISED_2026` exactly. The WES records its own template version.
- Every issued PDS or WES output stores the source artifact identifier and
  hash, PDS version ID, data as-of date, status, page or section mapping, and
  signature metadata. Raw signature, thumbmark, photo, and government-ID
  content do not belong in ordinary audit events.
- No certified output may mix a Revised 2025 PDS with a Revised 2026 PDS under
  one `form_version`. A 2025 transition submission and a 2026 submission are
  distinct revisioned outputs.

### Completeness gates

Before `SUBMITTED`:

- all source fields are present as a value or explicit `N/A`;
- conditional details are present when their trigger is selected;
- repeated rows have stable sequence values and no blank rendered rows;
- date pairs are internally ordered when both dates are known;
- education rows preserve school-year text where entered;
- every WES entry has one unambiguous parent work row;
- the selected PDS revision and WES template revision are recorded.

Before `CERTIFIED`:

- every PDS page has the required employee signature mechanism and date;
- Item 42 has the required declaration, ID details, photo, and signature or
  thumbmark under the applicable source condition;
- the subscribed-and-sworn block and person administering oath are completed;
  the unresolved agency/notarial process determines the capture mechanism, not
  whether the official block is rendered;
- HR verification has actor, timestamp, and agency scope;
- a return or correction reason is resolved;
- any vacancy-specific WES has employee/applicant signature and date.

## Rendering and historical output contract

### PDS

- Render the four main pages in `C1` through `C4` order.
- Render non-empty continuations in `C5` through `C11` order.
- Preserve the header `CS Form No. 212, Revised 2026, Personal Data Sheet`,
  item numbers, section names, column labels, revision label, and main-page
  footer `CS FORM 212 (Revised 2026), Page N of 4`.
- Preserve the source warning that misrepresentation in the PDS or WES can
  result in administrative or criminal cases, along with the guide reference,
  checkbox instructions, and `DO NOT ABBREVIATE` instruction.
- Preserve the source page layout for signatures and dates. A signature applied
  only to the final page does not satisfy the guide's every-page instruction.
- Render `N/A` rather than an empty field when the source rule requires an
  inapplicable value.
- Render current work as `Present` only in the WES narrative when the project
  has explicitly marked the parent work row current. Do not use `Present` as a
  PDS date value until the date-display conflict is resolved.
- Keep photo dimensions at 4.5 cm by 3.5 cm and reject unapproved filters or
  transformations that change the certified image.

### Date conflict

The source conflict is concrete:

- `S3` Item 28 and C8 display `mm/dd/yyyy`.
- `S4` instructs `dd/mm/yyyy` for PDS dates, including work examples.

Until CSC or the pilot agency resolves this, the implementation stores dates in
unambiguous ISO form (`YYYY-MM-DD`), records the source-entry/display profile,
and either:

1. renders the exact official workbook label while accepting both unambiguous
   source-compatible inputs with explicit validation; or
2. blocks issuance behind an agency-selected display profile.

It must not reinterpret an ambiguous value such as `03/04/2026` without an
explicit profile.

### WES

- Render WES as a separate attachment to the PDS, not as an additional PDS
  page or an Item 28 replacement.
- Begin with `Attachment to CS Form No. 212`, the `WORK EXPERIENCE SHEET` title,
  and the two H-2 instructions. Render one narrative block per selected work
  row in the H-2 field order, followed by the employee/applicant signature over
  printed name and date.
- Include only the entries relevant to the vacancy or application context.
- Render most recent first and use `Present` for an ongoing work period.
- Preserve the narrative fields from Annex H-2, including immediate supervisor,
  accomplishments, and actual duties.
- Show the employee/applicant signature over printed name and WES date.
- Do not include the illustrative H-2 sample as employee data. There is no
  source-defined WES continuation sheet or page-count contract.
- Preserve the WES template identifier and source hash in output metadata.

## Product handling and access contract

### Handling classes

| Class | Product meaning | Examples |
| --- | --- | --- |
| ordinary | Professional or participation facts whose disclosure has lower expected harm, but which remain part of a restricted personnel record | Education, eligibility name/rating/place, skills, honors, associations, voluntary work, L&D, position and employer names |
| personal | Direct identity or personal-context fields | Name, height, weight |
| sensitive | Personal, family, contact, employment, compensation, or reference facts needing restricted role access | Birth data, sex at birth, civil status, citizenship, blood type, addresses, contacts, family data, salary, appointment status, work dates, supervisor, references |
| highly-sensitive | Identifiers, credentials, biometrics, signatures, images, protected-status identifiers, and case or disciplinary declarations | UMID, Pag-IBIG, PhilHealth, PCN, TIN, ID issuance data, photo, thumbmark, signature, administrative/criminal case answers, PWD/solo-parent IDs |

### Role matrix

| Role or scope | Read | Update | Certify/verify | Explicit exclusions |
| --- | --- | --- | --- | --- |
| Employee, own record | Own PDS and own WES drafts and certified history | Own draft and returned versions; may submit correction | Own employee certification; cannot perform HR verification | No other employee's PDS; no bypass of immutable certified output |
| HRMO Admin / Personnel Officer, agency | Full PDS and WES data within agency role and purpose | Create or update permitted draft data; record returns and corrections | HR verification; may certify only the HR side of the workflow | Cannot overwrite employee certification or change a certified version |
| Supervisor, assigned/direct report | Minimum operational fields needed for assigned work or vacancy review; normally position, employer, dates, qualifications, and relevant WES | None by default | None | No IDs, photo, signature, thumbmark, declarations, family, private contacts, salary, or full case details by default |
| Records Officer | Certified output, document metadata, retention and access records when assigned | Records classification or retention actions allowed by policy | None | No broad editing of PDS values; no raw high-risk fields unless explicitly assigned |
| DPO | Classification, access events, privacy review, and approved data subject or incident scope | No ordinary PDS editing | No PDS certification | Value access is purpose-bound; no unrestricted browsing |
| Auditor | Sanitized version, status, actor, timestamps, access events, and evidence references | None | None | No raw identifiers, signatures, photos, thumbmarks, or declaration content by default |
| Payroll or other consuming role | No direct full-PDS access | None | None | Use a specific, least-privilege contract for the required field; do not grant `personnel.pds.read` wholesale |

This contract refines the baseline permissions in
`docs/hris-controls.md`: `personnel.pds.read` remains role-gated, and sensitive
PDS fields require field-level authorization even when a role has general PDS
read access. Employee, HR, DPO, auditor, and supervisor scopes are not implied
by a row-level database foreign key alone.

### Audit and document rules

- Audit events record action, actor, agency, PDS/WES version, field group,
  purpose, result, and timestamp. They do not copy raw PDS values or binary
  evidence.
- Photos, signatures, thumbmarks, government IDs, WES attachments, and other
  evidence use the shared `Document` and `DocumentVersion` foundation from
  `docs/technical-architecture.md` and the existing database schema. Do not
  create a second document store for PDS.
- Agency isolation applies to every PDS, WES, continuation, evidence, and
  audit lookup. A linked WES entry must not cross agency or PDS version
  boundaries.
- A certified output is a records artifact. Deletion is not a correction
  mechanism; retention and destruction follow the agency records policy and
  approved holds.

## Delta from the current repository models

The following draft documents are inputs, not authority for Revised 2026:

| Current path or model | Current coverage | Contract delta | Owning ticket |
| --- | --- | --- | --- |
| `research/official-forms-security-records-baselines.md` | Describes 2025 PDS and WES revisions | Treat its PDS/WES revision statements as superseded for this work; retain other research findings until separately updated | #101 to #104; follow-up research if needed |
| `docs/conceptual-erd.md` PDS section | Generic `EMPLOYEE` and `PDS_VERSION` concepts | Add the Revised 2026 version identifier, complete section coverage, WES relationship, and immutable output semantics in implementation design | #101 to #104 |
| `docs/data-model/appointment-and-personnel-logical-erd.md` `pds_versions` | Draft version header with `DRAFT`, `SUBMITTED`, `CERTIFIED`, `SUPERSEDED` | Add explicit returned workflow, successor link and correction reason, per-page certification evidence, and form/template identifiers | #104 |
| Logical `pds_personal_details` | Names, birth data, sex, civil status, citizenship, addresses, contacts | Add name extension, height, weight, blood type, five identifiers, agency employee number, citizenship mode/country, complete address components, and email/phone distinctions | #101 |
| Logical `pds_family_records` | Relationship, full name, birth date, occupation, employer | Add spouse name components, employer business name/address/telephone, child ordering, father/mother name components, and all continuation behavior | #101 |
| Logical `education_records` | Five levels, school, course, period dates, units, year, honors | Store school-year attendance text without forcing date semantics; preserve full labels, sequence, continuations, and education conditional behavior | #102 |
| Logical `eligibility_records` | Name, rating, exam date/place, license number/validity, one document link | Add visible categories, conferment terminology, continuation/order, source-compatible date handling, and evidence relationship per record | #102 |
| Logical `work_experience_records` | Dates, position, employer, salary, grade/step, status, government flag | Add source display/date conflict handling, sequence, full department/company label, WES link, vacancy-specific subset semantics, and `Present` rendering rule | #103 |
| Logical `training_records` | Title, dates, hours, type, sponsor, certificate | Rename the implementation seam to L&D where appropriate, preserve source examples, continuation/order, and retain evidence through shared documents | #103 |
| Physical PDS schema | Concrete `pds_versions` and one education example; other sections described as future equivalent tables | Define all repeated sections and integrity constraints from this contract; no table-by-table SQL is part of #96 | #101 to #104 |
| Physical migration order | Treats PDS as a broad later migration area | Sequence PDS children after the contract and keep certified-version immutability and agency composite keys | #101 to #104 |
| `docs/mvp-workflows.md` | Describes PDS after assumed appointment/import | Reconcile with #95: appointment preparation and activation remain #9; PDS children consume the Employee/Personnel Baseline boundary rather than creating synthetic appointments | #8 and #9 follow-up |
| `docs/hris-controls.md` | Baseline `personnel.pds.*` permissions | Add field-group policy, supervisor minimum scope, DPO/audit sanitization, and no raw high-risk audit values | #101 to #104 |
| Shared `Document` / `DocumentVersion` | Existing document foundation | Reuse for photo, signatures, thumbmark, IDs, certificates, and WES evidence; no second foundation | #102 to #104 |
| API, web, worker, Prisma | No Employee/PDS/WES implementation models or routes | No application code, migrations, or UI changes belong in #96; later tickets implement the seams below | #101 to #104 |

The existing draft does not cover voluntary work, other information, declarations,
references, photo, government ID, per-page signatures, certification, correction,
or WES. Those omissions are implementation gaps, not permission to drop the
official fields.

## Implementation seams and ticket changes

The smallest executable decomposition is the four PDS children already named by
the Phase 5 specification:

| Ticket | Seam | Must include | Must not include |
| --- | --- | --- | --- |
| #101 | PDS version, Personal Information, Family Background | `PDSVersion`, complete Items 1 to 25, exact country snapshot, child/spouse ordering, field-level access, draft/returned editing, shared document references where needed | Appointment creation, appointment status authority, synthetic service segments |
| #102 | Educational Background and Civil Service Eligibility | Item 26 and Item 27, school-year representation, eligibility categories, license fields, continuation sheets, evidence links, sequence and source dates | WES narrative, work-history rows, employee activation |
| #103 | Work Experience, WES, Voluntary Work, L&D | Item 28, complete PDS work history, WES artifact and exact parent links, relevant-work subset, current `Present`, Items 29 and 30, continuation sheets | Appointment decisions, employee identity creation, unrelated training catalogs |
| #104 | Other Information, declarations, references, certification, correction, output | Items 31 to 42, cases and protected-status fields, photo/ID/signature evidence, per-page attestations, return/correction/supersession, PDS/WES versioned rendering | New document foundation, direct CSC submission integration, unapproved pilot-policy rules |

Ticket sequencing:

1. #101 establishes `PDSVersion` and the employee-scoped version boundary.
2. #102 and #103 add normalized repeated sections under that boundary.
3. #104 closes the certification and historical-output boundary needed to call
   any version authoritative.

The PDS children depend on the stable Employee and Personnel Baseline boundary
from #95. #9 remains responsible for appointment preparation, CSC appointment
tracking, oath, assumption, and new-appointee activation. It must not write
PDS data as an appointment side effect or use WES as appointment authority.

Issues #6 and #7 are closed earlier phases and are not changed by this contract.
Issue #8 remains the phase parent and must use this contract for its PDS child
scope. The actionable PDS changes for the current Phase 5 plan are #101 to #104.

## Unresolved questions and policy gates

The following are deliberately separated from authoritative facts. Do not code
an answer without a pilot-agency or CSC decision.

| Question | Why it matters | Blocking owner |
| --- | --- | --- |
| What is the Official Gazette or newspaper publication date for MC No. 05, s. 2026? | Determines circular effectivity and the exact end of the three-month Revised 2025 transition | CSC source confirmation / product owner |
| Will CSC publish a standalone Revised 2026 WES? | Determines whether `CS_FORM_212_ATTACHMENT_WES_ORAOHRA_2025_H2` remains the active template identifier | CSC source watch |
| Does the Revised 2026 WES signature require e-signature or digital certificate? | The PDS guide requires per-page e-signatures, while H-2 only states signature over printed name and date | CSC or pilot agency |
| Which date display profile should be used? | Workbook Item 28 says `mm/dd/yyyy`; guide examples say `dd/mm/yyyy` | CSC or pilot agency |
| Is PDS/WES required for an existing Personnel Baseline employee, or only for a vacant-position application? | The guide explicitly ties WES to a vacant-position application but does not define the pilot agency's broader PDS intake workflow | Pilot agency HR policy |
| Who may prepare a draft for an employee and who may act as HR verifier? | The source defines employee certification and agency verification but not the application's role assignment | Pilot agency HR policy |
| What digital signature provider, certificate validation, and revocation evidence are accepted? | The source says e-signature/digital certificate but does not define technology or trust service | Pilot agency security and legal policy |
| What retention, return SLA, hold, and destruction rules apply to PDS/WES evidence? | CSC forms do not supply the pilot agency's complete records schedule | Agency records officer / NAP-approved policy |
| Should the system preserve the workbook's country display artifacts or present a corrected display label? | The workbook list contains duplicates and encoding artifacts | Pilot agency decision, with source version retained |
| What exact PDF/Excel output fidelity is required for signed issuance? | The source provides a workbook, but the product's rendering and signature pipeline are not defined | Product owner and pilot agency |
| Are WES supervisor details and narrative duties visible to a supervisor reviewer? | H-2 includes them, but the source does not define HRIS role visibility | Pilot agency privacy policy |
| Does a PDS correction require a new WES for every vacancy context or only when linked work data changes? | A WES is a versioned, application-specific subset rather than a full PDS section | Product owner and pilot agency |

## Acceptance checklist

- [x] Primary CSC package, adoption issuance, Revised 2026 workbook, guide, and
  latest located WES identified with revision, retrieval date, URLs, and hashes.
- [x] Every PDS item and WES field is mapped to section, type, permitted values
  or source limitation, cardinality, order, requiredness, handling class, scope,
  and source ID.
- [x] Personal, sensitive, highly-sensitive, and ordinary handling classes are
  defined, with own-record, HR, DPO, audit, and supervisor access boundaries.
- [x] PDS work rows and WES entries have an explicit same-version, one-parent
  integrity contract that rejects orphaned and ambiguous WES data.
- [x] Employee certification, HR verification, return, correction,
  supersession, and historical output semantics are separated into source facts
  and project workflow decisions.
- [x] Main pages, continuation sheets, signatures, dates, photo, identifiers,
  oath block, and revision labels are mapped.
- [x] Current 2025 research and draft logical/physical models are called out as
  inputs with explicit Revised 2026 deltas.
- [x] Unresolved CSC and pilot-agency questions are separated from facts.
- [x] Implementation seams and required changes to the Phase 5 tickets are
  listed without adding SQL, migrations, UI, or a second ERD to this research
  task.
