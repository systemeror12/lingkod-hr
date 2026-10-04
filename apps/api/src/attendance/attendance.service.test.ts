import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendanceAuditWriter } from './attendance.audit';
import { AttendanceExceptionError } from '../attendance-configuration/attendance-configuration.types';
import { AttendanceService } from './attendance.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000002';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'attendance-service-test',
    userId: '00000000-0000-4000-8000-000000000003',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000004',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new AttendanceService(attendanceAuditWriter, {} as never);
}

it('rechecks permissions before opening any Attendance workflow', async () => {
  const attendance = service();

  await expect(attendance.getWebClockStatus(context([]))).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    attendance.setWebClockEnablement(context([]), {
      enabled: true,
      effectiveFrom: '2026-01-02',
      reason: 'Approved web clock.',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CONFIGURATION_FORBIDDEN', statusCode: 403 });
  await expect(
    attendance.captureManual(context([]), {
      employeeId,
      eventType: 'TIME_IN',
      eventTime: '2026-01-02T00:00:00+08:00',
      reason: 'Power interruption.',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_CREATE_FORBIDDEN', statusCode: 403 });
  await expect(attendance.getClockState(context([]))).rejects.toMatchObject({
    code: 'ATTENDANCE_CLOCK_FORBIDDEN',
    statusCode: 403,
  });
  await expect(attendance.clock(context([]), {})).rejects.toMatchObject({
    code: 'ATTENDANCE_CLOCK_FORBIDDEN',
    statusCode: 403,
  });
});

it('refuses a narrower grant for manual entry, which AC1 reserves for the Agency', async () => {
  const attendance = service();

  await expect(
    attendance.captureManual(
      context([{ code: 'attendance.events.create_manual', scopePolicy: 'OWN' }]),
      {
        employeeId,
        eventType: 'TIME_IN',
        eventTime: '2026-01-02T00:00:00+08:00',
        reason: 'Own record.',
      },
    ),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_CREATE_FORBIDDEN', statusCode: 403 });
});

it('rejects malformed manual entries before touching the database', async () => {
  const attendance = service();
  const authorized = context([{ code: 'attendance.events.create_manual', scopePolicy: 'AGENCY' }]);

  await expect(
    attendance.captureManual(authorized, {
      employeeId,
      eventType: 'TIME_IN',
      eventTime: '2026-01-02T00:00:00+08:00',
      reason: '   ',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_REASON_REQUIRED', statusCode: 400 });

  await expect(
    attendance.captureManual(authorized, {
      employeeId,
      eventType: 'TIME_IN',
      eventTime: 'not-a-date',
      reason: 'Power interruption.',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_TIME_INVALID', statusCode: 400 });

  await expect(
    attendance.captureManual(authorized, {
      employeeId,
      eventType: 'TIME_IN',
      eventTime: new Date(Date.now() + 120_000).toISOString(),
      reason: 'Power interruption.',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_FUTURE', statusCode: 400 });
});

it('rejects malformed web clock enablement before touching the database', async () => {
  const attendance = service();
  const authorized = context([
    { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  ]);

  await expect(
    attendance.setWebClockEnablement(authorized, {
      enabled: true,
      effectiveFrom: '2026-01-02',
      reason: '   ',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_REASON_REQUIRED', statusCode: 400 });

  await expect(
    attendance.setWebClockEnablement(authorized, {
      enabled: true,
      effectiveFrom: '02 January 2026',
      reason: 'Approved web clock.',
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_DATE_INVALID',
    statusCode: 400,
  });
});

it('finds every Work Date whose collection window or calendar day holds an instant', async () => {
  const unscheduled = '2026-02-02';
  const assignments = {
    resolveForWorkDateInTransaction: async (
      _transaction: unknown,
      _agencyId: string,
      _employeeId: string,
      workDate: string,
    ) => {
      if (workDate === unscheduled) {
        throw new AttendanceExceptionError(
          'MISSING_SCHEDULE_ASSIGNMENT',
          'No Schedule Assignment.',
        );
      }
      return {
        workDate,
        workScheduleVersion: { timezone: 'Asia/Manila' },
        // 22:00 to 06:00 next day, collected for a further 24 hours.
        dayRule: {
          ruleType: 'FIXED',
          dutyStartTime: '22:00',
          dutyEndTime: '06:00',
          endNextCalendarDay: true,
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 1440,
        },
      };
    },
  };
  const attendance = new AttendanceService(attendanceAuditWriter, assignments as never);
  const transaction = { agency: { findFirst: async () => ({ defaultTimezone: 'Asia/Manila' }) } };
  const instant = new Date('2026-02-02T04:00:00+08:00');

  await expect(
    attendance.coveredWorkDatesInTransaction(
      transaction as never,
      agencyId,
      employeeId,
      instant,
      instant,
    ),
  ).resolves.toEqual({ covered: ['2026-01-31', '2026-02-01'], unresolved: [unscheduled] });
});
