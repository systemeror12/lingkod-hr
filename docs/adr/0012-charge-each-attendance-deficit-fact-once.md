# ADR 0012: Charge Each Attendance Deficit Fact Once

- Status: Accepted; amended 2026-11-14 for #654
- Date: 2026-11-14
- Scope: charging tardiness and undertime to vacation leave, and what Payroll receives (#329, #654)

## Context

Attendance publishes `TARDINESS`, `UNDERTIME` and `ABSENCE` minutes in each Attendance Payroll Publication, and no module charged them. CSC MC No. 41, s. 1998 settles the substance: tardiness and undertime are deducted from vacation leave and never from sick leave (section 34), an absence beyond earned credits is without pay (section 56), an unauthorized absence gets no salary and is not deducted from credits (section 50), and Table II converts hours and minutes to fractions of an eight-hour day. [authoritative-leave-credit-and-mandatory-leave-rules.md](../research/authoritative-leave-credit-and-mandatory-leave-rules.md) carries the text and the table.

MC 41 leaves three things open. It does not say whether each day's minutes or a period total is converted, and the two round differently. It does not say which balance a late-arriving charge draws on. And Table II covers only an eight-hour day.

The #654 research found primary text for some other cases, and none for the rest. CSC MC No. 6, s. 2026 §V.B.2.6 charges a full day of absence on a four-workday compressed week at 1.25 days, but gives no divisor for late or undertime minutes on that 600-minute day. MC 41 §30 gives a proportion for absence incurred on a flexible-hours day, not for tardiness or undertime facts. MC 41 Rule XVI §2 gives part-time service an annual proportion only. The [non-480-minute section](../research/authoritative-leave-credit-and-mandatory-leave-rules.md#non-480-minute-work-dates-654) records each case.

## Decision

Leave owns the charge. It consumes the outbox event the Attendance Period Lock already writes, reads the publication through Attendance's application service, and needs no human step, because section 34 leaves no discretion.

- **One Attendance Deficit Charge per fact.** Each `TARDINESS` or `UNDERTIME` Attendance Payroll Fact converts on its own through Table II and creates one charge, unique by that fact. Facts are charged per Employee in Work Date order.
- **Decided once, against available credits.** The charge draws on the vacation Leave Account's posted balance as of the Work Date, or its current posted balance when that is lower, less active Leave Credit Commitments. It posts one negative Leave Ledger Entry, effective on the Work Date, for the part the credits cover. The rest is the Unpaid Deficit Remainder, and Leave sends it to Payroll as one Payroll Input in the same transaction. A later credit posting, restoration or cancellation never reopens a charge.
- **Only an adjustment publication changes a charge.** For each changed fact, Leave reverses the earlier charge's ledger entry and creates a successor charge from the corrected minutes, and Payroll receives a linked correcting input.
- **Sick leave has no branch.** Undertime for health reasons is an ordinary sick Leave Application over those hours. Posted leave covers the minutes, so they are never an Attendance Deficit. After lock, the Leave-originated Attendance Correction produces the adjustment publication that reverses the vacation leave charge.
- **Table II only on 480 minutes.** A fact converts through Table II only when its Work Date's expected duty is 480 minutes. Any other fact stays uncharged, with a reason that names its gap: a compressed-workweek day of 600 minutes (no divisor for late or undertime), a part-time day, a flexible-hours day (§30 covers absence incurred, not these facts), any other duty, or no applicable vacation Leave Policy Version and Leave Account. Rerunning the charge picks the fact up once a decision or authority names the rule (#654).
- **Payroll takes the remainder from Leave and absence from Attendance.** Payroll never deducts `TARDINESS` or `UNDERTIME` from Attendance facts. It reads `ABSENCE` facts from Attendance itself, and treats an Employee whose facts in a consumed publication are not all charged as a blocking exception.

Rejected alternatives:

- Converting a period total, like a monthly leave-card line. An adjustment to one day would reverse and replace the whole period's entry, and no source requires the total.
- Charging inside the lock transaction. Attendance would depend on Leave, which already depends on Attendance, and a Leave failure would block the lock.
- An HR-run charge with a preview. It adds a checkpoint over a rule with no discretion, and a backlog HR must clear before every payroll.
- Re-evaluating old shortfalls when credits arrive later. Every ledger posting would need a recalculation trigger, and a finalized payroll would be corrected by an unrelated accrual.
- Payroll netting Attendance facts against Leave's charges. The charging rule's result would be derived in two modules.
- Table II or a proportional fraction on a day that is not 480 minutes, for late or undertime. No primary text gives that conversion for those facts. The compressed-week full-day figure points to a 480-minute divisor, but it is not written, so it waits for a decision (#654).

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
- An Agency on a compressed workweek cannot charge its 600-minute Work Dates, and Payroll cannot settle the affected Employees, until a decision or CSC issuance states the late and undertime divisor for them (#654).
- Leave applications for a full compressed-week day (1.25 credit days on a 10-hour day, 1 day after reversion, MC 6 s. 2026 §V.B.2.6) and for a flexible-hours absence (MC 41 §30) are leave-application units. They are not deficit charges and do not change this decision.
- The salary effect of the remainder, and whether a blocking exception can be waived, are Payroll's (#341, #328).
