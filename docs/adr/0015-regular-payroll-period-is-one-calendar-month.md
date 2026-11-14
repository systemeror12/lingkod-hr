# ADR 0015: A regular Payroll Period is one calendar month

- Status: Accepted
- Date: 2026-11-14
- Scope: the coverage and payment date of a regular Payroll Period (#328)

## Context

#27 lists the payroll calendar and cutoffs as Agency configuration, and no national rule on file fixes pay dates. Every sourced calculation rule is monthly: the salary schedule rate, the leave-without-pay formula of CSC MC No. 8, s. 2014, PERA, and the contribution and withholding tables. No authority on file says how to split a monthly amount across two runs, and #28 already keeps split payments out of the MVP.

## Decision

A regular Payroll Period covers exactly one calendar month and has one payment date. The Agency configures only the cutoff and the payment date. A special Payroll Period pays only the components it names, takes no basic salary, contributions, or attendance, and may overlap a regular period's dates.

The rejected alternative was an Agency-chosen interval, such as semi-monthly. Each half would need a proration rule for salary, allowances, contributions, and tax that no source gives.

## Consequences

- An Agency that pays salary in installments is unsupported until its procedure and the authority for the split are on record.
- A duplicate is a second regular period, not `VOIDED`, whose month is already covered. A void-and-replace period reuses the month.
- Bonuses, the cash gift, the clothing allowance, and monetization can be paid on their own dates through a special period.
