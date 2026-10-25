# ADR 0005: Count Fully Covered Minutes

- Status: Accepted
- Date: 2026-10-11
- Scope: Attendance Day calculation from timed Attendance Events and Attendance Context

## Context

Attendance Day totals are whole minutes. Web Clock Attendance Events carry seconds, and the API accepts seconds on Attendance Events and timed Attendance Context. The calculator used to floor every boundary to its minute. So `TIME_IN 08:00:59` and `TIME_OUT 17:00:01` with a one-hour lunch counted 480 worked minutes, and the worked segment started at 08:00:00, before the raw time-in. Up to 59 seconds of lateness were excused without any authority.

The research in `docs/research/attendance-schedule-authorities.md` found no national grace period or timestamp rounding rule, and CSC MC No. 6, s. 2026 bases late and undertime on actual minutes. Whole-minute calculation is a project choice.

## Decision

Calculation counts Fully Covered Minutes. A timed interval covers a whole minute only when it spans all of it. Its start moves up to the next whole minute, and its end moves down to the previous one. A partial minute stays uncovered, and inside expected duty it becomes a deficit. The rule covers every timed input: Attendance Events, timed Attendance Context, and values replaced through Attendance Corrections. Raw timestamps keep their seconds; the research document's suggestion to store whole-minute timestamps is superseded.

The Attendance Day rule snapshot records `minuteRule: 'FULLY_COVERED_MINUTE'`, and the input fingerprint includes it.

Rejected alternatives:

- Storing a whole-minute event time at capture. It still needs a rounding direction and adds a second time to every event.
- An Agency tolerance or rounding rule. It needs an authority source, and none was found. An Agency that cites one can later add an explicit, effective-dated rule on top of this convention.

## Consequences

- No Attendance Day Segment starts before or ends after its raw source, and no time is added.
- `TIME_IN 08:00:59` and `TIME_OUT 17:00:01` on a fixed 08:00–17:00 Day Rule with a one-hour lunch give 479 worked minutes, 1 tardiness minute, and 0 undertime. A `08:00:01` time-in is 1 tardiness minute.
- An interval can lose just under two minutes of elapsed time, one partial minute at each end. A flexible day with a `08:30:20` time-in anchors at 08:31.
- Whole-minute Attendance Events give unchanged results.
- A changed convention changes the input fingerprint, so Attendance Period Reconciliation refuses a lock until affected Attendance Days are recalculated as successors. Locked Attendance Period Versions keep their Attendance Day versions.
