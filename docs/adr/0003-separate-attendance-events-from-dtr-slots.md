# ADR 0003: Separate Attendance Events from DTR slots

- Status: Accepted
- Date: 2026-09-15
- Scope: Attendance capture and Daily Time Record projection

## Context

Philippine HRIS users commonly work with AM In, AM Out, PM In, and PM Out fields. Storing those presentation slots as raw event types would make overnight duty and breaks crossing midnight ambiguous.

## Decision

Raw Attendance Events use the schedule-neutral `TIME_IN`, `BREAK_OUT`, `BREAK_IN`, and `TIME_OUT` types. An ordinary daytime DTR and its manual-entry view project those events into the familiar AM In, AM Out, PM In, and PM Out slots. Overnight views use duty and break labels with the actual local date and time. An applicable official form may impose its own rendering contract without changing the source events.

## Consequences

- Attendance capture and correction use one event model for daytime and overnight schedules.
- DTR presentation remains familiar for ordinary Philippine government schedules.
- DTR generation must retain the exact event and calculation versions behind every displayed slot.
