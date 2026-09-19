import { expect, it } from 'vitest';
import {
  attendanceEventListQuerySchema,
  attendanceEventTimeSchema,
  attendanceWorkDateSchema,
  clockAttendanceEventSchema,
  manualAttendanceEventSchema,
  webClockEnablementSchema,
} from './attendance.schemas';

const employeeId = '00000000-0000-4000-8000-000000000001';

it('requires a complete manual Attendance Event', () => {
  expect(
    manualAttendanceEventSchema.safeParse({
      employeeId,
      eventType: 'TIME_IN',
      eventTime: '2026-01-02T00:00:00+08:00',
      reason: 'Power interruption.',
    }).success,
  ).toBe(true);
  expect(
    manualAttendanceEventSchema.safeParse({
      employeeId,
      eventType: 'TIME_IN',
      eventTime: '2026-01-02T00:00:00+08:00',
      reason: '   ',
    }).success,
  ).toBe(false);
  expect(
    manualAttendanceEventSchema.safeParse({
      employeeId,
      eventType: 'TIME_IN',
      eventTime: '2026-01-02T00:00:00',
      reason: 'Power interruption.',
    }).success,
  ).toBe(false);
  expect(
    manualAttendanceEventSchema.safeParse({
      employeeId,
      eventType: 'TIME_IN',
      eventTime: '2026-01-02T00:00:00+08:00',
      reason: 'Power interruption.',
      unknown: true,
    }).success,
  ).toBe(false);
});

it('accepts an optional event type when clocking', () => {
  expect(clockAttendanceEventSchema.safeParse({}).success).toBe(true);
  expect(clockAttendanceEventSchema.safeParse({ eventType: 'BREAK_OUT' }).success).toBe(true);
  expect(clockAttendanceEventSchema.safeParse({ eventType: 'LUNCH' }).success).toBe(false);
});

it('validates web clock enablement and list filters as calendar dates', () => {
  expect(
    webClockEnablementSchema.safeParse({
      enabled: true,
      effectiveFrom: '2026-01-02',
      reason: 'Approved web clock.',
    }).success,
  ).toBe(true);
  expect(
    webClockEnablementSchema.safeParse({
      enabled: true,
      effectiveFrom: '2026-01-02T00:00:00Z',
      reason: 'Approved web clock.',
    }).success,
  ).toBe(false);
  expect(attendanceWorkDateSchema.safeParse('2026-01-02').success).toBe(true);
  expect(attendanceWorkDateSchema.safeParse('02 January 2026').success).toBe(false);
  expect(
    attendanceEventListQuerySchema.safeParse({ employeeId, from: '2026-01-01', to: '2026-01-31' })
      .success,
  ).toBe(true);
  expect(attendanceEventListQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z' }).success).toBe(
    false,
  );
  expect(attendanceEventTimeSchema.safeParse('2026-01-02T08:00:00+08:00').success).toBe(true);
});
