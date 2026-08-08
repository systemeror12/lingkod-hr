# Philippine Public-Sector HRIS

This glossary defines the canonical domain language for planning and building the Philippine public-sector HRIS.

## Agency Profiles

**Reference Agency Profile**:
A generic civilian National Government Agency configuration used to define and validate MVP capabilities before a specific participating agency is identified. It is not a source of authority for agency-specific procedures.
_Avoid_: Generic pilot agency, hypothetical pilot agency

**Pilot Agency**:
An identified agency participating in a controlled rollout, whose official documents and authorized representatives can supply agency-specific requirements.
_Avoid_: Reference agency, generic agency

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
