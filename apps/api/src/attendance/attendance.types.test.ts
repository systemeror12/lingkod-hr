import { expect, it } from 'vitest';
import { AttendanceExceptionError } from '../attendance-configuration/attendance-configuration.types';
import type { WorkScheduleDayRuleSummary } from '../attendance-configuration/work-schedules.service';
import {
  addDateValueDays,
  attendanceExceptionDetails,
  captureException,
  eventCollectionWindow,
  localDateValue,
  zonedTimeToInstant,
} from './attendance.types';

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

it('adds calendar days across month and year boundaries', () => {
  expect(addDateValueDays('2026-01-31', 1)).toBe('2026-02-01');
  expect(addDateValueDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(addDateValueDays('2025-12-31', 1)).toBe('2026-01-01');
});

it('reads the local calendar date of one instant in a time zone', () => {
  expect(localDateValue(new Date('2026-01-01T15:59:59.000Z'), 'Asia/Manila')).toBe('2026-01-01');
  expect(localDateValue(new Date('2026-01-01T16:00:00.000Z'), 'Asia/Manila')).toBe('2026-01-02');
});

it('converts wall-clock time in a time zone to the matching instant', () => {
  expect(zonedTimeToInstant('2026-01-02', '08:00', 'Asia/Manila').toISOString()).toBe(
    '2026-01-02T00:00:00.000Z',
  );
  expect(zonedTimeToInstant('2026-01-02', '00:15', 'Asia/Manila').toISOString()).toBe(
    '2026-01-01T16:15:00.000Z',
  );
});

it('builds an Event Collection Window that only widens around duty time', () => {
  const window = eventCollectionWindow(
    dayRule({ collectionBeforeMinutes: 30, collectionAfterMinutes: 60 }),
    '2026-01-02',
    'Asia/Manila',
  );
  expect(window?.start.toISOString()).toBe('2026-01-01T23:30:00.000Z');
  expect(window?.end.toISOString()).toBe('2026-01-02T10:00:00.000Z');
});

it('opens an early-morning Event Collection Window on the previous calendar day', () => {
  const window = eventCollectionWindow(
    dayRule({ dutyStartTime: '00:30', collectionBeforeMinutes: 60 }),
    '2026-01-02',
    'Asia/Manila',
  );
  expect(window?.start.toISOString()).toBe('2026-01-01T15:30:00.000Z');
  expect(window?.end.toISOString()).toBe('2026-01-02T09:00:00.000Z');
});

it('closes an overnight Event Collection Window on the next calendar day', () => {
  const window = eventCollectionWindow(
    dayRule({
      dutyStartTime: '22:00',
      dutyEndTime: '06:00',
      endNextCalendarDay: true,
      collectionBeforeMinutes: 15,
      collectionAfterMinutes: 30,
    }),
    '2026-01-02',
    'Asia/Manila',
  );
  expect(window?.start.toISOString()).toBe('2026-01-02T13:45:00.000Z');
  expect(window?.end.toISOString()).toBe('2026-01-02T22:30:00.000Z');
});

it('returns no window for rest days and flex rules without an earliest start', () => {
  expect(
    eventCollectionWindow(
      dayRule({ ruleType: 'REST', dutyStartTime: null, dutyEndTime: null }),
      '2026-01-04',
      'Asia/Manila',
    ),
  ).toBeNull();
  expect(
    eventCollectionWindow(
      dayRule({ ruleType: 'FLEXIBLE', earliestStartTime: null }),
      '2026-01-02',
      'Asia/Manila',
    ),
  ).toBeNull();
});

it('maps Attendance Exceptions and ignores unrelated errors', () => {
  expect(attendanceExceptionDetails(new Error('plain'))).toBeNull();
  expect(
    attendanceExceptionDetails(
      new AttendanceExceptionError('MISSING_SERVICE', 'No active service.', { employeeId: 'e1' }),
    ),
  ).toEqual({
    type: 'MISSING_SERVICE',
    message: 'No active service.',
    details: { employeeId: 'e1' },
  });
  expect(captureException('UNMATCHED_ATTENDANCE_EVENT', 'Unmatched.')).toEqual({
    type: 'UNMATCHED_ATTENDANCE_EVENT',
    message: 'Unmatched.',
    details: {},
  });
});
