# ADR 0006: Apply One National Non-Working Holiday Rule

- Status: Accepted
- Date: 2026-10-11
- Scope: Expected duty on Holiday Calendar dates in Attendance and Leave (#454)

## Context

Leave, Mandatory Leave, and Schedule Assignments already treated `REGULAR_HOLIDAY`, `SPECIAL_NON_WORKING`, `LOCAL_HOLIDAY`, and `WORK_SUSPENSION` as non-working through one fixed list. Attendance instead read `work_schedule_versions.holiday_effect_rules`, which no create or update path could set. Every weekday holiday raised a blocking `UNSUPPORTED_HOLIDAY_EFFECT`, and the calculator accepted any key, even `null`, as an effect. A calendar version could also hold two classifications on one date, and the calculator silently kept the last.

## Decision

One fixed national rule decides expected duty on Holiday Calendar dates, and Attendance and Leave share it. `REGULAR_HOLIDAY`, `SPECIAL_NON_WORKING`, `LOCAL_HOLIDAY`, and `WORK_SUSPENSION` are Non-Working Holidays: no duty is expected for the minutes on that actual calendar date. `SPECIAL_WORKING` keeps ordinary duty. The authority is the issuance recorded on the Holiday Calendar entry, and the calendar's Agency, Office, or Worksite scope limits who it applies to.

- A `WORK_SUSPENSION` entry means a whole-day suspension. A partial-day suspension is recorded as Attendance Context.
- Service rendered on a Non-Working Holiday is recorded like rest-day service: `OUTSIDE_SCHEDULE` worked minutes and `UNSCHEDULED_SERVICE`, with no deficit, premium, overtime, or credit.
- A Holiday Calendar Version holds at most one classification per date. An existing duplicate makes the migration fail and is resolved through a successor calendar version, not automatic deduplication.
- `holiday_effect_rules` and `UNSUPPORTED_HOLIDAY_EFFECT` are removed. Stored calculation snapshots keep them as history.

Rejected alternatives:

- Effects configured on each Work Schedule Version with their own evidence. Every schedule would have to be configured before any DTR containing a holiday could complete, and Attendance could then disagree with Leave's working-day count.
- A national default with an evidence-backed override per Work Schedule Version. No Agency has produced the authority that would justify one.
- Precedence among several classifications on one date. No source gives one.

## Consequences

- A schedule that must work on holidays, such as a 24/7 shift, records its holiday attendance as worked minutes outside the schedule, but an absence on a holiday is not a deficit. An Agency that produces authority for holiday duty can later add the per-schedule override as an explicit, effective-dated rule.
- Attendance Days blocked by `UNSUPPORTED_HOLIDAY_EFFECT` are unblocked by ordinary recalculation into successor versions.
