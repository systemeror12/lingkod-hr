# ADR 0011: Resolve Employee Scope in one module

- Status: Accepted
- Date: 2026-11-10
- Scope: how the API decides which Employees a permission grant reaches

## Context

Row-level security enforces Cross-Agency Isolation and nothing narrower. Every limit below the Agency (own Employee, Direct Reports, assigned office) is application code. By November 2026 about twenty modules each decided what a grant reaches: twelve called `resolveEmployeeScope`, three kept hand copies of it, and six checked one record at a time through `canAccessRecord`. Each honoured a different subset of the scope policies, and "own" was matched three ways. ADR 0007 guarded against a module that ignored scope by giving the Supervisor role each grant only once its module resolved `DIRECT_REPORTS`.

## Decision

One module, `apps/api/src/employee-scope.ts`, answers the Employee Scope of a permission for the acting Agency Membership: no grant, the whole Agency, or an exact set of Employees. Every module asks it, inside the module's own transaction, instead of deciding a grant's reach itself.

Each scope policy resolves the same way for every caller:

- `AGENCY` reaches every Employee of the Agency.
- `OWN` reaches the Employee linked to the acting Agency Membership.
- `DIRECT_REPORTS` reaches the Direct Reports of that Employee (ADR 0007).
- `ASSIGNED_OFFICE` reaches Employees with an active Service Segment in the membership's primary Organization Unit. No source defines an assigned office; this carries the earlier rule unchanged until that is decided.
- `RESTRICTED` reaches nobody.

Approval decision authority stays with the approval module. It asks who may decide a step, sometimes about another Agency Membership, and shares only the Direct Report resolver. Each module keeps its own response when an Employee is outside the scope.

Rejected alternative: each module opts in to the scope policies it honours. The copies drifted, a module left out of a change kept an older rule without anyone deciding it should, and each new module started from a copy.

## Consequences

- What a role reaches is controlled by its seeded grants alone. The exclusions in `docs/hris-controls.md` §8.2 hold because the Supervisor role has no grant on those permissions, not because those modules refuse `DIRECT_REPORTS`.
- A new grant takes effect as soon as its migration runs, with no change to the owning module. Review a grant migration as an access change.
- A command that only checks that a permission is held, at any scope, still reaches every Employee. That check belongs to the route guard; a service asks for the Employee Scope or for an Agency-wide grant.
- This replaces the last consequence of ADR 0007.
