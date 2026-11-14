# ADR 0013: Hold National Payroll Rule Versions once, for the whole platform

- Status: Accepted
- Date: 2026-11-14
- Scope: where National Payroll Rule Versions and the pay component catalogue live, and who writes them (#328)

## Context

#27 made salary schedules, GAA component rules, contribution tables, and tax tables immutable National Payroll Rule Versions that an Agency never alters. The payroll schema still gave every rule table an `agency_id`, a `DRAFT` status, a `calculation_method`, and a JSON rule definition, and the Phase 9 spec had an HR Administrator maintaining rule versions. Per-Agency rows would be copies of national law that can drift, and an in-app editor would let an Agency user author it.

## Decision

A National Payroll Rule Version is one platform-wide row with no `agency_id`. The application role can only read it. The `hris_operator` command from ADR 0001 loads each version from a reviewed file that cites the research register, and a version is immutable from load: there is no draft and no in-app authoring. The pay component catalogue is platform-wide and loaded the same way.

Each rule kind has one calculator in code. A version carries only that kind's typed parameters, with its issuing authority, issuance reference, source link, verification date and verifier, effectivity, and the version it supersedes. No row holds a formula or a calculation method.

An unconditional rule applies to every Agency by its effectivity. An Agency acts only through Agency Payroll Applicability, for a conditional component.

Rejected alternatives:

- Per-Agency copies. Two Agencies could hold different text for the same issuance, and every correction would be a fan-out.
- Rules entirely in code. A new tranche or GAA year would need a release, and the snapshot would have no row to reference.
- An in-app editor for a platform role. It adds a role, screens, and a draft lifecycle for a few loads a year.

## Consequences

- Loading a rule is an operations task with a reviewed file, not a user workflow. #331 builds the load command and read access, not create, activate, and supersede screens.
- A rule's source is a link and citation, not a Document Version, because Documents are Agency-owned.
- A rule that rests on a fiscal year's GAA ends on 31 December and needs a successor. Until it is loaded, the affected calculation blocks in every Agency at once.
- The rule and catalogue tables are the first domain tables without Agency row-level security. Their protection is the grant: read-only for the application role.
