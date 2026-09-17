import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { attendanceConfigurationAuditWriter } from './attendance-configuration.audit';
import { HolidayCalendarsService } from './holiday-calendars.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const calendarId = '00000000-0000-4000-8000-000000000004';
const draftId = '00000000-0000-4000-8000-000000000005';
const documentVersionId = '00000000-0000-4000-8000-000000000006';
const documentsService = {} as ConstructorParameters<typeof HolidayCalendarsService>[1];

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'holiday-calendar-service-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const read = [{ code: 'attendance.configuration.read', scopePolicy: 'AGENCY' }] as const;
const manage = [{ code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' }] as const;
const activate = [{ code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' }] as const;

const definition = {
  effectiveDate: '2026-01-01',
  entries: [
    {
      holidayDate: '2026-12-25',
      name: 'Christmas Day',
      dayType: 'REGULAR_HOLIDAY' as const,
      sourceReference: 'Proclamation No. 123',
    },
  ],
};

it('rechecks permissions before opening a Holiday Calendar workflow', async () => {
  const service = new HolidayCalendarsService(attendanceConfigurationAuditWriter, documentsService);

  await expect(service.list(context([]))).rejects.toMatchObject({
    code: 'HOLIDAY_CALENDAR_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(service.findById(context([]), calendarId)).rejects.toMatchObject({
    code: 'HOLIDAY_CALENDAR_READ_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service.create(context([]), {
      code: 'PH-NATIONAL',
      name: 'Philippine National Holidays',
      scopeType: 'AGENCY',
      scopeReference: 'Agency-wide',
      ...definition,
    }),
  ).rejects.toMatchObject({ code: 'HOLIDAY_CALENDAR_MANAGE_FORBIDDEN', statusCode: 403 });
  await expect(service.createSuccessor(context([]), calendarId)).rejects.toMatchObject({
    code: 'HOLIDAY_CALENDAR_MANAGE_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service.updateDraft(context([]), calendarId, draftId, definition),
  ).rejects.toMatchObject({ code: 'HOLIDAY_CALENDAR_MANAGE_FORBIDDEN', statusCode: 403 });
  await expect(
    service.activate(context([]), calendarId, draftId, {
      authorityDocumentVersionId: documentVersionId,
      approvingAuthority: 'Office of the President',
      reason: 'Approved after review.',
    }),
  ).rejects.toMatchObject({ code: 'HOLIDAY_CALENDAR_ACTIVATE_FORBIDDEN', statusCode: 403 });
});

it('validates Holiday Calendar identity and entries before touching the database', async () => {
  const service = new HolidayCalendarsService(attendanceConfigurationAuditWriter, documentsService);
  const base = {
    code: 'PH-NATIONAL',
    name: 'Philippine National Holidays',
    scopeType: 'AGENCY' as const,
    scopeReference: 'Agency-wide',
    ...definition,
  };

  await expect(service.create(context(manage), { ...base, code: ' ' })).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
    statusCode: 400,
  });
  await expect(service.create(context(manage), { ...base, name: ' ' })).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
    statusCode: 400,
  });
  await expect(
    service.create(context(manage), { ...base, scopeReference: ' ' }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
    statusCode: 400,
  });
  await expect(
    service.create(context(manage), { ...base, scopeType: 'PROVINCE' as never }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
    statusCode: 400,
  });
  await expect(
    service.create(context(manage), {
      ...base,
      entries: [{ ...definition.entries[0]!, name: ' ' }],
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
    statusCode: 400,
  });
  await expect(
    service.create(context(manage), {
      ...base,
      entries: [definition.entries[0]!, { ...definition.entries[0]! }],
    }),
  ).rejects.toMatchObject({
    code: 'ATTENDANCE_CONFIGURATION_INVALID_INPUT',
    statusCode: 400,
  });
});

it('requires a reason and approving authority before Holiday Calendar activation', async () => {
  const service = new HolidayCalendarsService(attendanceConfigurationAuditWriter, documentsService);

  await expect(
    service.activate(context(activate), calendarId, draftId, {
      authorityDocumentVersionId: documentVersionId,
      approvingAuthority: 'Office of the President',
      reason: ' ',
    }),
  ).rejects.toMatchObject({
    code: 'HOLIDAY_CALENDAR_ACTIVATION_REASON_REQUIRED',
    statusCode: 400,
  });
  await expect(
    service.activate(context(activate), calendarId, draftId, {
      authorityDocumentVersionId: documentVersionId,
      approvingAuthority: ' ',
      reason: 'Approved after review.',
    }),
  ).rejects.toMatchObject({
    code: 'HOLIDAY_CALENDAR_APPROVING_AUTHORITY_REQUIRED',
    statusCode: 400,
  });
  await expect(
    service.activate(context(read), calendarId, draftId, {
      authorityDocumentVersionId: documentVersionId,
      approvingAuthority: 'Office of the President',
      reason: 'Approved after review.',
    }),
  ).rejects.toMatchObject({ code: 'HOLIDAY_CALENDAR_ACTIVATE_FORBIDDEN', statusCode: 403 });
});
