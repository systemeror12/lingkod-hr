import { expect, it } from 'vitest';
import type { AttendanceResolution } from '../attendance-configuration/schedule-assignments.service';
import type { WorkScheduleDayRuleSummary } from '../attendance-configuration/work-schedules.service';
import {
  evaluateAttendanceSequence,
  expectedEventSequence,
  matchAttendanceEvent,
  nextExpectedEventType,
  presentWorkDateEvents,
  type AttendanceSequenceEvent,
  type AttendanceWorkDateCandidate,
} from './attendance-matching';
import { eventCollectionWindow } from './attendance.types';

function dayRule(overrides: Partial<WorkScheduleDayRuleSummary> = {}): WorkScheduleDayRuleSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    weekday: 1,
    ruleType: 'FIXED',
    dutyStartTime: '08:00',
    earliestStartTime: null,
    latestStartTime: null,
    dutyEndTime: '17:00',
    endNextCalendarDay: false,
    requiredMinutes: 480,
    coreStartTime: null,
    coreEndTime: null,
    eventPattern: 'IN_OUT',
    collectionBeforeMinutes: 0,
    collectionAfterMinutes: 0,
    breaks: [],
    ...overrides,
  };
}

function resolution(workDate: string, rule: WorkScheduleDayRuleSummary): AttendanceResolution {
  const employee = { id: 'e1', employeeNumber: 'EMP-1', legalName: 'Employee One' };
  return {
    employeeId: employee.id,
    workDate,
    assignment: {
      id: 'a1',
      employee,
      workScheduleVersionId: 'sv1',
      workScheduleVersionNo: 1,
      scheduleType: 'REGULAR',
      workScheduleCode: 'ORDINARY',
      workScheduleName: 'Ordinary',
      workArrangementVersionId: 'av1',
      workArrangementVersionNo: 1,
      arrangementType: 'ONSITE',
      workArrangementCode: 'ONSITE',
      workArrangementName: 'Onsite',
      holidayCalendarId: 'h1',
      authorityDocumentVersionId: 'd1',
      effectiveFrom: workDate,
      effectiveTo: null,
      assignedByMembershipId: 'm1',
      createdAt: `${workDate}T00:00:00.000Z`,
      updatedAt: `${workDate}T00:00:00.000Z`,
      rowVersion: 1,
    },
    workScheduleVersion: {
      id: 'sv1',
      workScheduleId: 's1',
      versionNo: 1,
      scheduleType: 'REGULAR',
      timezone: 'Asia/Manila',
      holidayEffectRules: {},
      authorityDocumentVersionId: 'd1',
      approvingAuthority: 'Office of the President',
      versionState: 'ACTIVE',
      effectiveFrom: workDate,
      effectiveTo: null,
      activatedAt: `${workDate}T00:00:00.000Z`,
      dayRules: [rule],
      rowVersion: 1,
      createdAt: `${workDate}T00:00:00.000Z`,
      updatedAt: `${workDate}T00:00:00.000Z`,
    },
    workArrangementVersion: {
      id: 'av1',
      workArrangementId: 'w1',
      versionNo: 1,
      arrangementType: 'ONSITE',
      permittedScheduleTypes: ['REGULAR'],
      holidayCalendarId: 'h1',
      authorityDocumentVersionId: 'd1',
      approvingAuthority: 'Office of the President',
      versionState: 'ACTIVE',
      effectiveFrom: workDate,
      effectiveTo: null,
      activatedAt: `${workDate}T00:00:00.000Z`,
      rowVersion: 1,
      createdAt: `${workDate}T00:00:00.000Z`,
      updatedAt: `${workDate}T00:00:00.000Z`,
    },
    holidayCalendarVersion: {
      id: 'hv1',
      holidayCalendarId: 'h1',
      versionNo: 1,
      authorityDocumentVersionId: 'd1',
      approvingAuthority: 'Office of the President',
      versionState: 'ACTIVE',
      effectiveFrom: workDate,
      effectiveTo: null,
      activatedAt: `${workDate}T00:00:00.000Z`,
      entries: [],
      rowVersion: 1,
      createdAt: `${workDate}T00:00:00.000Z`,
      updatedAt: `${workDate}T00:00:00.000Z`,
    },
    dayRule: rule,
    holidayEntries: [],
  };
}

function candidate(
  workDate: string,
  rule: WorkScheduleDayRuleSummary,
): AttendanceWorkDateCandidate {
  return {
    workDate,
    resolution: resolution(workDate, rule),
    window: eventCollectionWindow(rule, workDate, 'Asia/Manila'),
  };
}

it('matches an event inside exactly one Event Collection Window', () => {
  const match = matchAttendanceEvent(new Date('2026-01-02T00:30:00.000Z'), '2026-01-02', [
    candidate('2026-01-02', dayRule()),
  ]);
  expect(match.status).toBe('MATCHED');
  expect(match.unscheduled).toBe(false);
  expect(match.matches.map(({ workDate }) => workDate)).toEqual(['2026-01-02']);
});

it('claims an early-morning overnight event through the previous Work Date window', () => {
  const previous = candidate(
    '2026-01-02',
    dayRule({ dutyStartTime: '22:00', dutyEndTime: '06:00', endNextCalendarDay: true }),
  );
  const current = candidate('2026-01-03', dayRule());
  const match = matchAttendanceEvent(new Date('2026-01-02T21:00:00.000Z'), '2026-01-03', [
    current,
    previous,
  ]);
  expect(match.status).toBe('MATCHED');
  expect(match.matches.map(({ workDate }) => workDate)).toEqual(['2026-01-02']);
});

it('reports ambiguity when more than one window contains the event', () => {
  const match = matchAttendanceEvent(new Date('2026-01-02T01:00:00.000Z'), '2026-01-02', [
    candidate('2026-01-02', dayRule()),
    candidate('2026-01-01', dayRule({ collectionAfterMinutes: 1440 })),
  ]);
  expect(match.status).toBe('AMBIGUOUS');
  expect(match.matches).toHaveLength(2);
});

it('associates an event with the rest day of its own local date only', () => {
  const rest = dayRule({ ruleType: 'REST', dutyStartTime: null, dutyEndTime: null });
  const match = matchAttendanceEvent(new Date('2026-01-03T02:00:00.000Z'), '2026-01-03', [
    candidate('2026-01-03', rest),
    candidate('2026-01-02', dayRule()),
  ]);
  expect(match.status).toBe('MATCHED');
  expect(match.unscheduled).toBe(true);
  expect(match.matches.map(({ workDate }) => workDate)).toEqual(['2026-01-03']);
});

it('does not let the previous rest day claim a later event', () => {
  const rest = dayRule({ ruleType: 'REST', dutyStartTime: null, dutyEndTime: null });
  const match = matchAttendanceEvent(new Date('2026-01-03T02:00:00.000Z'), '2026-01-03', [
    candidate('2026-01-02', rest),
  ]);
  expect(match.status).toBe('UNMATCHED');
  expect(match.matches).toHaveLength(0);
});

it('builds the expected sequence from the Day Rule event pattern', () => {
  expect(expectedEventSequence(dayRule())).toEqual(['TIME_IN', 'TIME_OUT']);
  expect(
    expectedEventSequence(
      dayRule({
        eventPattern: 'WITH_BREAK_EVENTS',
        breaks: [
          {
            id: 'b1',
            sequenceNo: 1,
            breakStartTime: '12:00',
            breakEndTime: '13:00',
            endNextCalendarDay: false,
          },
        ],
      }),
    ),
  ).toEqual(['TIME_IN', 'BREAK_OUT', 'BREAK_IN', 'TIME_OUT']);
  expect(
    expectedEventSequence(
      dayRule({
        eventPattern: 'WITH_BREAK_EVENTS',
        breaks: [
          {
            id: 'b1',
            sequenceNo: 1,
            breakStartTime: '10:00',
            breakEndTime: '10:15',
            endNextCalendarDay: false,
          },
          {
            id: 'b2',
            sequenceNo: 2,
            breakStartTime: '15:00',
            breakEndTime: '15:15',
            endNextCalendarDay: false,
          },
        ],
      }),
    ),
  ).toHaveLength(6);
});

function sequenceEvent(
  eventType: AttendanceSequenceEvent['eventType'],
  time: string,
): AttendanceSequenceEvent {
  return { eventType, eventTime: new Date(time) };
}

it('leaves an open Work Date alone and reports issues once TIME_OUT closes it', () => {
  const rule = dayRule({
    eventPattern: 'WITH_BREAK_EVENTS',
    breaks: [
      {
        id: 'b1',
        sequenceNo: 1,
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        endNextCalendarDay: false,
      },
    ],
  });
  expect(
    evaluateAttendanceSequence([sequenceEvent('TIME_IN', '2026-01-02T00:00:00.000Z')], rule),
  ).toEqual([]);
  expect(
    evaluateAttendanceSequence(
      [
        sequenceEvent('TIME_IN', '2026-01-02T00:00:00.000Z'),
        sequenceEvent('TIME_OUT', '2026-01-02T09:00:00.000Z'),
      ],
      rule,
    ).map(({ type }) => type),
  ).toEqual(['MISSING_ATTENDANCE_EVENT', 'MISSING_ATTENDANCE_EVENT']);
});

it('reports duplicates and out-of-order events', () => {
  const rule = dayRule();
  const duplicates = evaluateAttendanceSequence(
    [
      sequenceEvent('TIME_IN', '2026-01-02T00:00:00.000Z'),
      sequenceEvent('TIME_IN', '2026-01-02T00:05:00.000Z'),
      sequenceEvent('TIME_OUT', '2026-01-02T09:00:00.000Z'),
    ],
    rule,
  );
  expect(duplicates.map(({ type }) => type)).toEqual(['DUPLICATE_ATTENDANCE_EVENT']);

  const outOfOrder = evaluateAttendanceSequence(
    [
      sequenceEvent('TIME_OUT', '2026-01-02T09:00:00.000Z'),
      sequenceEvent('TIME_IN', '2026-01-02T09:05:00.000Z'),
    ],
    rule,
  );
  expect(outOfOrder.map(({ type }) => type)).toEqual(['OUT_OF_ORDER_ATTENDANCE_EVENT']);
});

it('projects a single-break same-day schedule onto DTR AM/PM slots', () => {
  const rule = dayRule({
    eventPattern: 'WITH_BREAK_EVENTS',
    breaks: [
      {
        id: 'b1',
        sequenceNo: 1,
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        endNextCalendarDay: false,
      },
    ],
  });
  const presentations = presentWorkDateEvents('2026-01-02', rule, [
    { id: 'e1', eventType: 'TIME_IN', eventTime: new Date('2026-01-02T00:00:00.000Z') },
    { id: 'e2', eventType: 'BREAK_OUT', eventTime: new Date('2026-01-02T04:00:00.000Z') },
    { id: 'e3', eventType: 'BREAK_IN', eventTime: new Date('2026-01-02T05:00:00.000Z') },
    { id: 'e4', eventType: 'TIME_OUT', eventTime: new Date('2026-01-02T09:00:00.000Z') },
  ]);
  expect(presentations.get('e1')).toMatchObject({ slot: 'AM_IN', label: 'AM In' });
  expect(presentations.get('e2')).toMatchObject({ slot: 'AM_OUT', label: 'AM Out' });
  expect(presentations.get('e3')).toMatchObject({ slot: 'PM_IN', label: 'PM In' });
  expect(presentations.get('e4')).toMatchObject({ slot: 'PM_OUT', label: 'PM Out' });
});

it('walks the second break occurrence on multi-break days', () => {
  const rule = dayRule({
    eventPattern: 'WITH_BREAK_EVENTS',
    breaks: [
      {
        id: 'b1',
        sequenceNo: 1,
        breakStartTime: '10:00',
        breakEndTime: '10:15',
        endNextCalendarDay: false,
      },
      {
        id: 'b2',
        sequenceNo: 2,
        breakStartTime: '15:00',
        breakEndTime: '15:15',
        endNextCalendarDay: false,
      },
    ],
  });
  expect(nextExpectedEventType([], rule)).toBe('TIME_IN');
  const afterFirstBreak = nextExpectedEventType(
    [
      sequenceEvent('TIME_IN', '2026-01-02T00:00:00.000Z'),
      sequenceEvent('BREAK_OUT', '2026-01-02T02:00:00.000Z'),
      sequenceEvent('BREAK_IN', '2026-01-02T02:15:00.000Z'),
    ],
    rule,
  );
  expect(afterFirstBreak).toBe('BREAK_OUT');
  const complete = nextExpectedEventType(
    [
      sequenceEvent('TIME_IN', '2026-01-02T00:00:00.000Z'),
      sequenceEvent('BREAK_OUT', '2026-01-02T02:00:00.000Z'),
      sequenceEvent('BREAK_IN', '2026-01-02T02:15:00.000Z'),
      sequenceEvent('BREAK_OUT', '2026-01-02T07:00:00.000Z'),
      sequenceEvent('BREAK_IN', '2026-01-02T07:15:00.000Z'),
      sequenceEvent('TIME_OUT', '2026-01-02T09:00:00.000Z'),
    ],
    rule,
  );
  expect(complete).toBeNull();
});

it('projects an IN_OUT daytime schedule onto the AM/PM slots', () => {
  const rule = dayRule({
    eventPattern: 'IN_OUT',
    breaks: [
      {
        id: 'b1',
        sequenceNo: 1,
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        endNextCalendarDay: false,
      },
    ],
  });
  const presentations = presentWorkDateEvents('2026-01-02', rule, [
    { id: 'e1', eventType: 'TIME_IN', eventTime: new Date('2026-01-02T00:00:00.000Z') },
    { id: 'e2', eventType: 'TIME_OUT', eventTime: new Date('2026-01-02T09:00:00.000Z') },
  ]);
  expect(presentations.get('e1')).toMatchObject({ slot: 'AM_IN', label: 'AM In' });
  expect(presentations.get('e2')).toMatchObject({ slot: 'PM_OUT', label: 'PM Out' });
});

it('keeps duty labels for overnight schedules and unscheduled labels for rest days', () => {
  const overnight = presentWorkDateEvents(
    '2026-01-02',
    dayRule({ dutyStartTime: '22:00', dutyEndTime: '06:00', endNextCalendarDay: true }),
    [
      { id: 'e1', eventType: 'TIME_IN', eventTime: new Date('2026-01-02T14:00:00.000Z') },
      { id: 'e2', eventType: 'TIME_OUT', eventTime: new Date('2026-01-02T22:00:00.000Z') },
    ],
  );
  expect(overnight.get('e1')).toMatchObject({ slot: null, label: 'Duty start' });
  expect(overnight.get('e2')).toMatchObject({ slot: null, label: 'Duty end' });

  const rest = presentWorkDateEvents(
    '2026-01-03',
    dayRule({ ruleType: 'REST', dutyStartTime: null, dutyEndTime: null }),
    [{ id: 'e1', eventType: 'TIME_IN', eventTime: new Date('2026-01-03T02:00:00.000Z') }],
  );
  expect(rest.get('e1')).toMatchObject({ slot: null, label: 'Unscheduled time in' });
});

it('drops extra occurrences out of the AM/PM projection without losing the label', () => {
  const rule = dayRule({
    eventPattern: 'WITH_BREAK_EVENTS',
    breaks: [
      {
        id: 'b1',
        sequenceNo: 1,
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        endNextCalendarDay: false,
      },
    ],
  });
  const presentations = presentWorkDateEvents('2026-01-02', rule, [
    { id: 'e1', eventType: 'BREAK_OUT', eventTime: new Date('2026-01-02T02:00:00.000Z') },
    { id: 'e2', eventType: 'BREAK_OUT', eventTime: new Date('2026-01-02T04:00:00.000Z') },
  ]);
  expect(presentations.get('e1')).toMatchObject({ slot: 'AM_OUT' });
  expect(presentations.get('e2')).toMatchObject({ slot: null, label: 'Break start' });
});
