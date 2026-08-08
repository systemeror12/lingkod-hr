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
