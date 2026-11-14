# ADR 0012: Charge Each Attendance Deficit Fact Once

- Status: Accepted
- Date: 2026-11-14
- Scope: charging tardiness and undertime to vacation leave, and what Payroll receives (#329)

## Context

Attendance publishes `TARDINESS`, `UNDERTIME` and `ABSENCE` minutes in each Attendance Payroll Publication, and no module charged them. CSC MC No. 41, s. 1998 settles the substance: tardiness and undertime are deducted from vacation leave and never from sick leave (section 34), an absence beyond earned credits is without pay (section 56), an unauthorized absence gets no salary and is not deducted from credits (section 50), and Table II converts hours and minutes to fractions of an eight-hour day. [authoritative-leave-credit-and-mandatory-leave-rules.md](../research/authoritative-leave-credit-and-mandatory-leave-rules.md) carries the text and the table.

MC 41 leaves three things open. It does not say whether each day's minutes or a period total is converted, and the two round differently. It does not say which balance a late-arriving charge draws on. And Table II covers only an eight-hour day.

## Decision

Leave owns the charge. It consumes the outbox event the Attendance Period Lock already writes, reads the publication through Attendance's application service, and needs no human step, because section 34 leaves no discretion.

- **One Attendance Deficit Charge per fact.** Each `TARDINESS` or `UNDERTIME` Attendance Payroll Fact converts on its own through Table II and creates one charge, unique by that fact. Facts are charged per Employee in Work Date order.
- **Decided once, against available credits.** The charge draws on the vacation Leave Account's posted balance as of the Work Date, or its current posted balance when that is lower, less active Leave Credit Commitments. It posts one negative Leave Ledger Entry, effective on the Work Date, for the part the credits cover. The rest is the Unpaid Deficit Remainder, and Leave sends it to Payroll as one Payroll Input in the same transaction. A later credit posting, restoration or cancellation never reopens a charge.
- **Only an adjustment publication changes a charge.** For each changed fact, Leave reverses the earlier charge's ledger entry and creates a successor charge from the corrected minutes, and Payroll receives a linked correcting input.
- **Sick leave has no branch.** Undertime for health reasons is an ordinary sick Leave Application over those hours. Posted leave covers the minutes, so they are never an Attendance Deficit. After lock, the Leave-originated Attendance Correction produces the adjustment publication that reverses the vacation leave charge.
- **No conversion without authority.** A fact stays uncharged, with its reason, when its Work Date's expected duty is not 480 minutes (#654) or when the Employee has no applicable vacation Leave Policy Version and Leave Account. Rerunning the charge picks it up once the missing fact exists.
- **Payroll takes the remainder from Leave and absence from Attendance.** Payroll never deducts `TARDINESS` or `UNDERTIME` from Attendance facts. It reads `ABSENCE` facts from Attendance itself, and treats an Employee whose facts in a consumed publication are not all charged as a blocking exception.

Rejected alternatives:

- Converting a period total, like a monthly leave-card line. An adjustment to one day would reverse and replace the whole period's entry, and no source requires the total.
- Charging inside the lock transaction. Attendance would depend on Leave, which already depends on Attendance, and a Leave failure would block the lock.
- An HR-run charge with a preview. It adds a checkpoint over a rule with no discretion, and a backlog HR must clear before every payroll.
- Re-evaluating old shortfalls when credits arrive later. Every ledger posting would need a recalculation trigger, and a finalized payroll would be corrected by an unrelated accrual.
- Payroll netting Attendance facts against Leave's charges. The charging rule's result would be derived in two modules.
- Table II or a proportional fraction on a day that is not eight hours. Either would invent a public-sector rule.

## Worked example

An Employee on a fixed 08:00–17:00 Day Rule, 480 expected minutes, has .200 day of vacation leave available and no commitments.

| Work Date  | Fact                   | Table II           | Charged to vacation leave | Unpaid Deficit Remainder |
| ---------- | ---------------------- | ------------------ | ------------------------: | -----------------------: |
| 2026-11-03 | `TARDINESS` 37 minutes | .077               |                      .077 |                        — |
| 2026-11-05 | `UNDERTIME` 90 minutes | .125 + .062 = .187 |                      .123 |                     .064 |
| 2026-11-06 | `ABSENCE` 480 minutes  | not converted      |                         — |                        — |

The second charge takes the .123 that remains and sends Payroll one input for .064 day. The absence is never charged; Payroll reads it from Attendance.

A Locked Attendance Adjustment then corrects 5 November to 30 minutes of undertime. Leave reverses the .123 entry, and a successor charge converts 30 minutes to .062 and charges all of it, leaving .061 available. Payroll receives a correcting input that withdraws the .064.

## Consequences

- Ledger quantities for these charges carry three decimal places, as Table II prints them.
- Converting per fact charges less than a period total would when small deficits repeat: one minute on 22 days is .044 day, not .046.
- An Agency on a compressed workweek cannot charge those Work Dates, and Payroll cannot settle the affected Employees, until #654 finds the authority.
- The salary effect of the remainder, and whether a blocking exception can be waived, are Payroll's (#341, #328).
