import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendanceConfigurationAuditWriter } from './attendance-configuration.audit';
import { WorkArrangementsService } from './work-arrangements.service';
import { WorkSchedulesService } from './work-schedules.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const documentsService = {} as ConstructorParameters<typeof WorkSchedulesService>[1];

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'attendance-configuration-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function dayRules() {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
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
        },
  );
}

it('rechecks permissions before opening a Work Schedule workflow', async () => {
  const service = new WorkSchedulesService(attendanceConfigurationAuditWriter, documentsService);

  await expect(
    service.create(context([]), {
      code: 'ORDINARY',
      name: 'Ordinary Work Schedule',
      scheduleType: 'REGULAR',
      effectiveDate: '2026-01-01',
      dayRules: dayRules(),
    }),
  ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_MANAGE_FORBIDDEN', statusCode: 403 });
  await expect(service.list(context([]))).rejects.toMatchObject({
    code: 'WORK_SCHEDULE_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service.activate(
      context([{ code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' }]),
      agencyId,
      agencyId,
      {
        authorityDocumentVersionId: agencyId,
        approvingAuthority: 'Office of the President',
        reason: 'Approved.',
      },
    ),
  ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_ACTIVATE_FORBIDDEN', statusCode: 403 });
});

it('rejects malformed definitions and missing authority details before touching the database', async () => {
  const service = new WorkSchedulesService(attendanceConfigurationAuditWriter, documentsService);
  const createContext = context([
    { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
    { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  ]);

  await expect(
    service.create(createContext, {
      code: 'ORDINARY',
      name: 'Ordinary Work Schedule',
      scheduleType: 'REGULAR',
      effectiveDate: '01 January 2026',
      dayRules: dayRules(),
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CONFIGURATION_DATE_INVALID', statusCode: 400 });

  await expect(
    service.create(createContext, {
      code: 'ORDINARY',
      name: 'Ordinary Work Schedule',
      scheduleType: 'REGULAR',
      effectiveDate: '2026-01-01',
      dayRules: dayRules().slice(0, 6),
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT', statusCode: 400 });

  await expect(
    service.activate(createContext, agencyId, agencyId, {
      authorityDocumentVersionId: agencyId,
      approvingAuthority: 'Office of the President',
      reason: '   ',
    }),
  ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_ACTIVATION_REASON_REQUIRED', statusCode: 400 });
});

it('rechecks permissions before opening a Work Arrangement workflow', async () => {
  const service = new WorkArrangementsService(attendanceConfigurationAuditWriter, documentsService);

  await expect(
    service.create(context([]), {
      code: 'HYBRID-2026',
      name: 'Hybrid Arrangement',
      arrangementType: 'HYBRID',
      permittedScheduleTypes: ['REGULAR'],
      holidayCalendarId: agencyId,
      effectiveDate: '2026-01-01',
    }),
  ).rejects.toMatchObject({ code: 'WORK_ARRANGEMENT_MANAGE_FORBIDDEN', statusCode: 403 });
  await expect(service.listHolidayCalendars(context([]))).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service.create(context([{ code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' }]), {
      code: 'HYBRID-2026',
      name: 'Hybrid Arrangement',
      arrangementType: 'HYBRID',
      permittedScheduleTypes: [],
      holidayCalendarId: agencyId,
      effectiveDate: '2026-01-01',
    }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT', statusCode: 400 });
});
