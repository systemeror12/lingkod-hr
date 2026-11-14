# ADR 0016: Payroll corrections are recalculated differences, and a payroll is voided only before money moves

- Status: Accepted
- Date: 2026-11-14
- Scope: how a finalized Payroll Period is corrected (#330)

## Context

Finalized Payroll Lines are immutable, and no user overrides a calculated line (#27). The schema still named four correction types (`SUPPLEMENTAL`, `REFUND`, `RECOVERY`, `VOID_REPLACEMENT`) with no definitions and a separately approved adjustment whose amount someone would enter. An Employee left out under a Payroll Hold had no way to be paid, because a special Payroll Period calculates no basic salary.

## Decision

A finalized payroll is corrected by a Payroll Adjustment: Payroll recalculates one Employee's result for one past Payroll Period and keeps the line-by-line difference. No user enters an amount. The next regular Payroll Period carries each open adjustment as linked Payroll Lines, computes the difference in its own calculation, and takes it through its own review chain. A special Payroll Period may name adjustments to pay positive ones earlier.

The same mechanism pays an Employee under a Payroll Hold (an adjustment against an empty original), a salary differential from a retroactive rule or step increment, and a source correction on a consumed Payroll Input.

A payroll is voided and replaced only when the whole payroll is wrong and no money has moved. A void is refused once any Payment Instruction is `SUBMITTED`, `ACCEPTED`, or `SETTLED`, or when the Agency has a later regular period.

The rejected alternative was an entered adjustment: a user types the amounts with evidence and a second person approves. It is simpler to build, and it is the free-form pay item #27 ruled out.

## Consequences

- A correction's amount sits under the carrying period's calculation hash, so it can be reproduced and is reviewed like any other line.
- Payroll must be able to recalculate a past period for one Employee from the rules and facts on record for its dates.
- A wrong payroll that has already been paid is never replaced. Replacing it would pay everyone twice and then need netting.
- The four-value `adjustment_type` goes. Direction is the sign of the difference, and void is not an adjustment.
- A negative adjustment is a recovery. It stays open until #661 records how an Agency may recover an overpayment.
