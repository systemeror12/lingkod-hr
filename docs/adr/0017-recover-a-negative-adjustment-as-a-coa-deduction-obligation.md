# ADR 0017: A negative Payroll Adjustment is recovered as a COA Deduction Obligation

- Status: Accepted
- Date: 2026-11-22
- Scope: how a regular Payroll Period carries a negative Payroll Adjustment (#648). Amends the last consequence of [ADR 0016](0016-payroll-corrections-are-recalculated-differences.md)

## Context

[ADR 0016](0016-payroll-corrections-are-recalculated-differences.md) left a negative Payroll Adjustment `OPEN` until #661 recorded how an Agency may recover an overpayment. [The research record](../research/salary-overpayment-recovery-authorities.md) settles part of it. A salary deduction for a debt to the National Government needs a final and executory COA decision (R6, R8). An Agency order, an audit finding, and a disallowance that is not yet final authorize nothing (R4, R5, R7). COA sets any installment schedule, on the Employee's request (R8, R10). The deduction comes after the statutory ones and never takes net take-home pay below the GAA floor (R6). What a period cannot take stays owed, and GSIS benefits and retirement pay are never applied (R10, R12, R13).

It leaves four points open. Consent without a COA decision, the date a COA-decreed obligation is incurred, the installment schedule in force (COA Res. 2017-021 was not read), and the FY 2027 deduction list and floor. #661 also named project questions it could not answer: who records the decision and how, how an adjustment settles across periods when ADR 0016 posts it in one, how it closes after a cash payment, and the severity of negative net pay.

The Deduction Obligation engine (#352, #634) already applies an issuer-validated obligation by priority and floor in each regular period, with the GAA's payee category `NATIONAL_GOVERNMENT_COA_DECISION`.

## Decision

A negative Payroll Adjustment is recovered only by the COA route, as a Deduction Obligation. There is no consent route; it stays blocked on the authority gap.

- A user with `payroll.deductions.manage` records the final and executory COA decision (its Notice of Finality of Decision or COA Order of Execution as the authority Document Version) as a Deduction Obligation payable to `NATIONAL_GOVERNMENT_COA_DECISION`. It names the adjustment it recovers, and the adjustment's Employee and Agency are its own.
- Its outstanding balance is the adjustment's recovery amount: the negative net difference of the `PAYROLL_ADJUSTMENT_NEGATIVE` warning in the latest calculation that carried the adjustment. The recorder does not enter it. The obligation names that warning.
- Its scheduled amount is the whole amount or the monthly amount COA approved, as recorded. Payroll computes no schedule and does not check the count or amount against COA's installment policy.
- **Project decision:** its date incurred is the date the COA decision became final and executory, when it first becomes deductible under R6. No authority fixes the date (#661, the research record's blocking points), so this is a project rule, not a reading. The existing order-incurred rule then places the recovery against loans.
- The adjustment becomes `POSTED`, with no posting period, in the transaction that records its obligation. From then on the obligation carries the balance. A carrying period that finds a negative adjustment with no recorded obligation keeps today's behavior: no line, the warning, and the adjustment stays `OPEN`. No adjustment state is added.
- No issuer reports a recovery's balance, so the balance a period applies is the obligation version's, less what `FINALIZED` results deducted against that version. A fully collected recovery is not due.
- A cash payment at the agency cashier is the obligation's existing change, with a reason, the official receipt as its authority, and the balance still owed; or its end when nothing is owed.
- Negative net pay stays a blocking exception (#623). A recovery never produces it, because the floor stops the deduction.

## Consequences

- The recovery lines are the obligation's `LOAN_DEDUCTION` Payroll Lines and Loan Deduction Lines. Each names the obligation, the obligation names the adjustment, and the line's `source_snapshot` names the adjustment too. They go through the carrying period's normal review and approval.
- Statutory first, the floor, what a period cannot take staying owed, no collection from an Employee with no later pay, and the block in a year with no `AUTHORIZED_DEDUCTIONS` version are the #634 engine's rules, unchanged.
- A later recalculation of the same past period counts a recovered adjustment's difference as settled, so the same overpayment is never recovered twice.
- An adjustment `POSTED` by a recovery has no `posted_by_payroll_period_id`. Voiding a period never returns it to `OPEN`, because no period carried it.
- Consent without a COA decision, the installment schedule in force, and the FY 2027 deduction list and floor stay blocked as the research record names them.

The rejected alternative was a separate recovery record with its own schedule, balance, and states. It would rebuild the priority, floor, and order-incurred rules the Deduction Obligation engine already applies, and need its own review path.
