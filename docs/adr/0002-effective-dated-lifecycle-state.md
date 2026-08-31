# ADR 0002: Preserve lifecycle status in effective-dated versions

- Status: Accepted
- Date: 2026-08-17
- Scope: Agency Profiles, Organization Units, Qualification Standards, and Plantilla Positions

## Context

These records have a stable identity, changing attributes, and lifecycle states whose historical effect must remain explainable. Keeping lifecycle status only on the stable record would overwrite history, while treating draft publication state and business lifecycle state as one value would conflate two independent concerns.

## Decision

Each effective-dated version records both its version state and the domain lifecycle status that applies during its effective period. Version state describes whether the version is `DRAFT`, `ACTIVE`, `SUPERSEDED`, or `VOIDED`; domain status describes the business condition of the record, such as an Organization Unit being inactive or a Plantilla Position being vacant.

Drafts may be edited, with at most one Draft successor per stable record in the MVP. Activated versions are immutable. Normal changes create successors; factual corrections void and replace the incorrect version with a recorded reason. Effective periods cannot overlap.

The stable record may expose the current domain status and current-version reference as transactionally maintained projections, but those projections are not the source of historical truth.

## Consequences

- Lifecycle changes remain reconstructable for any effective date.
- Version workflow cannot be mistaken for business workflow.
- Activation must update the prior version, successor, and current projections atomically.
- The Phase 4 physical schema must be revised before implementation because its current stable-record status fields do not preserve effective-dated lifecycle history.
