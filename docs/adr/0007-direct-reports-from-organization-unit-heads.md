# ADR 0007: Direct reports come from Organization Unit heads

- Status: Accepted
- Date: 2026-10-04
- Scope: the `DIRECT_REPORTS` scope policy and the Supervisor role

## Context

`docs/hris-controls.md` grants Supervisors `S` (direct-report) scope across
Leave, Overtime, and SPMS. `docs/mvp-brd.md` names "office and supervisor" on
the Employee record and "reporting relationships" in ORG-002, but no source
says which record holds the relationship. The schema already records who heads
each Organization Unit: `organization_unit_versions.head_position_id` points
at a Plantilla Position, and `position_incumbencies` says who holds it. Both
are effective-dated.

## Decision

An Employee's Supervisor is the current incumbent of the head Plantilla
Position of the Organization Unit the Employee serves in. The head of a unit
reports to the head of its parent unit. The relationship is resolved from
records in effect on the date of the read: the Organization Unit Version with
an `ACTIVE` domain status, the Position Incumbency, and the Service Segment
whose effective period covers that date. A record closed early by an approved
future-dated change stays in effect until its end date; voided records never
count.

"Direct reports" means one level only. A Supervisor's direct reports are:

- Employees whose Service Segment is in a unit the Supervisor heads; and
- the incumbents of the head positions of that unit's immediate child units.

Employees in a child unit report to that child unit's head, not to the
Supervisor above. If the child unit's head position is vacant, its Employees
have no direct-report Supervisor until it is filled. A Supervisor is never
their own direct report.

The developer chose the Organization Unit head as the source on issue #445
after no CSC or BRD source defined the relationship. The developer confirmed
one level on issue #446 as the literal reading of "direct reports"; the whole
subtree below a Supervisor was considered and not chosen.

## Consequences

- No new table or maintenance screen: HR keeps the relationship current by
  maintaining the organization structure, Plantilla, and appointments.
- `findDirectReportEmployeeIds` in `apps/api/src/direct-reports.ts` is the one
  resolver for `DIRECT_REPORTS`; Leave recommendation, Overtime, and SPMS use
  it instead of their own rules.
- A Supervisor sees reports by who reports to them today, including the
  reports' records from earlier years.
- Delegated team members and acting heads are not covered; they need a
  separate decision.
- Every module resolves `DIRECT_REPORTS` through the Employee Scope module
  (ADR 0011), so a Supervisor `S` grant takes effect as soon as it is seeded.
  A service that checks only the permission code would still give a
  Supervisor Agency-wide access.
