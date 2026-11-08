# ADR 0009: Post CTO at Approval and Count COC in Minutes by Valid Until

- Status: Accepted
- Date: 2026-10-27
- Scope: The COC ledger and CTO Requests (#318)

## Context

The schema modelled COC as hours with an `entry_type` enum and a nullable `expires_at`, and CTO as a request that approval reserved and a later step posted. Leave, the nearest model, uses signed, source-owned entries and Leave Credit Commitments. COC differs from Leave in three ways. Its credit expires by the year earned, so a use must say whose credit it consumed. The 1.5 ratio applied to hours stored at four decimals needs a rounding rule, and [overtime-coc-cto-authorities.md](../research/overtime-coc-cto-authorities.md) found none. And CTO must be approved before it is taken (JC 2, s. 2004 item 5.9.3), with no certification step between approval and use that a commitment would wait on.

## Decision

COC Ledger Entries follow Leave: a signed quantity, a typed source and posting key, and exact reversals, with no entry-type enum. Two choices differ from Leave.

- **Minutes, grouped by Valid Until.** Entries count minutes at one decimal place, so certified whole minutes × 1.0 or 1.5 is always exact. Every entry carries the `valid_until` of the COC it changes: December 31 of the year after the certificate's earned month. A use or expiry draws from the earliest-expiring COC still valid on its date, so one CTO splits across at most two Valid Until dates.
- **CTO posts at approval.** Approving a CTO Request posts its usage, effective on the CTO dates, and creates the Attendance CTO inputs in the same transaction. There is no commitment, no `POSTED` status, and no posting job. Usage is posted per Work Date, so cancellation or recall reverses only the cancelled dates' entries and supersedes their Attendance inputs.

Rejected alternatives:

- Hours with a rounding rule. No source sets one, so it would invent a public-sector rule.
- An allocation table linking each use to the certificates it drew from. At most two Valid Until dates are live at once, so a column carries the same fact.
- Deriving the draw order at read time. A reversal after an expiry could not say which credit it restores.
- A COC commitment consumed by a later posting, like Leave. Nothing is decided between CTO approval and use, so the commitment would add a table, a status, and a job that wait on nothing.

## Consequences

- A balance as of a date counts entries effective on or before it. An available balance also counts future-dated uses.
- Approval is refused on a locked Work Date, and cancellation on a locked Work Date goes through a Locked Attendance Adjustment, as Leave Cancellation does.
- Overtime stores Actual and Certified Overtime Hours as whole minutes so the award needs no conversion.
- New credit comes only from a Certificate of COC Earned. Adjustments are negative, and credit returns only when a negative entry is reversed.

### Amendment, 2026-10-29 (#537)

A balance as of a date counts entries effective on or before it whose Valid Until is on or after it, replacing the first consequence above. Expiry and forfeiture entries carry the Valid Until of the COC they remove, so the filter changes no balance once they post; before the expiry run exists (#322), it keeps expired COC out of the balance and the 120-hour cap. An award is also refused when its approval date is before the account's latest certificate entry, and when its service falls on or before a closed account's close date.
