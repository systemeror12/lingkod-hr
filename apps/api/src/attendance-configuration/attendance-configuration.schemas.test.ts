import { expect, it } from 'vitest';
import {
  attendanceConfigurationActivationSchema,
  workArrangementCreateSchema,
  workScheduleCreateSchema,
  workScheduleDraftUpdateSchema,
} from './attendance-configuration.schemas';

const holidayCalendarId = '00000000-0000-4000-8000-000000000001';

function dayRule(weekday: number) {
  return weekday <= 5
    ? {
        weekday,
        ruleType: 'FIXED' as const,
        dutyStartTime: '08:00',
        dutyEndTime: '17:00',
        requiredMinutes: 480,
        eventPattern: 'IN_OUT' as const,
        collectionBeforeMinutes: 0,
        collectionAfterMinutes: 0,
        breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
      }
    : {
        weekday,
        ruleType: 'REST' as const,
        requiredMinutes: 0,
        eventPattern: 'IN_OUT' as const,
        collectionBeforeMinutes: 0,
        collectionAfterMinutes: 0,
        breaks: [],
      };
}

const dayRules = [1, 2, 3, 4, 5, 6, 7].map(dayRule);

it('accepts a complete Work Schedule Draft at the API boundary', () => {
  expect(
    workScheduleCreateSchema.parse({
      code: 'ORDINARY',
      name: 'Ordinary Work Schedule',
      scheduleType: 'REGULAR',
      effectiveDate: '2026-01-01',
      dayRules,
    }),
  ).toMatchObject({ code: 'ORDINARY', scheduleType: 'REGULAR' });
  expect(
    workScheduleDraftUpdateSchema.safeParse({
      scheduleType: 'REGULAR',
      effectiveDate: '2026-01-01',
      dayRules,
      rowVersion: 2,
    }).success,
  ).toBe(true);
});

it('rejects incomplete weeks, malformed dates, and unknown fields', () => {
  expect(
    workScheduleCreateSchema.safeParse({
      code: 'ORDINARY',
      name: 'Ordinary Work Schedule',
      scheduleType: 'REGULAR',
      effectiveDate: '2026-01-01',
      dayRules: dayRules.slice(0, 6),
    }).success,
  ).toBe(false);
  expect(
    workScheduleCreateSchema.safeParse({
      code: 'ORDINARY',
      name: 'Ordinary Work Schedule',
      scheduleType: 'REGULAR',
      effectiveDate: '01 January 2026',
      dayRules,
    }).success,
  ).toBe(false);
  expect(
    workScheduleCreateSchema.safeParse({
      code: 'ORDINARY',
      name: 'Ordinary Work Schedule',
      scheduleType: 'REGULAR',
      effectiveDate: '2026-01-01',
      dayRules,
      unexpected: true,
    }).success,
  ).toBe(false);
});

it('accepts a Work Arrangement Draft and an activation with authority evidence', () => {
  expect(
    workArrangementCreateSchema.parse({
      code: 'HYBRID-2026',
      name: 'Hybrid Arrangement',
      arrangementType: 'HYBRID',
      permittedScheduleTypes: ['REGULAR', 'FLEXIBLE'],
      holidayCalendarId,
      effectiveDate: '2026-01-01',
    }),
  ).toMatchObject({ arrangementType: 'HYBRID' });
  expect(
    workArrangementCreateSchema.safeParse({
      code: 'HYBRID-2026',
      name: 'Hybrid Arrangement',
      arrangementType: 'HYBRID',
      permittedScheduleTypes: [],
      holidayCalendarId,
      effectiveDate: '2026-01-01',
    }).success,
  ).toBe(false);

  expect(
    attendanceConfigurationActivationSchema.parse({
      authorityDocumentVersionId: holidayCalendarId,
      approvingAuthority: 'Office of the President',
      reason: 'Authority reviewed.',
    }),
  ).toMatchObject({ approvingAuthority: 'Office of the President' });
  expect(
    attendanceConfigurationActivationSchema.safeParse({
      authorityDocumentVersionId: holidayCalendarId,
      approvingAuthority: ' ',
      reason: 'Authority reviewed.',
    }).success,
  ).toBe(false);
  expect(
    attendanceConfigurationActivationSchema.safeParse({
      authorityDocumentVersionId: 'not-a-uuid',
      approvingAuthority: 'Office of the President',
      reason: 'Authority reviewed.',
    }).success,
  ).toBe(false);
});
