# ADR 0014: A Payroll Period consumes its sources by cutoff, not by Work Date

- Status: Accepted
- Date: 2026-11-14
- Scope: which Attendance Payroll Facts, Payroll Inputs, and Authorized Payroll Component Inputs a Payroll Period uses (#328)

## Context

Attendance publishes facts without choosing a payroll period, and a Locked Attendance Adjustment publishes only deltas. An Agency sets its own payment date, which can fall before the month's attendance is locked. Matching sources to a period by Work Date would make a period wait for attendance that cannot exist yet, and would leave a late adjustment with no period to land in.

## Decision

A calculation uses every Payroll Input accepted, and every Attendance Payroll Fact published, at or before the period's `cutoff_at` that no finalized payroll has consumed. Each is consumed exactly once, by the first payroll finalized after it. Calculation cannot start before the cutoff. The Payroll Preparer may move the cutoff while the period is `DRAFT`, with an Audit Event, which is how a source fix made after the cutoff reaches a recalculation.

An Agency has at most one regular Payroll Period that is not `FINALIZED` or `VOIDED`. A special Payroll Period takes only sources for the components it names. Finalization rechecks that every source is still unconsumed and fails with a blocking exception if one is not.

The rejected alternative was matching by Work Date inside the coverage dates. It needs every Attendance Period in the month locked before payday, and a separate rule for adjustments.

## Consequences

- A June absence can reduce July pay. Leave without pay is valued at the monthly salary in effect on its Work Dates, so the amount does not depend on which period deducts it.
- An Attendance Period that ended before the cutoff and is not locked raises a warning, not a block. Its facts are consumed by the next period.
- A timestamp fixes the input set, so the same snapshot and cutoff reproduce the same calculation hash.
- An Employee under a Payroll Hold keeps their sources unconsumed until a later payroll includes them.
