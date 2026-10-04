import type { WorkScheduleDayRuleSummary } from '../attendance-configuration/work-schedules.service';
import type { AttendanceResolution } from '../attendance-configuration/schedule-assignments.service';
import {
  type AttendanceEventCollectionWindow,
  type AttendanceEventPresentation,
  type AttendanceEventType,
} from './attendance.types';

export interface AttendanceWorkDateCandidate {
  workDate: string;
  resolution: AttendanceResolution;
  window: AttendanceEventCollectionWindow | null;
}

export interface AttendanceEventMatch {
  status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';
  matches: AttendanceWorkDateCandidate[];
  unscheduled: boolean;
}

/**
 * Match one event instant to the candidate Work Dates. Window membership wins;
 * a REST Work Date only associates by the event's own local date so a late
 * overnight event cannot be claimed by the next day's rest rule.
 */
export function matchAttendanceEvent(
  eventTime: Date,
  eventLocalDate: string,
  candidates: readonly AttendanceWorkDateCandidate[],
): AttendanceEventMatch {
  const inWindow = candidates.filter(
    (candidate) =>
      candidate.window !== null &&
      eventTime.getTime() >= candidate.window.start.getTime() &&
      eventTime.getTime() <= candidate.window.end.getTime(),
  );
  if (inWindow.length === 1) {
    return { status: 'MATCHED', matches: inWindow, unscheduled: false };
  }
  if (inWindow.length > 1) {
    return { status: 'AMBIGUOUS', matches: inWindow, unscheduled: false };
  }
  const rest = candidates.find(
    (candidate) =>
      candidate.workDate === eventLocalDate && candidate.resolution.dayRule.ruleType === 'REST',
  );
  if (rest) {
    return { status: 'MATCHED', matches: [rest], unscheduled: true };
  }
  return { status: 'UNMATCHED', matches: [], unscheduled: false };
}

export interface AttendanceSequenceEvent {
  eventType: AttendanceEventType;
  eventTime: Date;
}

export const ATTENDANCE_SEQUENCE_ISSUE_TYPES = [
  'DUPLICATE_ATTENDANCE_EVENT',
  'MISSING_ATTENDANCE_EVENT',
  'OUT_OF_ORDER_ATTENDANCE_EVENT',
] as const;
export type AttendanceSequenceIssueType = (typeof ATTENDANCE_SEQUENCE_ISSUE_TYPES)[number];

export interface AttendanceSequenceIssue {
  type: AttendanceSequenceIssueType;
  eventType: AttendanceEventType;
  expectedCount: number;
  actualCount: number;
  eventTime: string | null;
}

export function expectedEventSequence(dayRule: WorkScheduleDayRuleSummary): AttendanceEventType[] {
  const breakPairs = dayRule.eventPattern === 'WITH_BREAK_EVENTS' ? dayRule.breaks.length : 0;
  const expected: AttendanceEventType[] = ['TIME_IN'];
  for (let index = 0; index < breakPairs; index += 1) {
    expected.push('BREAK_OUT', 'BREAK_IN');
  }
  expected.push('TIME_OUT');
  return expected;
}

function countsOf(events: readonly AttendanceSequenceEvent[]): Map<AttendanceEventType, number> {
  const counts = new Map<AttendanceEventType, number>();
  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }
  return counts;
}

function expectedCountsOf(
  expected: readonly AttendanceEventType[],
): Map<AttendanceEventType, number> {
  const counts = new Map<AttendanceEventType, number>();
  for (const eventType of expected) {
    counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
  }
  return counts;
}

/**
 * The next semantic event the Day Rule expects from the recorded events. The
 * walk consumes expected occurrences, so a second break pair still expects its
 * own BREAK_OUT and BREAK_IN instead of stopping at the first distinct count.
 */
export function nextExpectedEventType(
  events: readonly AttendanceSequenceEvent[],
  dayRule: WorkScheduleDayRuleSummary,
): AttendanceEventType | null {
  const remaining = countsOf(events);
  for (const eventType of expectedEventSequence(dayRule)) {
    const left = remaining.get(eventType) ?? 0;
    if (left === 0) return eventType;
    remaining.set(eventType, left - 1);
  }
  return null;
}

/**
 * Evaluate duplicates, ordering, and missing events against the Day Rule event
 * pattern. A day is only judged incomplete once a TIME_OUT closes it; an open
 * day may legitimately hold one TIME_IN.
 */
export function evaluateAttendanceSequence(
  events: readonly AttendanceSequenceEvent[],
  dayRule: WorkScheduleDayRuleSummary,
): AttendanceSequenceIssue[] {
  const expected = expectedEventSequence(dayRule);
  const expectedCounts = expectedCountsOf(expected);
  const actualCounts = countsOf(events);
  const issues: AttendanceSequenceIssue[] = [];

  for (const [eventType, expectedCount] of expectedCounts) {
    const actualCount = actualCounts.get(eventType) ?? 0;
    if (actualCount > expectedCount) {
      issues.push({
        type: 'DUPLICATE_ATTENDANCE_EVENT',
        eventType,
        expectedCount,
        actualCount,
        eventTime: null,
      });
    }
  }

  const ordered = [...events].sort(
    (left, right) => left.eventTime.getTime() - right.eventTime.getTime(),
  );
  const remaining = new Map(expectedCounts);
  let pointer = 0;
  for (const event of ordered) {
    while (pointer < expected.length && (remaining.get(expected[pointer]!) ?? 0) === 0) {
      pointer += 1;
    }
    if (pointer < expected.length && expected[pointer] === event.eventType) {
      remaining.set(event.eventType, (remaining.get(event.eventType) ?? 0) - 1);
      pointer += 1;
      continue;
    }
    const laterIndex = expected.findIndex(
      (eventType, index) =>
        index > pointer && eventType === event.eventType && (remaining.get(eventType) ?? 0) > 0,
    );
    if (laterIndex >= 0) {
      const skippedPresent = expected
        .slice(pointer, laterIndex)
        .some((eventType) => (actualCounts.get(eventType) ?? 0) > 0);
      if (skippedPresent) {
        issues.push({
          type: 'OUT_OF_ORDER_ATTENDANCE_EVENT',
          eventType: event.eventType,
          expectedCount: expectedCounts.get(event.eventType) ?? 0,
          actualCount: actualCounts.get(event.eventType) ?? 0,
          eventTime: event.eventTime.toISOString(),
        });
      }
      remaining.set(event.eventType, (remaining.get(event.eventType) ?? 0) - 1);
    }
  }

  const closed = (actualCounts.get('TIME_OUT') ?? 0) > 0;
  if (closed) {
    for (const [eventType, expectedCount] of expectedCounts) {
      const actualCount = actualCounts.get(eventType) ?? 0;
      if (actualCount < expectedCount) {
        issues.push({
          type: 'MISSING_ATTENDANCE_EVENT',
          eventType,
          expectedCount,
          actualCount,
          eventTime: null,
        });
      }
    }
  }

  return issues;
}

const DUTY_LABELS: Record<AttendanceEventType, string> = {
  TIME_IN: 'Duty start',
  BREAK_OUT: 'Break start',
  BREAK_IN: 'Break end',
  TIME_OUT: 'Duty end',
};

const UNSCHEDULED_LABELS: Record<AttendanceEventType, string> = {
  TIME_IN: 'Unscheduled time in',
  BREAK_OUT: 'Unscheduled break start',
  BREAK_IN: 'Unscheduled break end',
  TIME_OUT: 'Unscheduled time out',
};

const SLOT_LABELS: Record<AttendanceEventType, string> = {
  TIME_IN: 'AM In',
  BREAK_OUT: 'AM Out',
  BREAK_IN: 'PM In',
  TIME_OUT: 'PM Out',
};

const SLOT_BY_EVENT_TYPE: Record<AttendanceEventType, AttendanceEventPresentation['slot']> = {
  TIME_IN: 'AM_IN',
  BREAK_OUT: 'AM_OUT',
  BREAK_IN: 'PM_IN',
  TIME_OUT: 'PM_OUT',
};

export interface PresentableAttendanceEvent {
  id: string;
  eventType: AttendanceEventType;
  eventTime: Date;
}

/**
 * Derive the DTR presentation of the events that belong to one Work Date. An
 * ordinary daytime schedule, with no break or the familiar single lunch break,
 * projects semantic events onto the AM In/AM Out/PM In/PM Out slots by first
 * occurrence. Anything overnight or with several breaks keeps schedule-aware
 * duty and break labels, which preserves the crossing boundary and avoids
 * mixing the two vocabularies on one day.
 */
export function presentWorkDateEvents(
  workDate: string,
  dayRule: WorkScheduleDayRuleSummary,
  events: readonly PresentableAttendanceEvent[],
): Map<string, AttendanceEventPresentation> {
  const ordered = [...events].sort(
    (left, right) => left.eventTime.getTime() - right.eventTime.getTime(),
  );
  const slotsByType = new Map<AttendanceEventType, number>();
  const projectToSlots =
    dayRule.ruleType !== 'REST' && !dayRule.endNextCalendarDay && dayRule.breaks.length <= 1;
  const presentations = new Map<string, AttendanceEventPresentation>();
  for (const event of ordered) {
    if (projectToSlots) {
      const occurrence = (slotsByType.get(event.eventType) ?? 0) + 1;
      slotsByType.set(event.eventType, occurrence);
      if (occurrence === 1) {
        presentations.set(event.id, {
          workDate,
          slot: SLOT_BY_EVENT_TYPE[event.eventType],
          label: SLOT_LABELS[event.eventType],
        });
        continue;
      }
      presentations.set(event.id, {
        workDate,
        slot: null,
        label: DUTY_LABELS[event.eventType],
      });
      continue;
    }
    const labels = dayRule.ruleType === 'REST' ? UNSCHEDULED_LABELS : DUTY_LABELS;
    presentations.set(event.id, {
      workDate,
      slot: null,
      label: labels[event.eventType],
    });
  }
  return presentations;
}
